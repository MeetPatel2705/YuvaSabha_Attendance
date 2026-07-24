# Deploying

By default the app is a single Express process: it serves the API under
`/api/*` and the built React app as static files for everything else. Build
the client, then run the server.

```bash
cd client && npm install && npm run build   # outputs client/dist
cd ../server && npm install
```

Start command: `node server/index.js` (or `npm start` inside `server/`).

It can also be split across two origins instead (e.g. client on Vercel,
server on Render) — see "Frontend and backend on different origins" below
for the extra env vars that requires. `DEPLOY-REPLIT.md` and
`DEPLOY-ORACLE.md` cover free, combined-service alternatives if ephemeral
disk / split-origin complexity isn't worth it.

## Required environment variables (server)

| Var | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Initial admin password. Once changed from the admin panel's "Change password" button, the hash lives in the database and this env var is ignored — so it stops mattering after that, no need to keep it in sync. |
| `JWT_SECRET` | Long random string signing the admin session cookie. |
| `PORT` | Defaults to 4000; most hosts inject this automatically. |
| `NODE_ENV=production` | Enables `secure` cookies (requires HTTPS). |
| `SQLITE_PATH` | Optional. Where the SQLite file lives — point at a persistent volume/disk in production. |
| `BACKUP_DIR` | Optional. Where nightly (10:10 PM IST) and manual "Backup now" SQLite snapshots are written — same persistence requirement as above. Defaults to `server/data/backups/`. |
| `CLIENT_ORIGIN` | Required when the frontend is on a different origin than the backend (e.g. Vercel + Render) — locks CORS to that exact URL and is what makes the cross-site admin cookie work at all. Not needed when both are served from the same origin. |

**HTTPS is mandatory** — `navigator.geolocation.getCurrentPosition()` is
blocked over plain HTTP everywhere except `localhost`. Both Render and
Railway provide HTTPS on their default domains automatically.

## Real member data isn't in this repo

`server/scripts/members.seed.json` (the roster used by `npm run seed`) is
gitignored on purpose — it contains real names and phone numbers and this
repo is public. Deploying means placing the **real** version of this file at
that same path directly on the host (or the mounted persistent disk/volume)
— it will not arrive via git. A sanitized example with the same structure
ships in the repo (`*.example.json`) purely so the app is runnable out of
the box for anyone reading the code; don't deploy with that in production.

## Persistence — the one thing that will bite you

SQLite and the nightly backups are just files on disk. If the host wipes its
disk on every redeploy, attendance history and every backup snapshot
disappear together — and so does a changed admin password (it's stored in
the same SQLite file), silently falling back to whatever `ADMIN_PASSWORD` is
currently set to. A backup living on the same ephemeral disk as the database
it backs up isn't much of a backup, so this matters even more than it did
before backups existed.

### Render

Render's free tier disk is **ephemeral** — and more disruptively than just
"resets on deploy": the free instance spins down after ~15 minutes idle, and
spinning back up rebuilds the container from scratch, wiping the disk right
along with it. Since a low-traffic app like this one is idle most of the
week, that means the member roster and all attendance history realistically
reset every week, not as a rare edge case — the trend chart, absentee
tracking, and backups would never accumulate past a single session. Either:
- Add a [persistent disk](https://render.com/docs/disks) (paid) and set
  `SQLITE_PATH` / `BACKUP_DIR` to paths under the mounted disk (e.g.
  `/data/attendance.sqlite`), or
- Accept the weekly reset (fine for a one-off demo, not for actually
  tracking attendance over a season).

### Railway

Attach a [volume](https://docs.railway.app/reference/volumes) and point
`SQLITE_PATH` / `BACKUP_DIR` at paths inside it. Railway volumes persist
across deploys by default once attached.

## Frontend and backend on different origins (Vercel + Render)

If the client (Vercel) and server (Render) are on different domains, three
things matter beyond the usual env vars:

1. Set `CLIENT_ORIGIN` on the server to the exact Vercel URL (e.g.
   `https://your-app.vercel.app`) — CORS is locked to this, and the admin
   cookie won't be sent back cross-site otherwise (see `lib/adminAuth.js`,
   which switches `sameSite`/`secure` based on `NODE_ENV=production`).
2. Set `VITE_API_BASE_URL` at the client's build time to the Render
   backend's full URL (e.g. `https://your-app.onrender.com`) — see
   `client/src/lib/api.js`, which otherwise defaults to same-origin relative
   paths and would 404 against Vercel's own domain.
3. `NODE_ENV=production` must be set on the server — this is also what
   switches the admin cookie to `sameSite: 'none'` (required for it to be
   sent cross-site at all) and `secure: true` (mandatory alongside
   `sameSite: 'none'`, and needs HTTPS on both ends — which Vercel and
   Render both provide by default).

### Longer-term option

If persistent disk pricing/ops becomes annoying, migrating SQLite to a
hosted option like [Turso](https://turso.tech/) removes the disk dependency
entirely — not built here since a local file is simpler for now, but the
`server/db/index.js` module is the only place that would need to change.

## Timezone

The server doesn't need to run in IST — `server/lib/istTime.js` and the
backup job's `node-cron` schedule both explicitly convert to `Asia/Kolkata`
regardless of host timezone (Render/Railway default to UTC). After
deploying, check the logs around 9 PM and 10 PM IST on a Saturday once to
confirm the check-in window opens/closes at the right wall-clock time.

## Mandir geofence

Hardcoded in `server/lib/geofence.js` (`MANDIR_LAT` / `MANDIR_LNG`) — not an
env var, per the "won't change" assumption in the spec. If the venue ever
changes, edit that file and redeploy.
