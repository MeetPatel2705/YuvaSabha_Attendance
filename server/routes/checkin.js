const express = require('express');
const { query } = require('../db');
const { getIstNow, isCheckinDay, isWithinCheckinWindow, isBeforeStatusDisplayCutoff } = require('../lib/istTime');
const { distanceFromMandirMeters, isWithinGeofence, RADIUS_METERS } = require('../lib/geofence');
const { getCheckinWeekday, WEEKDAY_LABELS, resolveAttendanceDate } = require('../lib/settings');

const router = express.Router();

// Lets the page restore the success screen when someone reopens it after
// already checking in today (from this device). The record itself is
// permanent, but the screen only shows it up to the 10:30 PM grace cutoff —
// after that it reverts, even though the attendance stays recorded.
router.get('/status', async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required.' });
    }
    const istNow = getIstNow();
    const attendanceDate = await resolveAttendanceDate(istNow);
    const { rows } = await query(
      `SELECT m.name, a.date FROM attendance a JOIN members m ON m.id = a.member_id
       WHERE a.date = $1 AND a.device_id = $2 AND a.source = 'self-checkin'`,
      [attendanceDate, deviceId]
    );
    const existing = rows[0];
    if (!existing || !isBeforeStatusDisplayCutoff(istNow)) {
      return res.json({ checkedIn: false });
    }
    res.json({ checkedIn: true, name: existing.name, date: existing.date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { memberId, deviceId, lat, lng } = req.body || {};

    if (!memberId || !deviceId || typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'Missing memberId, deviceId, or GPS coordinates.' });
    }

    const memberResult = await query('SELECT id, name FROM members WHERE id = $1', [memberId]);
    const member = memberResult.rows[0];
    if (!member) {
      return res.status(400).json({ error: 'Unknown member selected.' });
    }

    const istNow = getIstNow();
    const checkinWeekday = await getCheckinWeekday();

    if (!isCheckinDay(istNow, checkinWeekday)) {
      return res.status(400).json({
        error: `Yuva Sabha attendance is only available on ${WEEKDAY_LABELS[checkinWeekday]}.`,
      });
    }

    if (!isWithinCheckinWindow(istNow)) {
      return res.status(400).json({
        error: `Attendance is only open from 9:00 PM to 10:00 PM IST on ${WEEKDAY_LABELS[checkinWeekday].slice(0, -1)}.`,
      });
    }

    // Normally the same as istNow.date, but on a rescheduled week this points
    // at the Saturday the session stands in for (see lib/settings.js), keeping
    // the weekly Saturday cadence the history and Excel export assume.
    const attendanceDate = await resolveAttendanceDate(istNow);

    const deviceCheck = await query(
      `SELECT id FROM attendance WHERE date = $1 AND device_id = $2 AND source = 'self-checkin'`,
      [attendanceDate, deviceId]
    );
    if (deviceCheck.rows[0]) {
      return res.status(400).json({
        error:
          'Attendance already marked from this device today. If another family member is present, please have an admin mark them present.',
      });
    }

    const distance = distanceFromMandirMeters(lat, lng);
    if (!isWithinGeofence(lat, lng)) {
      return res.status(400).json({
        error: `You appear to be more than ${RADIUS_METERS}m from the mandir, so we can't confirm you're on-site. Please have an admin mark you present instead.`,
      });
    }

    try {
      await query(
        `INSERT INTO attendance (member_id, date, checkin_time, source, device_id, distance_meters)
         VALUES ($1, $2, $3, 'self-checkin', $4, $5)`,
        [member.id, attendanceDate, new Date().toISOString(), deviceId, distance]
      );
    } catch (err) {
      if (String(err.message).includes('unique') || err.code === '23505') {
        return res.status(400).json({ error: 'This member has already been marked present today.' });
      }
      throw err;
    }

    res.json({ ok: true, name: member.name, date: attendanceDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
