const cron = require('node-cron');
const { runBackup } = require('../lib/backup');

// Runs once daily at 10:10 PM IST, right after the 9-10 PM check-in window
// closes — deliberately not the middle of the night. On a free host that
// sleeps when idle (Replit, Render), the server is only reliably awake
// because of real check-in traffic during that window (plus the 8:55 PM
// keep-alive ping — see .github/workflows/keep-alive.yml); a 3 AM schedule
// would need its own separate wake-up ping to ever actually fire, since
// node-cron can't run while the process is asleep. Piggybacking on the same
// window real traffic already keeps awake avoids needing that.
//
// Five minutes after the Excel auto-sync (jobs/autoSync.js, 22:05) on
// purpose — same reasoning, staggered so the two don't both hit the
// database/filesystem in the same moment.
function scheduleBackup() {
  cron.schedule(
    '10 22 * * *',
    () => {
      try {
        const backupPath = runBackup();
        console.log(`[backup] Wrote ${backupPath}`);
      } catch (err) {
        console.error('[backup] Failed:', err);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );
}

module.exports = { scheduleBackup };
