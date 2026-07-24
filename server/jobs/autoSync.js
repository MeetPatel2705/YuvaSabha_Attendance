const cron = require('node-cron');
const { getIstNow } = require('../lib/istTime');
const { getCheckinWeekday, resolveAttendanceDate } = require('../lib/settings');
const { syncDateToExcel } = require('../lib/excelSync');

// Runs every day at 22:05 IST (right after the 9-10 PM check-in window would
// close) and only actually syncs if today is the currently configured
// Yuva Sabha weekday — checked at fire time rather than baked into the cron
// expression, so an admin rescheduling the day takes effect immediately
// without a restart. Syncs whichever date the check-ins were actually
// recorded under (see resolveAttendanceDate), so a rescheduled session synced
// under its stand-in Saturday still lands in the right place.
//
// A safety net rather than the primary sync path — checkin.js and
// adminAttendance.js already queue a sync after every check-in/delete (see
// queueSyncDateToExcel in lib/excelSync.js), which is what actually keeps
// the workbook current on a host that sleeps when idle, since this cron
// can't fire if the process isn't alive at 10:05 PM. This still catches
// anything that slipped through (e.g. a transient per-check-in sync failure).
function scheduleAutoSync() {
  cron.schedule(
    '5 22 * * *',
    async () => {
      const istNow = getIstNow();
      if (istNow.weekday !== getCheckinWeekday()) return;
      const attendanceDate = resolveAttendanceDate(istNow);
      try {
        const result = await syncDateToExcel(attendanceDate);
        console.log(`[autoSync] Synced ${attendanceDate}: ${result.presentCount} present.`);
      } catch (err) {
        console.error(`[autoSync] Failed to sync ${attendanceDate}:`, err);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );
}

module.exports = { scheduleAutoSync };
