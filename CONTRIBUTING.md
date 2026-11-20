# Contributing

Thanks for helping keep the queue on the beat. This guide covers how to run the app, the few rules that keep offline sync correct, and what a good PR looks like.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000, restarts on server changes
npm run test:all   # must pass before you open a PR
```

The client has no build step. Edit files in `public/` and reload. The service worker serves the network first, so a normal reload picks up changes. Bump `VERSION` in `public/sw.js` when you change cached files, so tablets get the new shell.

## The rules that keep sync correct

1. **Every change is an op.** UI code never mutates state directly. It creates an op `{opId, type, at, device, payload}`, puts it in the outbox, and lets the reducer apply it.
2. **The reducer is shared.** `public/shared/core.js` runs on the server and in browsers. It must stay deterministic: no `Date.now()`, randomness or I/O inside `apply`.
3. **Ops are idempotent and order-tolerant.** Applying the same op twice, or receiving ops late, must give the same state. Status only moves forward.
4. **New op types** need an entry in `ROLE_OPS` (who may send it) and validation in `validOp` in `server.js`.
5. **Personal data** (names, mobiles) must be dropped by `day.close` and scrubbed from the log by `scrubPII`. Never add personal data to the CSV export.

## Style

- Plain modern JavaScript, two-space indent, single quotes, semicolons.
- No new runtime dependencies without a strong reason, because the booth runs on budget tablets and flaky wifi.
- UI copy is short and written for someone holding a milk jug. Test at 390 px wide and on a 1280×800 tablet.

## Pull requests

- Keep each PR to one change. Say what it changes for the **counter**, the **bar**, the **guest** or the **lead**.
- Add or extend a test in `test/` for any server or reducer change.
- Include a screenshot for UI changes.

## Reporting bugs

Open an issue with steps to reproduce, the device and browser, and whether the device was online. For security problems, see [SECURITY.md](SECURITY.md) instead.
