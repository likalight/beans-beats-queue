# 3-minute demo video script

Setup: the deployed URL is open in three windows, side by side if possible:
(A) order tablet (logged in as lead `9999`), (B) barista queue (the same login on another device or browser profile), (C) a phone, or Chrome DevTools in phone mode, for the guest. Put (D) `/board` on a second monitor or tab.

| Time | Show | Say |
|---|---|---|
| 0:00 | Ready board (D) | "Beans&Beats' charity booth at Christmas Together. Guests know the moment their drink is ready, with no app and no receipts." |
| 0:15 | (A) Order screen: tap Flat White → Iced → Oat, type "Mei" | "The barista keys the order at the counter: one tap per drink, options on the line. The POS operator just keys in this total, $10." |
| 0:35 | Tap **Paid · PayNow** → number 001 + QR | "The order gets a number. The guest scans the QR straight off the tablet." |
| 0:45 | (C) Scan / open link → Order 001, Received. Tap **Turn on ready alert** | "Live status, and alerts on." |
| 1:00 | (B) Queue: 001 appears instantly. Tap **Start making** | (C) and (D) update to *Making*. |
| 1:15 | **Wifi drop:** on (A) turn on ⚙ → *Simulate wifi drop*, or DevTools → Network → Offline, or switch wifi off | "The hall wifi drops." Pill turns red: *Offline · saved on device*. |
| 1:25 | (A) Take a second order "Jon", latte, Card → 002 | "We keep taking orders. They're saved on the tablet, shown as *syncing*." |
| 1:40 | Reconnect (untick / back online) | Pill shows *2 to sync* → *Live*. 002 appears on (B). "Everything syncs on its own and nothing is lost or duplicated." |
| 1:55 | (B) Tap **Ready** on 001 | (C) phone turns black, chimes, vibrates, push notification. (D) board shows **001 Mei** under *Ready to collect* with a chime. |
| 2:15 | (B) **Scan to collect** → point camera at (C)'s pickup QR | "Mei shows her phone; the camera confirms it's the right drink and marks it collected." |
| 2:30 | Menu: toggle Pourover **Sold out** | "The booth lead can change prices or sell-outs live; the order screen updates on every tablet." |
| 2:40 | Report → **Download CSV** → open | "Cups and totals per day, PayNow vs card, one row per order to tick off against the POS. No names in the export." |
| 2:50 | Report → *Close day* text | "At close, guest names are wiped everywhere, per PDPA. Numbers restart at 001 tomorrow. All profits go to Singapore Red Cross Young Hearts." |
