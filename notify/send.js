/* 우리 가계부 · 폰 알림 보내기
 *
 * GitHub Actions 가 몇 분마다 이 파일을 돌린다.
 * Supabase 를 들여다보고 "지난번 확인 이후에 생긴 일"만 골라 알림을 쏜다.
 *
 * 구독 정보와 마지막 확인 시각은 couple_meta.extra 안에 둔다.
 * (표를 새로 만들지 않으려고 이미 있는 칸을 쓴다)
 */
const webpush = require('web-push');

const { SUPABASE_URL, SUPABASE_KEY, COUPLE_CODE,
        VAPID_PUBLIC, VAPID_PRIVATE, UPDATE_URL } = process.env;
const APP = process.env.APP || 'couple';        // couple | personal
/* 시험할 때 '오늘'을 바꿔볼 수 있게 한다 (평소에는 비워둔다) */
const now = () => (process.env.TEST_DATE ? new Date(process.env.TEST_DATE + 'T12:00:00Z') : new Date());
const APP_NAME = APP === 'personal' ? '내 가계부' : '우리 가계부';

/* 설정이 덜 채워졌으면 조용히 건너뛴다.
   (예: 개인 가계부 저장소를 아직 안 만들었을 때 워크플로 전체가 실패하면 안 된다) */
const missing = Object.entries({ SUPABASE_URL, SUPABASE_KEY, COUPLE_CODE, VAPID_PUBLIC, VAPID_PRIVATE })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.log(`설정이 없어 건너뜁니다 (${missing.join(', ')})`);
  process.exit(0);
}
webpush.setVapidDetails('mailto:yhkimslv@berkeley.edu', VAPID_PUBLIC, VAPID_PRIVATE);

const H = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json' };
const api = (p, opt = {}) => fetch(SUPABASE_URL + '/rest/v1/' + p, { ...opt, headers: { ...H, ...(opt.headers || {}) } });

const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  let metaRes;
  try {
    metaRes = await api('couple_meta?couple_code=eq.' + encodeURIComponent(COUPLE_CODE) + '&select=*');
  } catch (e) {
    /* 저장소가 잠들었거나 주소가 바뀌었을 때. 다음 차례에 다시 해보면 되므로 조용히 끝낸다. */
    console.log(`[${APP_NAME}] 저장소에 연결할 수 없어 건너뜁니다 — ${e.cause ? e.cause.code : e.message}`);
    return;
  }
  const meta = (await metaRes.json())[0];
  if (!meta) { console.log('커플 정보 없음 — 넘어감'); return; }

  const extra = meta.extra || {};
  const subs = extra.pushSubs || [];
  if (!subs.length) { console.log('등록된 기기 없음 — 넘어감'); return; }

  const prefsByName = extra.pushPrefs || {};
  const state = extra.pushState || {};
  const since = state.lastSeen || new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const jobs = [];   // { to: member|null(모두), title, body, tag, kind }

  /* 개인 가계부는 상대가 없으므로 내역 알림 대신 카드 결제일·예산을 본다 */
  if (APP === 'personal') {
    const today = now();
    const dayStr = today.toISOString().slice(0, 10);
    const tomorrow = new Date(today.getTime() + 86400000).getUTCDate();

    /* 카드 결제일 하루 전에 알려준다 */
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

    /* 이번 달 예산을 다 썼을 때 (한 달에 한 번만) */
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

  /* 1) 지난번 이후 상대가 넣은 내역 (커플 가계부만) */
  let maxSeen = since;
  if (APP === 'couple') {
    const eRes = await api('entries?couple_code=eq.' + encodeURIComponent(COUPLE_CODE) +
      '&updated_at=gt.' + encodeURIComponent(since) + '&deleted=is.false&order=updated_at.asc&limit=50');
    for (const e of await eRes.json()) {
      if (e.updated_at > maxSeen) maxSeen = e.updated_at;
      /* 알림은 '입력하지 않은 쪽'에게 보낸다(member = 입력한 사람).
         문구에 쓰는 이름은 실제로 돈을 낸/보낸 사람(payer)이다.
         한 사람이 상대가 낸 걸 대신 입력하는 경우가 있어 둘이 다를 수 있다. */
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

    /* 2) 고정비 결제일 (매달 1일, 하루 한 번만) */
    const dayStr = now().toISOString().slice(0, 10);
    if (now().getUTCDate() === 1 && state.fixedNotifiedOn !== dayStr) {
      jobs.push({ notTo: null, kind: 'fixed', tag: 'fixed-' + dayStr,
        title: '이번 달 고정비 날이에요 🔁',
        body: '렌트·유틸 선입금과 결제 내역을 넣어주세요.' });
      state.fixedNotifiedOn = dayStr;
    }
  }

  /* 3) 새 버전 */
  if (UPDATE_URL) {
    try {
      const v = await (await fetch(UPDATE_URL + '?t=' + Date.now())).json();
      if (v.version && v.version !== state.lastVersion) {
        if (state.lastVersion) {        // 처음 돌 때는 알리지 않는다
          jobs.push({ notTo: null, kind: 'update', tag: 'v-' + v.version,
            title: `${APP_NAME} 새 버전 ${v.version}`,
            body: v.notes || '앱을 열면 업데이트할 수 있어요.' });
        }
        state.lastVersion = v.version;
      }
    } catch (err) { console.log('버전 확인 실패:', err.message); }
  }

  /* 보내기 (DRY_RUN=1 이면 실제로 쏘지 않고 무엇을 보낼지만 찍는다) */
  const dry = process.env.DRY_RUN === '1';
  let sent = 0, gone = [];
  if (dry) {
    console.log('— 시험 모드 —');
    for (const j of jobs) {
      const to = subs.filter((sub) => !(j.notTo && sub.member === j.notTo))
        .filter((sub) => (prefsByName[sub.member] || {})[j.kind] !== false)
        .map((sub) => sub.member || '(이름없음)');
      console.log(`  [${j.kind}] ${j.title} / ${j.body}  → ${to.length ? to.join(', ') : '(받을 사람 없음)'}`);
    }
    console.log(`  마지막 확인 시각: ${since} → ${maxSeen}`);
    return;
  }
  for (const j of jobs) {
    for (const sub of subs) {
      if (j.notTo && sub.member === j.notTo) continue;              // 본인에게는 안 보낸다
      const pref = prefsByName[sub.member] || {};
      if (pref[j.kind] === false) continue;                          // 이 사람이 끈 알림
      try {
        await webpush.sendNotification(sub, JSON.stringify({
          title: j.title, body: j.body, tag: j.tag, url: './'
        }));
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) gone.push(sub.endpoint);
        else console.log('보내기 실패(' + err.statusCode + '):', (err.body || '').slice(0, 80));
      }
    }
  }

  /* 확인 시각과 죽은 구독 정리를 저장 */
  state.lastSeen = maxSeen;
  const newExtra = { ...extra, pushState: state };
  if (gone.length) newExtra.pushSubs = subs.filter((x) => gone.indexOf(x.endpoint) < 0);
  await api('couple_meta?on_conflict=couple_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ couple_code: COUPLE_CODE, extra: newExtra,
                            updated_at: meta.updated_at }])
  });

  console.log(`[${APP_NAME}] 기기 ${subs.length}대 · 알릴 일 ${jobs.length}건 · 보냄 ${sent}건` +
              (gone.length ? ` · 만료된 기기 ${gone.length}대 정리` : ''));
}

main().catch((e) => { console.error(e); process.exit(1); });
