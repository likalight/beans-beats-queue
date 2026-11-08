# Beans&Beats × Christmas Together 2026 · Queue Management System

**Live app:** https://beans-beats-queue.onrender.com  
**Demo video (3 min):** https://REPLACE-WITH-VIDEO-LINK  
**Technical summary (PDF):** [docs/technical-summary.pdf](docs/technical-summary.pdf)

**Test logins** (staff PIN screen at `/`):

| Role | PIN | Can use |
|---|---|---|
| Barista | `1111` | Order screen, Barista queue, Ready board, Guest display, Scan to collect |
| Booth lead | `9999` | Everything above, plus Menu controls, Daily sales report, Close day |

Guests need no login: they scan the QR shown on the order tablet (or on the guest display) after ordering.

---

## What it does

An offline-first order and pickup system for the Beans&Beats charity coffee booth (Hall F, Marina Bay Sands, 26–29 Nov 2026). Guests order and pay at the counter. The barista keys the order into a tablet and the guest scans a QR code to follow their drink live. Their phone alerts them when it's ready, and they show a pickup QR that the barista scans to hand over the right drink. No app download and no paper receipts.

| # | Module | URL | Notes |
|---|---|---|---|
| 1 | **Order screen** | `/order` | One tap per drink. Hot/iced, milk/oat and qty are set on the order line. First name is required; mobile is optional and needs consent. The large **Bill on POS** total is what the POS operator keys in. **Paid · PayNow** / **Paid · Card** places the order (no cash). It then shows the order number and a QR to turn towards the guest. |
| 2 | **Barista queue** | `/queue` | Three columns: Up next → Making → Ready. One tap for **Start making**, one tap for **Ready**, one tap for **Collected**. Long waits turn red. Undo and cancel are under `⋯`. **Scan to collect** opens the tablet/laptop camera. |
| 3 | **Guest status page** | `/o/<token>` | Shows Received → Making → **Ready to collect**. On ready the page turns black, plays a chime, vibrates, flashes the tab title and sends a Web Push notification if the guest enabled alerts. Shows a pickup QR. |
| 4 | **Ready board** | `/board` | Full-screen black board for a TV at the booth: *Ready to collect* (number + first name) and *Making*. It chimes when a new order turns ready. |
| 5 | **Menu controls** | `/menu` (lead) | Edit names and prices, set hot/iced and milk-choice per drink, toggle **Sold out**, change the iced and oat surcharges, add or delete drinks. Changes reach every tablet live and also work offline. |
| 6 | **Daily sales report** | `/report` (lead) | Cups, orders, total, PayNow vs card, per-drink breakdown and cups per hour. The **CSV export** has one row per order to match each POS transaction, plus drink lines and a summary. **Close day** wipes guest data. |
| + | Guest display | `/display` | Optional second, guest-facing screen. It shows the latest order's number and QR (paperless), and today's menu when idle. |
| + | Public menu | `/m` | Read-only live menu with sold-out marks, linked from the guest page. |

Starting menu (editable live): Espresso $3 (hot only), Americano $6, Latte $8, Flat White $8, Pourover $10. Iced is +$1 and oat milk is +$1. Espresso, Americano and Pourover have no milk option.

## Setup (local)

Requires Node.js 20+ (22 recommended).

```bash
npm install
npm start            # http://localhost:3000
npm test             # end-to-end smoke test (sync, conflicts, CSV, PDPA wipe)
```

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the op log, VAPID keys and push subscriptions live. **Must be a persistent disk in production.** |
| `BARISTA_PIN` | `1111` | Barista PIN. **Change for the live event.** |
| `LEAD_PIN` | `9999` | Booth lead PIN. **Change for the live event.** |
| `SESSION_SECRET` | auto-generated in `DATA_DIR/secrets.json` | HMAC key for staff session tokens |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | auto-generated | Web Push keys (optional override) |

## Deployment

The server is a single Node process with one dependency for Web Push, plus two small vendored browser libraries (QR generator, QR reader). It needs **HTTPS**, because service workers, push and camera access only work over HTTPS, and a **persistent disk**.

