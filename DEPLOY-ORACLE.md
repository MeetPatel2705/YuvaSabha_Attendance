# Deploying to Oracle Cloud (Always Free)

A genuinely free-forever alternative to Render/Railway (see `DEPLOY.md`): an
Oracle Cloud "Always Free" VM that you manage yourself, fronted by a
permanent **Cloudflare Tunnel** for HTTPS — the same `cloudflared` tool
already used for Saturday testing (`TESTING.md`), just running as a
long-lived service instead of a one-off quick tunnel.

Why this combination:
- The VM's disk is real, persistent storage — none of the ephemeral-disk
  problems `DEPLOY.md` warns about for Render/Railway's free tiers.
- Cloudflare Tunnel makes an *outbound* connection from the VM to
  Cloudflare's edge, which terminates HTTPS. **No inbound ports need to be
  opened** in Oracle's Security List or the VM's firewall beyond SSH — this
  sidesteps Oracle's notoriously fiddly default networking rules entirely.
- Since a bare IP with a self-signed cert won't reliably satisfy
  `navigator.geolocation` on members' phones, and a random `trycloudflare.com`
  URL changes every restart, you still need *some* stable hostname pointed at
  Cloudflare. Step 0 covers getting one for free.

## Step 0 — a free subdomain delegated to Cloudflare (do this first; can take up to ~48h to clear)

This is the slowest part, so kick it off before anything else and do the
Oracle VM setup while it's pending.

1. Create a free Cloudflare account.
2. In the Cloudflare dashboard, "Add a domain" and enter the subdomain you
   want to use, e.g. `yourname.is-a.dev` — Cloudflare treats it as its own
   zone even though it's technically a subdomain of someone else's domain;
   this is a well-established pattern for exactly this use case.
3. Cloudflare gives you two nameservers to use for that zone.
4. Go to the **is-a.dev** project on GitHub and follow *their current*
   registration process to request `yourname.is-a.dev` with an NS record
   pointing at those two Cloudflare nameservers (their docs have an example
   for this "delegate to your own DNS provider" case). Submit it as they
   instruct; a maintainer merges it, typically within a day or two.
   - Their exact submission process may have changed since I can't browse it
     live — read their repo's current README before you submit.
   - Fallback if is-a.dev isn't workable: **eu.org** is a similarly
     long-running free-subdomain registrar that also supports NS delegation.
   - Easiest fallback of all: buying a cheap domain (often $1-3 for the first
     year from any registrar) skips this whole step and its wait time.
5. Once merged and propagated, the zone should show "Active" in Cloudflare.

## Phase 1 — create the Always Free VM

1. Sign up for Oracle Cloud (Always Free tier) if you haven't already.
2. **Compute → Instances → Create Instance.**
   - Image: Ubuntu, latest LTS (22.04 or 24.04).
   - Shape: try the Ampere **`VM.Standard.A1.Flex`** first (Always Free, up
     to 4 OCPU / 24GB total — comfortably use 1 OCPU / 6GB for this app).
     Oracle's ARM Always Free capacity is frequently unavailable
     ("Out of host capacity") in a given region — a well-known, common quirk,
     not something wrong with your account. If that happens, fall back to
     **`VM.Standard.E2.1.Micro`** (AMD/x86_64, 1 OCPU / 1GB, also Always
     Free) — tighter on RAM, which is why Phase 3 builds the client locally
     rather than on the VM.
   - Networking: default VCN/subnet is fine; a public IP is assigned
     automatically.
   - SSH keys: generate or reuse a keypair and attach the public key at
     creation — Oracle images use key-based SSH login, not passwords.
3. Wait for "Running" and note the public IP.

## Phase 2 — first login and base packages

```bash
ssh ubuntu@<public-ip>
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v   # confirm >= 22.5 — server/package.json requires it for node:sqlite
```

## Phase 3 — get the app onto the VM

The real roster and Excel workbook are gitignored (see `README.md`), so they
travel by `scp`, never `git`.

```bash
# From your own machine:
git clone <your-repo-url> attendance   # or scp the whole folder up
cd attendance/client && npm run build  # build locally — keeps the (maybe 1GB) VM from doing it
```

```bash
scp -r client/dist ubuntu@<public-ip>:~/attendance/client/dist
scp "server/data/Yuva Sabha Harinagar.xlsx" ubuntu@<public-ip>:~/attendance/server/data/
scp server/scripts/members.seed.json ubuntu@<public-ip>:~/attendance/server/scripts/
```

On the VM:

```bash
cd ~/attendance/server
npm install --omit=dev
cp .env.example .env
nano .env   # set ADMIN_PASSWORD, a long random JWT_SECRET, NODE_ENV=production
npm run seed
```

Because this is a real VM disk (not Render/Railway's ephemeral free tier),
**you don't need `SQLITE_PATH` / `EXCEL_FILE_PATH` / `BACKUP_DIR` at all** —
the defaults under `server/data/` persist across reboots on their own.

## Phase 4 — run the server as a systemd service

`/etc/systemd/system/attendance.service`:

```ini
[Unit]
Description=Yuva Sabha Attendance server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/attendance/server
ExecStart=/usr/bin/node index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now attendance
sudo systemctl status attendance
curl localhost:4000/api/health   # {"ok":true}
```

## Phase 5 — permanent Cloudflare Tunnel

Once the zone from Step 0 shows "Active" in Cloudflare:

```bash
# arch is arm64 or amd64, matching the shape you picked in Phase 1
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-<arch>.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel login          # opens a link — authorize in a browser, pick the zone
cloudflared tunnel create yuva-sabha
```

Note the tunnel ID it prints and the credentials file it writes to
`~/.cloudflared/<tunnel-id>.json`.

`~/.cloudflared/config.yml`:

```yaml
tunnel: yuva-sabha
credentials-file: /home/ubuntu/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: yourname.is-a.dev
    service: http://localhost:4000
  - service: http_status:404
```

```bash
cloudflared tunnel route dns yuva-sabha yourname.is-a.dev
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## Phase 6 — verify

- `https://yourname.is-a.dev/api/health` → `{"ok":true}`
- Log into `/admin/login`.
- Re-run `TESTING.md`'s Saturday checklist, but against this permanent URL
  instead of a one-off `trycloudflare.com` link.

## Maintenance

- **Deploy an update**: `git pull`, rebuild the client (locally + `scp`, or
  on the VM directly if you're on the roomier ARM shape), then
  `sudo systemctl restart attendance`.
- **Backups**: unchanged from how the app already works — the nightly
  10:10 PM IST cron and the "Backup now" button write to real persistent
  disk now, so none of `DEPLOY.md`'s ephemeral-disk warnings apply here.
- **Logs**: `sudo journalctl -u attendance -f` and
  `sudo journalctl -u cloudflared -f`.
