const express = require('express');
const db = require('../db');
const { getIstNow, isCheckinDay, isWithinCheckinWindow, isBeforeStatusDisplayCutoff } = require('../lib/istTime');
const { distanceFromMandirMeters, isWithinGeofence, RADIUS_METERS } = require('../lib/geofence');
const { getCheckinWeekday, WEEKDAY_LABELS, resolveAttendanceDate } = require('../lib/settings');
const { queueSyncDateToExcel } = require('../lib/excelSync');

const router = express.Router();

const findMember = db.prepare('SELECT id, name FROM members WHERE id = ?');
const findDeviceToday = db.prepare(
  "SELECT id FROM attendance WHERE date = ? AND device_id = ? AND source = 'self-checkin'"
);
const findDeviceCheckinWithName = db.prepare(
  `SELECT m.name, a.date FROM attendance a JOIN members m ON m.id = a.member_id
   WHERE a.date = ? AND a.device_id = ? AND a.source = 'self-checkin'`
);
const insertAttendance = db.prepare(
  `INSERT INTO attendance (member_id, date, checkin_time, source, device_id, distance_meters)
   VALUES (?, ?, ?, 'self-checkin', ?, ?)`
);

// Lets the page restore the success screen when someone reopens it after
// already checking in today (from this device). The record itself is
// permanent, but the screen only shows it up to the 10:30 PM grace cutoff —
// after that it reverts, even though the attendance stays recorded.
router.get('/status', (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required.' });
  }
  const istNow = getIstNow();
  const attendanceDate = resolveAttendanceDate(istNow);
  const existing = findDeviceCheckinWithName.get(attendanceDate, deviceId);
  if (!existing || !isBeforeStatusDisplayCutoff(istNow)) {
    return res.json({ checkedIn: false });
  }
  res.json({ checkedIn: true, name: existing.name, date: existing.date });
});

router.post('/', (req, res) => {
  const { memberId, deviceId, lat, lng } = req.body || {};

  if (!memberId || !deviceId || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Missing memberId, deviceId, or GPS coordinates.' });
  }

  const member = findMember.get(memberId);
  if (!member) {
    return res.status(400).json({ error: 'Unknown member selected.' });
  }

  const istNow = getIstNow();
  const checkinWeekday = getCheckinWeekday();

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
  // at the Saturday the session stands in for (see lib/settings.js), so it
  // still lands in an existing Excel column when synced.
  const attendanceDate = resolveAttendanceDate(istNow);

  if (findDeviceToday.get(attendanceDate, deviceId)) {
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
    insertAttendance.run(member.id, attendanceDate, new Date().toISOString(), deviceId, distance);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'This member has already been marked present today.' });
    }
    throw err;
  }

  // Fire-and-forget — keeps the Excel copy current within seconds of each
  // check-in instead of waiting for the 10:05 PM auto-sync (see lib/excelSync.js).
  queueSyncDateToExcel(attendanceDate);

  res.json({ ok: true, name: member.name, date: attendanceDate });
});

module.exports = router;