**Render (recommended, Singapore region):** push this repo to GitHub → Render → *New → Blueprint* → select the repo. `render.yaml` provisions a Singapore web service with a 1 GB disk at `/var/data`. Set `BARISTA_PIN` and `LEAD_PIN` when prompted.

**Docker anywhere (Fly.io, Railway, a VPS):**

```bash
docker build -t beans-beats-queue .
docker run -p 3000:3000 -v bbdata:/data -e BARISTA_PIN=xxxx -e LEAD_PIN=yyyy beans-beats-queue
```

Mount a volume at `/data`. Run **one instance only**, because state lives in that process and its disk.

**At the booth:** open the site once on each tablet while on wifi and log in. This caches the app and data for offline use. Then *Add to Home Screen* for a full-screen app. Set **⚙ → Order station number** on each order tablet; with two tablets, #1 issues odd numbers and #2 even ones, so numbers never clash offline. Put `/board` on the TV (tap once so the chime can play).

## Resetting between event days

Order numbers restart at **001 automatically** at midnight Singapore time, so there is nothing to do for numbering.

At the end of each day, the booth lead goes to **Report → Download CSV** and then **Close <date> and wipe guest data**. This marks any leftover orders collected and permanently deletes that day's names and mobiles on every tablet and on the server, including rewriting the log on disk. Sales figures are kept.

The same from a terminal:

```bash
LEAD_PIN=yyyy node scripts/reset-day.js --url https://your-app            # closes today (SGT), saves CSV
LEAD_PIN=yyyy node scripts/reset-day.js 2026-11-26 --url https://your-app  # a specific day
```

**Full wipe after the dry run (week of 16 Nov):** stop the server, then run:

```bash
node scripts/reset-day.js --wipe-all
```

Then start the server again. All orders are removed and the menu is re-seeded; PINs and push keys are kept. Tablets detect the new data "epoch" and drop their cached copy by themselves. The old log is kept as `ops.ndjson.bak-*` and should be deleted once it's no longer needed, since it contains names.

## How offline and sync work (short version)

- Every action (new order, status tap, menu edit, close day) becomes an **op** with a client UUID and timestamp. It is saved to the tablet's **outbox** in localStorage *before* the screen updates, so a dropped connection or a reload never loses an order.
- The screen shows `server state + pending ops`, applied by the **same reducer** (`public/shared/core.js`) the server uses.
- A sync loop POSTs the outbox to `/api/sync`, which is idempotent by op id, and pulls any ops it missed. Server-Sent Events push other tablets' changes within about 100 ms. Polling every 3 s is the fallback.
- Conflicts converge deterministically: order creation is first-write-wins (UUIDs); status and menu fields are last-writer-wins on timestamp, so a delayed "making" can't undo a newer "ready". Order numbers come from per-station number series, so two offline tablets never issue the same number.
- The header pill shows **Live**, **Offline · saved on device** or **N to sync**. ⚙ → *Simulate wifi drop* reproduces an outage for demos and drills.
- The guest page carries a snapshot of the order in the URL fragment (never sent to the server), so it renders even before the order tablet has synced.

See [docs/technical-summary.pdf](docs/technical-summary.pdf) for the architecture, PDPA handling and known limitations.

## PDPA in one paragraph

We collect only a **first name** (to call out the order) and, optionally, a **mobile number**, which needs a ticked consent and is used only to reach the guest about that order. Mobiles are deleted when the order is collected or cancelled. Names are deleted at **Close day**. Nothing personal goes into CSV exports or to the POS. Payment details never touch this system. Guest pages use an unguessable 128-bit token and never show other guests' data. Contact: general@beansnbeats.com.

## Project layout

```
server.js               HTTP server, sync API, SSE, push, persistence, PII scrub
seed-menu.js            starting menu (first boot only)
public/shared/core.js   shared reducer, conflict rules, report + CSV (server & browser)
public/app.js           staff app: order, queue, board, guest display, menu, report, scanner
public/guest.html/.js   guest status page + alerts + pickup QR
public/menu.html        public read-only menu
public/sw.js            service worker: offline shell, push notifications
scripts/reset-day.js    close a day / full wipe
test/smoke.js           end-to-end test
docs/                   technical summary (PDF + HTML source), demo script
```
