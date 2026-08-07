# Saturday Mandir Test — Runbook

Goal: test the real system (real geofence, real 9-10 PM window, real phones)
from the mandir on Saturday, before deploying. Your laptop runs the server;
members' phones reach it through a temporary Cloudflare tunnel URL.

SQLite is the sole source of truth — there is no more trial-mode safety flag.
Every check-in during the real window writes for real, every time.

## Before leaving home (Saturday afternoon)

1. **Build the frontend** (so the backend serves the site on one URL):

   ```
   cd client
   npm run build
   ```

2. Make sure the laptop is charged / bring the charger. The laptop must stay
   on and online for the whole test — it IS the server.

## At the mandir (before 9 PM)

The laptop needs internet — mandir WiFi or your phone's hotspot both work.

Open two terminals:

**Terminal 1 — the server:**
```
cd server
node index.js
```
**Terminal 2 — the tunnel:**
```
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:4000
```

Within ~10 seconds it prints a URL like
`https://something-random.trycloudflare.com` — that's the link. It's a NEW
random URL every time the tunnel restarts, so share it fresh each session.

Quick sanity check on your own phone before sharing: open the URL, the
check-in page should load.

## The test (9:00-10:00 PM)

Share the URL in the members' WhatsApp group. Ask 3-4 members to:

1. Open the link on their own phone (each on their own phone — that's part
   of the test).
2. Allow location permission when asked.
3. Search their name, tap Present.

Watch for:
- [ ] Everyone physically at the mandir gets a success (Jay Shree
      Swaminarayan screen). If someone inside the hall gets the "more than
      100m" rejection, note it — indoor GPS drift; we may widen the radius
      further.
- [ ] A second person trying on an already-used phone gets the device-block
      message → mark them via admin panel instead.
- [ ] Before 9 PM / after 10 PM attempts get the time-window rejection.
- [ ] Admin panel (`<tunnel-url>/admin/login`) shows the present list
      growing live (refresh / change nothing — it reloads per date).

## Afterwards

- Ctrl+C both terminals (tunnel URL dies immediately — that's fine).
- If everything passed → deploy (see DEPLOY.md).

## Testing before Saturday

There's no bypass flag anymore — the public check-in form only ever accepts
real day/time/geofence conditions, on purpose, so there's nothing to remember
to turn off before the real test or before deploying.

To verify the app itself (UI, DB writes) ahead of Saturday without waiting
for the real window:
- Use the **admin panel's "Admin-assisted attendance"** form — it records a
  real attendance row for any member on any date, with no day/time/geofence
  check, so you can confirm the DB write and the dashboard work end-to-end.
- To see the actual public check-in page load and geolocation prompt, share
  a tunnel URL (Cloudflare or ngrok) and open it yourself — the day/time/geofence
  rejection messages are real and expected outside Saturday 9-10 PM at the
  mandir; that's confirming the gate works, not a failure.
