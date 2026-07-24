# Yuva Sabha Attendance

Self check-in attendance system for the weekly Yuva Sabha (Saturdays, 9-10 PM
IST, Harinagar mandir). Members check in themselves via a geofenced,
time-windowed public form; an authenticated admin panel handles oversight,
admin-assisted check-ins, and syncing attendance into the existing Excel
sheet.

- `server/` — Express API, SQLite (via Node's built-in `node:sqlite`), exceljs
  sync, node-cron auto-sync.
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
cp "data/Yuva Sabha Harinagar.example.xlsx" "data/Yuva Sabha Harinagar.xlsx"
npm run seed            # one-time: loads members from scripts/members.seed.json
npm run dev              # http://localhost:4000
```

(To run against the real roster instead, place the real `members.seed.json`
and `Yuva Sabha Harinagar.xlsx` in the same locations — both are gitignored,
so they're never picked up by git regardless of which one is present.)

```bash
cd client
npm install
npm run dev              # http://localhost:5173, proxies /api to :4000
```

Geolocation requires HTTPS in production, but works over plain `localhost`
for local testing.

## Data model notes

- `server/data/Yuva Sabha Harinagar.xlsx` is the real, already pre-built
  attendance workbook (weekly columns already laid out for the whole year).
  On first sync, the app copies it to `server/data/attendance-live.xlsx` (or
  `EXCEL_FILE_PATH`) and syncs into that copy from then on — the original
  file is never modified. To start a new year's sheet, replace this file with
  the new template and delete `attendance-live.xlsx` so it gets recopied.
- `server/scripts/members.seed.json` is the real member list extracted from
  that workbook (name, mobile, gender, and the exact Excel row each member
  occupies, needed so sync writes land in the right row) — only used for the
  one-time `npm run seed`. Day-to-day adding/editing/removing members is done
  from the admin panel's "Members" panel, which also keeps each member's
  Excel row in sync.
- Both real files above contain real names and phone numbers, so both are
  gitignored — this repo is public and that data shouldn't be. Sanitized
  stand-ins with the same structure (fake names, `900000000X` numbers) live
  at `server/scripts/members.seed.example.json` and
  `server/data/Yuva Sabha Harinagar.example.xlsx` for anyone setting up a
  fresh environment. The real files stay on the machines that run this for
  the actual mandir and are never pushed.

See `DEPLOY.md` for hosting notes.
