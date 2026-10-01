# Gagyebu desktop downloads

This repository hosts the official macOS and Windows installers for two local-first
household ledger apps:

- **Our Ledger** is a shared ledger for couples. It tracks shared and personal
  purchases, each person's spending, recurring costs, settlements, budgets, cards,
  and statistics.
- **My Ledger** is a personal ledger. It tracks monthly spending, budgets, credit-card
  balances, accounts, recurring costs, savings, and statistics. It can also import a
  user's share of expenses from Our Ledger while keeping the full charge in the card
  balance where appropriate.

The apps can check this repository for updates. You can also download an installer
directly from the releases below.

## Latest downloads

### Our Ledger — version 1.8.7

- [Windows installer (`setup-1.8.7-win.exe`)](https://github.com/yhkimslv/gagyebu-releases/releases/download/v1.8.7/setup-1.8.7-win.exe)
- [macOS for Apple silicon (`setup-1.8.7-mac-arm64.dmg`)](https://github.com/yhkimslv/gagyebu-releases/releases/download/v1.8.7/setup-1.8.7-mac-arm64.dmg)
- [macOS for Intel (`setup-1.8.7-mac-x64.dmg`)](https://github.com/yhkimslv/gagyebu-releases/releases/download/v1.8.7/setup-1.8.7-mac-x64.dmg)
- [Release notes and all assets](https://github.com/yhkimslv/gagyebu-releases/releases/tag/v1.8.7)

### My Ledger — version 1.10.6

- [Windows installer (`setup-1.10.6-win.exe`)](https://github.com/yhkimslv/gagyebu-releases/releases/download/v1.10.6/setup-1.10.6-win.exe)
- [macOS for Apple silicon (`setup-1.10.6-mac-arm64.dmg`)](https://github.com/yhkimslv/gagyebu-releases/releases/download/v1.10.6/setup-1.10.6-mac-arm64.dmg)
- [macOS for Intel (`setup-1.10.6-mac-x64.dmg`)](https://github.com/yhkimslv/gagyebu-releases/releases/download/v1.10.6/setup-1.10.6-mac-x64.dmg)
- [Release notes and all assets](https://github.com/yhkimslv/gagyebu-releases/releases/tag/v1.10.6)

You can browse [all releases](https://github.com/yhkimslv/gagyebu-releases/releases)
to install an older version.

## Which installer should I choose?

| Computer | Download |
|---|---|
| Windows 10 or 11, 64-bit | `setup-<version>-win.exe` |
| Mac with an M-series chip (M1, M2, M3, M4, or newer) | `setup-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `setup-<version>-mac-x64.dmg` |

On a Mac, open **Apple menu → About This Mac** if you are unsure which processor
you have. Choose the Apple-silicon download when the Chip field starts with `Apple M`;
choose the Intel download when the Processor field says `Intel`.

## Unsigned-app warning

These installers are not code-signed or notarized by Apple or Microsoft. Your
computer may therefore show a security warning even when you downloaded the file
from this repository.

- **macOS:** In Finder, Control-click or right-click the app and choose **Open**, then
  choose **Open** again. If macOS still blocks it, open **System Settings → Privacy &
  Security** and use **Open Anyway** for this app.
- **Windows:** Microsoft Defender SmartScreen may show “Windows protected your PC.”
  If the file came from this repository, select **More info → Run anyway**.

Only bypass a warning for a file downloaded from the official release links above.

## Privacy and source code

The apps are local-first: records are stored on your device. Optional multi-device
sync uses a Supabase project that you configure yourself; the app publisher does not
operate a ledger-data backend or receive your records. The in-app passcode or
biometric lock is a screen lock, not file encryption, so protect your operating-system
account and device backups as well.

The complete source code, setup documentation, and MIT license are available in the
[Gagyebu source repository](https://github.com/yhkimslv/gagyebu).
