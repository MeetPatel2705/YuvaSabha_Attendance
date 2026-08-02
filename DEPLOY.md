# Deploying

Since the Postgres migration (2026-08), the app stores **all data in a hosted
Postgres database** (`DATABASE_URL`) — nothing important lives on the app
host's disk anymore, which is what makes free ephemeral-disk hosts (Render's
free tier) safe to use. The Excel download is generated on the fly from the
database on every request, newest week first; there is no synced file, no
scheduled jobs, and no on-disk backups to manage (Neon's own snapshots cover
the database).

Current production layout:

- **Database**: Neon free tier (or any hosted Postgres) — the one component
  that must never be swapped casually; it holds everything.
- **Backend**: Render free tier web service, root directory `server/`, build
  `npm install`, start `npm start`.
- **Frontend**: Vercel, root directory `client/` (Vite preset), with
  `VITE_API_BASE_URL` pointing at the Render URL. `client/vercel.json`
  rewrites all non-`/api` paths to the SPA.

The app also still runs as a single combined process (server serves
`client/dist`) for local use: build the client, then `node server/index.js`.

## Required environment variables (server)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (from Neon). Required — the server won't boot without it. |
| `ADMIN_PASSWORD` | Initial admin password. Once changed from the admin panel, the hash lives in the database and this env var is ignored. |
| `JWT_SECRET` | Long random string signing the admin session cookie. |
| `PORT` | Defaults to 4000; most hosts inject this automatically. |
| `NODE_ENV=production` | Enables `secure` + `sameSite:'none'` cookies (required for the cross-site admin cookie; needs HTTPS on both ends). |
| `CLIENT_ORIGIN` | The exact Vercel URL — locks CORS to it and makes the cross-site admin cookie work. |
| `MEMBERS_SEED_JSON` | Optional safety net: seeds the roster into a brand-new empty database at boot (no-op once members exist). Content of `server/scripts/members.seed.json`. |

Client build-time env var: `VITE_API_BASE_URL` = the Render backend URL.

**HTTPS is mandatory** — `navigator.geolocation.getCurrentPosition()` is
blocked over plain HTTP everywhere except `localhost`. Vercel and Render both
provide it by default.

## Real member data isn't in this repo

`server/scripts/members.seed.json` is gitignored on purpose (real names and
phone numbers; public repo). A sanitized `*.example.json` with the same
structure ships in the repo. In production the roster lives in Postgres; the
seed file/env var only matters for bootstrapping an empty database.

## Migrating data from the old SQLite deployment

One-time, already done for production, kept for reference:

```bash
cd server
node scripts/migrateSqliteToPg.js path/to/attendance.sqlite
```

Refuses to run against a Postgres that already has members.

## Free-tier behavior

Render's free tier spins the service down after ~15 min idle; the first
request after that takes ~30-60s to wake it. Data is unaffected (it's in
Neon). `.github/workflows/keep-alive.yml` pings `/api/health` daily at
20:55 IST (repo variable `APP_URL` = the Render URL) so the service is warm
before the 9 PM check-in window.

## Timezone

The server doesn't need to run in IST — `server/lib/istTime.js` explicitly
converts to `Asia/Kolkata` regardless of host timezone.

## Mandir geofence

Hardcoded in `server/lib/geofence.js` (`MANDIR_LAT` / `MANDIR_LNG`) — not an
env var, per the "won't change" assumption in the spec. If the venue ever
changes, edit that file and redeploy.

## Historical notes

`DEPLOY-REPLIT.md` and `DEPLOY-ORACLE.md` describe superseded free-hosting
attempts from the SQLite era and no longer reflect how the app works — kept
only as history. (Replit's free workspace URL turned out to be tied to an
open editor session; Oracle signup card verification failed repeatedly; the
Postgres migration made both unnecessary.)
