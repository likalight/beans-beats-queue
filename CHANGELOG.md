# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com).

## [1.1.0] - 2026-11-20

### Added
- **Custom menu items**: staff type a name and price for off-menu drinks (such as a piccolo). They are tagged `CUSTOM` in the queue and included in reports.
- **Guest notification card** shown as soon as the QR is scanned, with blocked and iPhone (Add to Home Screen) guidance, a sound-alert fallback, and a Test button.
- A "being made" push heads-up before the "ready" alert.
- A per-order web-app manifest, so an iPhone home-screen icon opens straight to that order. PNG app icons added.
- **Free production stack**: Upstash Redis mirror (`store.js`), a Render free blueprint, and a GitHub Actions keepalive and CI.
- `/api/health` now reports the storage mode, pending writes and uptime.
- `test/storage.js`: restart on a wiped disk and restore everything from Redis.

### Changed
- Simpler counter flow: tap-to-pick drink sheet, one **Send to bar** button, PayNow/Card toggle.
- Calmer barista queue: only "cups to make" and the scan button; stats and insights stay with the booth lead.
- Queue timers read `1h 05m` and `2d` instead of thousands of minutes.
- The guest page hides the grey "Ready to collect" pill until the drink is actually ready.

## [1.0.0] - 2026-11-15

### Added
- Offline-first order, queue, ready board, guest page, menu controls and daily report.
- Beat-reactive ready board with voice call-outs, live cockpit (`/demo`), story card and booth insights.
