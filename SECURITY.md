# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Email **general@beansnbeats.com** with the subject `security: beans-beats-queue`, or use GitHub's *Report a vulnerability* (private advisory) on this repository. We aim to reply within 72 hours, and sooner during the event (26 to 29 Nov 2026).

## Scope and design notes

- Staff authenticate with a role PIN and get an HMAC-signed token that expires after 7 days. Set `BARISTA_PIN` and `LEAD_PIN` in production; the defaults are public.
- Guest pages are reachable only by a 128-bit random token. There is no lookup by order number or name.
- The server stores first names (wiped at day close) and optional mobiles with consent (wiped at pickup). No payment data is ever handled.
- Wrong PINs are delayed by 600 ms. Put the app behind HTTPS, which hosting platforms provide by default.
- Upstash credentials and VAPID private keys are secrets: keep them in the host's environment, never in the repo.
