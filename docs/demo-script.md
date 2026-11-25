# 3-minute demo video script

Setup: the deployed URL is open in three windows, side by side if possible:
(A) order tablet (logged in as lead `3456` on the live site, `9999` locally), (B) barista queue (the same login on another device or browser profile), (C) a phone, or Chrome DevTools in phone mode, for the guest. Put (D) `/board` on a second monitor or tab.

| Time | Show | Say |
|---|---|---|
| 0:00 | Ready board (D) | "Beans&Beats' charity booth at Christmas Together. Guests know the moment their drink is ready, with no app and no receipts." |
| 0:15 | (A) Order screen: tap Flat White → Iced → Oat, type "Mei" | "The barista keys the order at the counter: one tap per drink, options on the line. The POS operator just keys in this total, $10." |
| 0:35 | Tap **PayNow**, then **Send to bar** to get order 001 | "Give the guest their order number. Staff can share the tracking link or show a QR if requested." |
| 0:45 | (C) Open the tracking link. Tap **Turn on notifications** | "The guest can follow the order and get a ready notification." |
| 1:00 | (B) Queue: 001 appears instantly. Tap **Start making** | (C) and (D) update to *Making*. |
| 1:15 | **Wifi drop:** on (A) turn on ⚙ → *Simulate wifi drop*, or DevTools → Network → Offline, or switch wifi off | "The hall wifi drops." Pill turns red: *Offline · saved on device*. |
| 1:25 | (A) Take a second order "Jon", latte, Card → 002 | "We keep taking orders. They're saved on the tablet, shown as *syncing*." |
| 1:40 | Reconnect (untick / back online) | The sync notice clears and 002 appears on (B). |
| 1:55 | (B) Tap **Ready** on 001 | (C) phone shows *Ready to collect* and sends enabled alerts. (D) board shows **001 Mei** under *Ready to collect* with a chime if sound is enabled. |
| 2:15 | (B) Tap **Collected** on 001 | "Mei gives her order number. Tap **Collected** once the drink is handed over." |
| 2:30 | Menu: toggle Pourover **Sold out** | "The booth lead can change prices or sell-outs live; the order screen updates on every tablet." |
| 2:40 | Report → **Download CSV** → open | "Cups and totals per day, PayNow vs card, one row per order to tick off against the POS. No names in the export." |
| 2:50 | Report → *Close day* text | "At close, guest names are wiped everywhere, per PDPA. Numbers restart at 001 tomorrow. All profits go to Singapore Red Cross Young Hearts." |
