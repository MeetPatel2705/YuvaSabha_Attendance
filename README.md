# Yuva Sabha Attendance

Self check-in attendance system for the weekly Yuva Sabha (Saturdays, 9-10 PM
IST, Harinagar mandir). Members check in themselves via a geofenced,
time-windowed public form; an authenticated admin panel handles oversight,
admin-assisted check-ins, and nightly database backups.

- `server/` — Express API, SQLite (via Node's built-in `node:sqlite`),
  node-cron backups.
- `client/` — React (Vite) frontend: public check-in form + admin panel.

## Local setup

The real community roster (names + mobile numbers) is never committed to
this repo — see "Data model notes" below. To run against sanitized test
data instead:

```bash
cd server
npm install
cp .env.example .env   # fill in ADMIN_PASSWORD and JWT_SECRET
cp scripts/members.seed.example.json scripts/members.seed.json
npm run seed            # one-time: loads members from scripts/members.seed.json
npm run dev              # http://localhost:4000
```

(To run against the real roster instead, place the real `members.seed.json`
in the same location — it's gitignored, so it's never picked up by git
regardless of which one is present.)

```bash
cd client
npm install
npm run dev              # http://localhost:5173, proxies /api to :4000
```

Geolocation requires HTTPS in production, but works over plain `localhost`
for local testing.

## Data model notes

- `server/scripts/members.seed.json` is the real member list used for the
  one-time `npm run seed` (name, mobile, gender). Day-to-day adding, editing,
  or removing members is done from the admin panel's "Members" panel, not by
  editing this file — it's only consulted the first time the database is
  empty.
- This file contains real names and phone numbers, so it's gitignored — this
  repo is public and that data shouldn't be. A sanitized stand-in with the
  same structure (fake names, `900000000X` numbers) lives at
  `server/scripts/members.seed.example.json` for anyone setting up a fresh
  environment. The real file stays on the machines that run this for the
  actual mandir and is never pushed.

See `DEPLOY.md` for hosting notes.
