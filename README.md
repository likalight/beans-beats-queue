<div align="center">

<img src="docs/banner.svg" alt="beans&beats queue: keep the queue on the beat" width="100%">

<br>

**The offline-first order & pickup system for the beans&beats coffee-clubbing booth at Christmas Together 2026.**<br>
A ready board that moves with the DJ and calls orders out loud, a phone page that fills a cup as your drink is made,<br>and a live cockpit that shows the whole booth on one screen. No app to download, no paper receipts.

<br>

[![Live demo](https://img.shields.io/badge/live_demo-online-fa6105?style=for-the-badge&logo=render&logoColor=white)](https://beans-beats-queue.onrender.com)
[![Demo video](https://img.shields.io/badge/demo_video-1:45-fa6105?style=for-the-badge&logo=airplayvideo&logoColor=white)](https://beans-beats-queue.onrender.com/film)
[![Technical summary](https://img.shields.io/badge/tech_summary-PDF-111111?style=for-the-badge&logo=adobeacrobatreader&logoColor=white)](docs/technical-summary.pdf)

[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![PWA](https://img.shields.io/badge/PWA-offline--first-5A0FC8?logo=pwa&logoColor=white)](public/sw.js)
[![Web Push](https://img.shields.io/badge/alerts-Web_Push-fa6105)](public/sw.js)
[![PDPA](https://img.shields.io/badge/PDPA-first_name_only-111111)](#-personal-data--pdpa)
[![Deps](https://img.shields.io/badge/runtime_deps-1-111111)](package.json)
[![Tests](https://img.shields.io/badge/tests-passing-fa6105)](test/smoke.js)
[![License: MIT](https://img.shields.io/badge/license-MIT-111111)](LICENSE)

[**Live cockpit**](https://beans-beats-queue.onrender.com/demo) &nbsp;·&nbsp; [Live app](https://beans-beats-queue.onrender.com) &nbsp;·&nbsp; [Demo video](https://beans-beats-queue.onrender.com/film) &nbsp;·&nbsp; [Technical summary (PDF)](docs/technical-summary.pdf) &nbsp;·&nbsp; [Demo script](docs/demo-script.md)

<br>

<a href="https://beans-beats-queue.onrender.com/demo"><img src="docs/screenshots/cockpit.png" alt="Live booth cockpit: order tablet, ready board, barista queue, sync feed and guest phone on one screen" width="100%"></a>

<sub><b>The live cockpit</b> (<code>/demo</code>): four real copies of the app side by side. Hit <b>Rush hour</b>, kill the order tablet's wifi, and watch everything sync.</sub>

</div>

---

## ✦ The wow, in 60 seconds

| | What | Why it matters at the booth |
|---|---|---|
| 🎛️ | **Live cockpit** at [`/demo`](https://beans-beats-queue.onrender.com/demo) | Order tablet, barista queue, ready board, a guest's phone and a live sync feed on one page. **Rush hour** sends in 12 guests, **Barista autopilot** works the bar, **Kill wifi** proves offline sync. Judges see the whole system in 30 seconds. |
| 🔊 | **Ready board on the beat** | The TV board listens to the DJ through the laptop mic and pulses, glows and snows on the beat (a built-in 120 BPM groove without a mic). It's coffee clubbing, on screen. |
| 🗣️ | **Voice call-outs** | A fresh order takes over the screen in beans&beats orange and the board says it out loud: *"Order forty-two, Mei. Your iced oat flat white is ready."* On-device speech, works offline. |
| ☕ | **Cup that fills as it's made** | The guest's phone shows an animated cup (steam if hot, ice if iced) filling from received to making to ready, with a **live ETA** from the bar's real pace. Confetti, chime and vibration when it's ready. |
| 🧡 | **Charity meter + milestones** | Dollars raised for Red Cross Young Hearts on the board and every guest phone, with confetti and a spoken thank-you at every 50 cups. |
| 📸 | **Shareable story card** | One tap makes a 1080×1920 *"I sipped for Young Hearts"* card on the phone, ready for Instagram: free reach for beans&beats and the cause. |
| 🧠 | **Booth insights** | Plain-language warnings for the lead: *"Oat milk runs out around 3:40 pm at this pace"*, *"Rush building: 25 cups in vs 5 out"*, *"2 drinks waiting over 5 min: call out 012, 015"*. |

<table>
<tr>
<td width="60%"><img src="docs/screenshots/board.png" alt="Ready board"><br><b>Ready board.</b> Snow and an equaliser that move with the music, a charity meter and a now-serving ticker.</td>
<td width="40%"><img src="docs/screenshots/board-takeover.png" alt="Ready takeover"><br><b>Ready takeover.</b> The new number fills the screen and is called out by voice.</td>
</tr>
</table>

## Try it

| Role | PIN | Opens |
|---|---|---|
| **Barista** | `1111` | Order screen, barista queue, ready board, guest display, scan-to-collect |
| **Booth lead** | `9999` | Everything above, plus menu controls and the daily sales report |
| **Guest** | none | Scan the QR shown after ordering, or open [`/m`](https://beans-beats-queue.onrender.com/m) for the menu |
| **Judge** | `9999` | Open [**`/demo`**](https://beans-beats-queue.onrender.com/demo), log in once, press **Start**, then **Rush hour**. Turn sound on. |

> [!NOTE]
> The demo runs on Render's free tier: the first load after a quiet spell can take ~50 s while it wakes up, and demo data resets when the instance restarts. The live event runs on a paid instance with a persistent disk (see [Deployment](#-deployment)).

## How a cup moves through the booth

```mermaid
sequenceDiagram
    autonumber
    actor G as Guest
    participant O as Order tablet
    participant Q as Barista queue
    participant B as Ready board (TV)
    G->>O: Orders at the counter (first name, drink, hot/iced, milk)
    O->>O: POS operator keys in the total, taps Paid · PayNow / Card
    O-->>G: Order number + QR on screen (no receipt)
    G->>G: Scans QR, live status page, taps "Alert me"
    O->>Q: Order appears instantly (or syncs after a wifi drop)
    Q->>Q: One tap Making, one tap Ready
    Q-->>G: Phone chimes, vibrates, turns black, push notification
    Q-->>B: Number + name under "Ready to collect"
    G->>Q: Shows pickup QR, tablet camera scans it, Collected
```

## Screenshots

<table>
<tr>
<td width="50%"><img src="docs/screenshots/order.png" alt="Order screen"><br><b>Order screen.</b> One tap per drink, options on the line, total for the POS.</td>
<td width="50%"><img src="docs/screenshots/queue.png" alt="Barista queue"><br><b>Barista queue.</b> Up next, Making, Ready. One tap each. Scan to collect.</td>
</tr>
<tr>
<td><img src="docs/screenshots/story-card.png" alt="Story card" width="38%" align="right"><b>Story card.</b> Generated on the guest's phone after pickup and shared with the native share sheet.</td>
<td><img src="docs/screenshots/report.png" alt="Daily sales report"><br><b>Daily sales.</b> Cups, totals, PayNow vs card, CSV per order for the POS.</td>
</tr>
<tr>
<td><img src="docs/screenshots/login.png" alt="Staff login"><br><b>Staff login.</b> Tablet keypad, separate barista and lead PINs.</td>
<td>
<img src="docs/screenshots/guest-making.png" alt="Guest status, making" width="48%">
<img src="docs/screenshots/guest-ready.png" alt="Guest status, ready" width="48%"><br>
<b>Guest status page.</b> Live progress, then a ready alert and a pickup QR.
</td>
</tr>
</table>

## ✨ What's inside

| | Module | Route | Highlights |
|---|---|---|---|
| 1 | **Order screen** | `/order` | Drink tiles with live sold-out state. Hot/iced and milk/oat chips on each line, with surcharges applied automatically. Large **Bill on POS** total. **Paid · PayNow / Paid · Card** (no cash) issues the number and guest QR. |
| 2 | **Barista queue** | `/queue` | Three lanes, one tap to advance, ages turn red after 10 min, undo/cancel under `⋯`, today's cups and average order-to-ready time. **Scan to collect** uses the tablet or laptop camera. |
| 3 | **Guest status page** | `/o/<token>` | Received, Making, **Ready to collect**. Chime, vibration, title flash, full-screen ready state and **Web Push**. Pickup QR for collection. Works on a patchy signal. |
| 4 | **Ready board** | `/board` | Full-screen TV stage: audio-reactive visuals, full-screen ready takeover, voice call-outs, live wait estimate, charity meter, now-serving ticker. |
| 5 | **Menu controls** | `/menu` | Prices, hot/iced, milk choice, sold-out toggles, iced and oat surcharges, add/remove drinks. Updates every tablet live, and edits made offline sync later. |
| 6 | **Daily sales report** | `/report` | KPIs, per-drink and per-hour breakdown, **CSV export** with one row per order to match the POS, **Close day** with a PDPA wipe. |
| + | Guest display | `/display` | Optional guest-facing second screen: latest order's number and QR, menu when idle. |
| + | Public menu | `/m` | Read-only live menu with sold-out marks. |
| + | **Live cockpit** | `/demo` | The whole booth on one screen with rush-hour, autopilot and wifi-kill controls. |

## 📶 Offline & sync

Hall wifi will drop. The booth keeps serving anyway.

- **Outbox first.** Every tap becomes an op `{uuid, type, timestamp, payload}` saved to the tablet *before* the screen updates. A dropped connection, a reload or a flat battery never loses an order.
- **One reducer everywhere.** [`public/shared/core.js`](public/shared/core.js) runs on the server *and* in every browser, so all devices compute the same state from the same ops.
- **Idempotent sync.** `POST /api/sync` accepts the outbox (retries never duplicate) and returns everything the device missed. Server-Sent Events push other tablets' changes in ~100 ms, with 3 s polling as fallback.
- **Deterministic conflicts.** Creation is first-write-wins on a UUID. Status and menu changes are last-writer-wins by timestamp, so a delayed "making" can never undo a newer "ready".
- **Collision-free numbers offline.** Each order station owns a number series (two tablets: odd / even). Numbers reset daily on Singapore time.
- **Visible state.** Header pill shows **Live** / **Offline, saved on device** / **N to sync**. ⚙ → *Simulate wifi drop* for drills and demos.

## 🔐 Personal data & PDPA

| Data | Why | Kept until |
|---|---|---|
| First name | Call-out and board | **Close day** wipes it on every device *and* in the on-disk log |
| Mobile (optional, ticked consent) | Reach the guest about this order only | Deleted when the order is collected or cancelled |
| Push subscription (opt-in) | "Ready" alert | Deleted on collection or close day |
| Items, time, amount, payment method | Sales report and POS tally | Kept (not personal) |

No surnames, emails or accounts. Payment details never touch this system; payments stay on the organiser's POS. CSV exports contain no names or mobiles. Guest links use a 128-bit random token, and there is no lookup by order number.

## 🚀 Quick start

```bash
git clone https://github.com/likalight/beans-beats-queue.git
cd beans-beats-queue
npm install
npm start          # http://localhost:3000
npm test           # end-to-end: sync, conflicts, CSV, PDPA wipe, restart
```

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Op log, keys, push subscriptions. **Persistent disk in production.** |
| `BARISTA_PIN` / `LEAD_PIN` | `1111` / `9999` | Staff PINs. **Change for the live event.** |
| `SESSION_SECRET` | auto | HMAC key for staff tokens (generated into `DATA_DIR`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | auto | Web Push keys |

## ☁️ Deployment

Needs **HTTPS** (service worker, push and camera access) and a **persistent disk**. Run a single instance.

- **Render (Singapore):** *New → Blueprint* → this repo. [`render.yaml`](render.yaml) creates a Starter service with a 1 GB disk at `/var/data`. Set `BARISTA_PIN` and `LEAD_PIN`.
- **Docker:** `docker build -t beans-beats-queue . && docker run -p 3000:3000 -v bbdata:/data -e BARISTA_PIN=… -e LEAD_PIN=… beans-beats-queue`

**At the booth:** open the site once per tablet on wifi and log in (caches everything for offline). Add to Home Screen. Set **⚙ → Order station number** on each order tablet. Put `/board` on the TV and tap once so it can chime. A 4G travel router as the booth's own network is recommended.

## 🔄 Resetting between event days

Order numbers restart at **001** automatically at midnight SGT.

At close, the booth lead opens **Sales → Download CSV**, then **Close &lt;date&gt; and wipe guest data**. The same from a terminal:

```bash
LEAD_PIN=yyyy node scripts/reset-day.js --url https://your-app            # close today (SGT), saves CSV
LEAD_PIN=yyyy node scripts/reset-day.js 2026-11-26 --url https://your-app  # close a specific day
node scripts/reset-day.js --wipe-all    # after the dry run: stop server first, wipes all orders
```

After `--wipe-all`, tablets notice the new data epoch and drop their cached copies automatically.

## 🧱 Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node 22, plain `http`, append-only NDJSON op log | Nothing to break on event day: one process, one file, replayable |
| Realtime | Server-Sent Events + polling fallback | Survives proxies and flaky wifi |
| Client | Vanilla JS PWA, no build step | Loads fast on budget tablets, cached for offline |
| Alerts | Web Push (`web-push`), Web Audio, Vibration API | Lock-screen alert on Android, chime and flash everywhere |
| QR | `qrcode-generator`, `jsQR` + `BarcodeDetector` | Paperless ordering and camera collection |
| Brand | beans&beats' own mark, signal orange `#fa6105`, Alte Haas Grotesk (from [beansnbeats.com](https://beansnbeats.com)) | Looks like their booth, not a template |
| Stage | Canvas 2D + Web Audio analyser + `speechSynthesis` | Beat-reactive board and voice call-outs, all on-device |

```
server.js               HTTP, sync API, SSE, push, persistence, PII scrub
public/shared/core.js   reducer, conflict rules, reports, CSV (server + browser)
public/app.js           staff app: order, queue, board, display, menu, report, scanner
public/stage.js         board visuals, beat detection, voice, confetti
public/demo.html        live cockpit (four app copies + sync feed)
public/guest.*          guest status page, cup animation, ETA, alerts, pickup QR, story card
public/sw.js            offline shell + push notifications
scripts/reset-day.js    close a day / full wipe
test/smoke.js           end-to-end test
docs/                   technical summary, demo script, screenshots
```

## ⚠️ Known limitations

- If **every** device loses the network, the order and queue tablets can't see each other's new orders until one reconnects. Each keeps working on its own. Use a 4G router, or run order and queue on one tablet during an outage.
- iPhone lock-screen push needs iOS 16.4+ and *Add to Home Screen*. Otherwise the open page chimes and turns black.
- There is no POS integration, by design: the operator keys in the total, and the CSV is the reconciliation bridge.
- Shared PIN per role, single server instance.

<div align="center">
<br>

**All profits go to Singapore Red Cross Young Hearts.**<br>
Built for Beans&Beats × Christmas Together 2026 · Hall F, Marina Bay Sands · 26 to 29 Nov

</div>
