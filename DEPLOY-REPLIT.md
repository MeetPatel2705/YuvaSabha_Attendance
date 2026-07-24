# Deploying to Replit (free)

A simpler free option than the Oracle VM route in `DEPLOY-ORACLE.md`: Replit
gives you HTTPS on a `your-repl.your-username.repl.co` URL for free, out of
the box — no domain, no Cloudflare Tunnel, no reverse proxy to configure.

Why this is safe to use where Render's free tier wasn't: a Replit project's
filesystem is tied to your account and **persists across sleep/wake** —
unlike Render's free tier, which rebuilds the container from scratch on
every cold start. So SQLite, the member roster, and backups all survive a
repl going to sleep and waking back up. The one thing that still needs
handling is that it *does* sleep when idle (no "Always On" on the free
tier), hence the keep-alive ping below.

## 1. Create the Repl

- Import from your GitHub repo (if pushed) or upload the project folder
  directly — either works, since Replit gives real shell/file access
  (unlike Render, so there's no `scp` dance needed for the gitignored real
  files later).
- Pick a Node.js template/module. `server/package.json` requires
  **Node >= 22.5.0** for `node:sqlite` — check the Node version Replit
  assigns you (`node -v` in the Shell tab) and adjust the repl's Node module
  version if it's older.

## 2. Set Secrets

In the Secrets pane (padlock icon):

| Secret | Value |
|---|---|
| `ADMIN_PASSWORD` | your real initial admin password |
| `JWT_SECRET` | a long random string |
| `NODE_ENV` | `production` |

Don't set `SQLITE_PATH` / `BACKUP_DIR` — the defaults under `server/data/`
are fine since Replit's storage is already persistent.

## 3. First-time build, in the Shell tab

```bash
cd client && npm install && npm run build
cd ../server && npm install
```

## 4. Real data file

Since Replit gives you a real file editor and shell, just create/upload it
directly in the workspace with its real content (never via git — it stays
gitignored, same as any other deploy target):

- `server/scripts/members.seed.json` — then run `npm run seed` (from
  `server/`, one time)

## 5. Set the Run command

In `.replit`, point the run command at just starting the server — the build
already happened once in step 3 and persists, so there's no need to rebuild
on every wake (that would slow down exactly the wake-up the keep-alive ping
is trying to speed up):

```
run = "cd server && node index.js"
```

## 6. Verify

Open the repl's URL — `/api/health` should return `{"ok":true}`, and
`/admin/login` should work with the admin password from step 2.

## 7. Keep-alive ping

`.github/workflows/keep-alive.yml` (already in this repo) pings `/api/health`
every day at 20:55 IST, a few minutes before the 9 PM window, so the repl is
already awake instead of cold-starting on the first real check-in. Set the
`APP_URL` repository variable (GitHub repo Settings > Secrets and variables
> Actions > Variables) to your repl's URL once it's live.

This also benefits the 10:10 PM backup (`jobs/backup.js`) — it fires shortly
after the window closes, while the repl is still awake from real check-in
traffic, so it doesn't need its own separate wake-up ping.

## Caveats

- **Free-tier reliability** is more hobby-grade than a dedicated VM — fine
  for a once-a-week, one-hour community app, but not something to expect
  enterprise uptime from.
- **Redeploying an update**: pull the latest commit via Replit's Git pane
  (if imported from GitHub) or re-upload changed files, then rebuild the
  client (step 3) if `client/` changed, and restart the repl.
