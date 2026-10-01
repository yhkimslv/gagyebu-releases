/* Our Ledger · phone notification sender
 *
 * GitHub Actions runs this file every few minutes.
 * It checks Supabase and sends notifications only for events since the last run.
 *
 * Subscription data and the last-check time live in couple_meta.extra so a separate
 * table is not required.
 */
const webpush = require('web-push');

const { SUPABASE_URL, SUPABASE_KEY, COUPLE_CODE,
        VAPID_PUBLIC, VAPID_PRIVATE, UPDATE_URL } = process.env;
const APP = process.env.APP || 'couple';        // couple | personal
/* TEST_DATE can override "today" in tests; it is normally unset. */
const now = () => (process.env.TEST_DATE ? new Date(process.env.TEST_DATE + 'T12:00:00Z') : new Date());
const APP_NAME = APP === 'personal' ? '내 가계부' : '우리 가계부';

/* Skip quietly when configuration is incomplete. For example, a missing personal
   ledger database must not fail the entire workflow. */
const missing = Object.entries({ SUPABASE_URL, SUPABASE_KEY, COUPLE_CODE, VAPID_PUBLIC, VAPID_PRIVATE })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.log(`Skipping because configuration is missing (${missing.join(', ')})`);
  process.exit(0);
}
// The contact address is used only if a push service needs to report a problem.
webpush.setVapidDetails('mailto:' + (process.env.VAPID_EMAIL || 'nobody@example.com'),
  VAPID_PUBLIC, VAPID_PRIVATE);

const H = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json' };
const api = (p, opt = {}) => fetch(SUPABASE_URL + '/rest/v1/' + p, { ...opt, headers: { ...H, ...(opt.headers || {}) } });

const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  let metaRes;
  try {
    metaRes = await api('couple_meta?couple_code=eq.' + encodeURIComponent(COUPLE_CODE) + '&select=*');
  } catch (e) {
    /* End quietly if the database is paused or its address changed; retry next run. */
    console.log(`[${APP_NAME}] Cannot connect to the database; skipping — ${e.cause ? e.cause.code : e.message}`);
    return;
  }
  const meta = (await metaRes.json())[0];
  if (!meta) { console.log('No ledger metadata found; skipping'); return; }

  const extra = meta.extra || {};
  const subs = extra.pushSubs || [];
  if (!subs.length) { console.log('No registered devices; skipping'); return; }

  const prefsByName = extra.pushPrefs || {};
  const state = extra.pushState || {};
  const since = state.lastSeen || new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const jobs = [];   // { to: member|null (everyone), title, body, tag, kind }

  /* The personal ledger has no partner, so check card due dates and the budget. */
  if (APP === 'personal') {
    const today = now();
    const dayStr = today.toISOString().slice(0, 10);
    const tomorrow = new Date(today.getTime() + 86400000).getUTCDate();

    /* Notify one day before a card payment is due. */
    for (const m of meta.methods || []) {
      if (!m.billingDay || m.type !== 'credit') continue;
      if (Number(m.billingDay) !== tomorrow) continue;
      const key = 'card-' + m.id + '-' + dayStr;
      if ((state.notified || []).indexOf(key) >= 0) continue;
      jobs.push({ notTo: null, kind: 'card', tag: key,
        title: `${m.emoji || '💳'} ${m.name} 결제일이 내일이에요`,
        body: '잔액을 확인하고 갚을 금액을 정해보세요.' });
      state.notified = [...(state.notified || []).slice(-40), key];
    }

    /* Notify when the monthly budget is exhausted, at most once per month. */
    const budget = Number(meta.budget) || 0;
    if (budget > 0) {
      const month = dayStr.slice(0, 7);
      const eRes2 = await api('entries?couple_code=eq.' + encodeURIComponent(COUPLE_CODE) +
        '&type=eq.expense&deleted=is.false&date=gte.' + month + '-01&select=amount,category&limit=2000');
      const spent = (await eRes2.json())
        .filter((e) => e.category !== '고정지출')
        .reduce((a, e) => a + Number(e.amount), 0);
      const key = 'budget-' + month;
      if (spent >= budget && (state.notified || []).indexOf(key) < 0) {
        jobs.push({ notTo: null, kind: 'budget', tag: key,
          title: '이번 달 예산을 다 썼어요',
          body: `예산 ${money(budget)} 중 ${money(spent)} 사용` });
        state.notified = [...(state.notified || []).slice(-40), key];
      }
    }
  }

  /* 1) Couple-ledger entries added by the other person since the previous run. */
  let maxSeen = since;
  if (APP === 'couple') {
    const eRes = await api('entries?couple_code=eq.' + encodeURIComponent(COUPLE_CODE) +
      '&updated_at=gt.' + encodeURIComponent(since) + '&deleted=is.false&order=updated_at.asc&limit=50');
    for (const e of await eRes.json()) {
      if (e.updated_at > maxSeen) maxSeen = e.updated_at;
      /* Notify the person who did not enter the item (member is the author).
         The notification names the person who actually paid or sent the money
         (payer). These can differ when one person records the other's payment. */
      const typedBy = e.member || e.payer || '';
      const paidBy = e.payer || e.member || '';
      if (e.type === 'expense') {
        jobs.push({ notTo: typedBy, kind: 'entry', tag: 'e-' + e.id,
          title: `${paidBy}님이 지출을 입력했어요`,
          body: `${e.memo || e.category || '지출'} · ${money(e.amount)}` });
      } else if (e.type === 'income') {
        jobs.push({ notTo: typedBy, kind: 'entry', tag: 'e-' + e.id,
          title: `${paidBy}님이 입금을 기록했어요`,
          body: `${e.memo || e.category || '입금'} · ${money(e.amount)}` });
      } else if (e.type === 'settle') {
        jobs.push({ notTo: typedBy, kind: 'settle', tag: 'e-' + e.id,
          title: `${paidBy}님이 돈을 보냈어요`,
          body: `${e.memo || '정산'} · ${money(e.amount)}` });
      }
    }

    /* 2) Fixed-cost reminder on the first day of each month, once per day. */
    const dayStr = now().toISOString().slice(0, 10);
    if (now().getUTCDate() === 1 && state.fixedNotifiedOn !== dayStr) {
      jobs.push({ notTo: null, kind: 'fixed', tag: 'fixed-' + dayStr,
        title: '이번 달 고정비 날이에요 🔁',
        body: '렌트·유틸 선입금과 결제 내역을 넣어주세요.' });
      state.fixedNotifiedOn = dayStr;
    }
  }

  /* 3) New version. */
  if (UPDATE_URL) {
    try {
      const v = await (await fetch(UPDATE_URL + '?t=' + Date.now())).json();
      if (v.version && v.version !== state.lastVersion) {
        if (state.lastVersion) {        // Do not notify during the initial run.
          jobs.push({ notTo: null, kind: 'update', tag: 'v-' + v.version,
            title: `${APP_NAME} 새 버전 ${v.version}`,
            body: v.notes || '앱을 열면 업데이트할 수 있어요.' });
        }
        state.lastVersion = v.version;
      }
    } catch (err) { console.log('Version check failed:', err.message); }
  }

  /* Send notifications. DRY_RUN=1 logs them without actually sending. */
  const dry = process.env.DRY_RUN === '1';
  let sent = 0, gone = [];
  if (dry) {
    console.log('— Dry-run mode —');
    for (const j of jobs) {
      const to = subs.filter((sub) => !(j.notTo && sub.member === j.notTo))
        .filter((sub) => (prefsByName[sub.member] || {})[j.kind] !== false)
        .map((sub) => sub.member || '(unnamed)');
      console.log(`  [${j.kind}] ${j.title} / ${j.body}  → ${to.length ? to.join(', ') : '(no recipients)'}`);
    }
    console.log(`  Last checked: ${since} → ${maxSeen}`);
    return;
  }
  for (const j of jobs) {
    for (const sub of subs) {
      if (j.notTo && sub.member === j.notTo) continue;              // Do not notify the author.
      const pref = prefsByName[sub.member] || {};
      if (pref[j.kind] === false) continue;                          // This member disabled this notification.
      try {
        await webpush.sendNotification(sub, JSON.stringify({
          title: j.title, body: j.body, tag: j.tag, url: './'
        }));
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) gone.push(sub.endpoint);
        else console.log('Send failed (' + err.statusCode + '):', (err.body || '').slice(0, 80));
      }
    }
  }

  /* Save the last-check time and remove expired subscriptions. */
  state.lastSeen = maxSeen;
  const newExtra = { ...extra, pushState: state };
  if (gone.length) newExtra.pushSubs = subs.filter((x) => gone.indexOf(x.endpoint) < 0);
  await api('couple_meta?on_conflict=couple_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ couple_code: COUPLE_CODE, extra: newExtra,
                            updated_at: meta.updated_at }])
  });

  console.log(`[${APP_NAME}] devices ${subs.length} · notification jobs ${jobs.length} · sent ${sent}` +
              (gone.length ? ` · removed ${gone.length} expired devices` : ''));
}

main().catch((e) => { console.error(e); process.exit(1); });
