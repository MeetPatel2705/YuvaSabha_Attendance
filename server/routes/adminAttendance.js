const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../lib/adminAuth');
const { getIstNow } = require('../lib/istTime');
const { syncDateToExcel, queueSyncDateToExcel, ensureLiveWorkbook } = require('../lib/excelSync');
const { getRemark } = require('../lib/remarks');
const { runBackup } = require('../lib/backup');

const router = express.Router();
router.use(requireAdmin);

const findMember = db.prepare('SELECT id, name FROM members WHERE id = ?');
const insertAdminAttendance = db.prepare(
  `INSERT INTO attendance (member_id, date, checkin_time, source, device_id, distance_meters)
   VALUES (?, ?, ?, 'admin-assisted', NULL, NULL)`
);

router.get('/attendance', (req, res) => {
  const date = req.query.date || getIstNow().date;

  const present = db
    .prepare(
      `SELECT a.id, m.id AS memberId, m.name, a.source, a.checkin_time AS checkinTime
       FROM attendance a JOIN members m ON m.id = a.member_id
       WHERE a.date = ?
       ORDER BY m.name COLLATE NOCASE`
    )
    .all(date);

  const presentIds = new Set(present.map((p) => p.memberId));
  const absent = db
    .prepare('SELECT id, name FROM members ORDER BY name COLLATE NOCASE')
    .all()
    .filter((m) => !presentIds.has(m.id));

  res.json({ date, present, absent, remark: getRemark(date) });
});

// Present count per recorded date, oldest first — powers the admin trend
// chart. Counts both self-checkin and admin-assisted rows, same as the
// per-date view above.
router.get('/attendance/history', (_req, res) => {
  const weeks = db
    .prepare('SELECT date, COUNT(*) AS presentCount FROM attendance GROUP BY date ORDER BY date ASC')
    .all();
  res.json({ weeks });
});

const CHRONIC_ABSENTEE_STREAK = 3;
const RECENT_REPORT_SIZE = 5;

// Members who missed the last CHRONIC_ABSENTEE_STREAK-or-more recorded
// Saturdays in a row, most-missed first. "Recorded" dates are the distinct
// dates present in the attendance table (same universe the trend chart
// uses) — a Saturday nobody was ever marked present for isn't in that set,
// so it can't be counted as a miss either.
router.get('/attendance/absentees', (_req, res) => {
  const dates = db.prepare('SELECT DISTINCT date FROM attendance ORDER BY date DESC').all().map((r) => r.date);

  if (dates.length === 0) {
    return res.json({ dates: [], absentees: [] });
  }

  const members = db
    .prepare('SELECT id, name, mobile, created_at, last_reminded_at FROM members ORDER BY name COLLATE NOCASE')
    .all();
  const presentSet = new Set(
    db.prepare('SELECT member_id, date FROM attendance').all().map((r) => `${r.member_id}|${r.date}`)
  );
  const lastPresentByMember = new Map(
    db
      .prepare('SELECT member_id, MAX(date) AS lastDate FROM attendance GROUP BY member_id')
      .all()
      .map((r) => [r.member_id, r.lastDate])
  );

  const absentees = [];
  for (const member of members) {
    let streak = 0;
    for (const date of dates) {
      // Dates before the member joined aren't misses — they weren't on the
      // roster yet to be marked present or absent for them.
      if (member.created_at && date < member.created_at) break;
      if (presentSet.has(`${member.id}|${date}`)) break;
      streak += 1;
    }
    if (streak >= CHRONIC_ABSENTEE_STREAK) {
      // Oldest-to-newest, so it reads as a timeline in the reminder message —
      // same join-date rule as the streak above, so a recently added member
      // doesn't get shown as "absent" for Saturdays before they existed.
      const recentAttendance = dates
        .slice(0, RECENT_REPORT_SIZE)
        .filter((d) => !member.created_at || d >= member.created_at)
        .reverse()
        .map((d) => ({ date: d, present: presentSet.has(`${member.id}|${d}`) }));

      absentees.push({
        id: member.id,
        name: member.name,
        mobile: member.mobile,
        streak,
        lastPresent: lastPresentByMember.get(member.id) || null,
        lastReminded: member.last_reminded_at,
        recentAttendance,
      });
    }
  }
  absentees.sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name));

  res.json({ dates, absentees, threshold: CHRONIC_ABSENTEE_STREAK });
});

// Full member x date attendance matrix — an at-a-glance view directly on the
// site, same idea as scanning the synced Excel sheet by eye but without
// downloading it. Newest date first so it's visible without scrolling (the
// sticky name column is the only other fixed thing on screen). Same
// join-date rule as the absentees/history endpoints above: a cell for a
// date before the member existed is `null` (not yet a member), distinct
// from `false` (was a member, didn't attend).
router.get('/attendance/grid', (_req, res) => {
  const dates = db.prepare('SELECT DISTINCT date FROM attendance ORDER BY date DESC').all().map((r) => r.date);
  const members = db.prepare('SELECT id, name, created_at FROM members ORDER BY name COLLATE NOCASE').all();
  const presentSet = new Set(
    db.prepare('SELECT member_id, date FROM attendance').all().map((r) => `${r.member_id}|${r.date}`)
  );

  const grid = members.map((member) => ({
    id: member.id,
    name: member.name,
    attendance: dates.map((date) => {
      if (member.created_at && date < member.created_at) return null;
      return presentSet.has(`${member.id}|${date}`);
    }),
  }));

  res.json({ dates, members: grid });
});

router.post('/checkin', (req, res) => {
  const { memberId, date } = req.body || {};
  if (!memberId) {
    return res.status(400).json({ error: 'memberId is required.' });
  }

  const member = findMember.get(memberId);
  if (!member) {
    return res.status(400).json({ error: 'Unknown member selected.' });
  }

  const targetDate = date || getIstNow().date;

  try {
    insertAdminAttendance.run(member.id, targetDate, new Date().toISOString());
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'This member is already marked present for that date.' });
    }
    throw err;
  }

  queueSyncDateToExcel(targetDate);

  res.json({ ok: true, name: member.name, date: targetDate });
});

router.delete('/attendance/:id', (req, res) => {
  const row = db.prepare('SELECT date FROM attendance WHERE id = ?').get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Attendance record not found.' });
  }
  db.prepare('DELETE FROM attendance WHERE id = ?').run(req.params.id);
  // Keeps a removed check-in's ✔ from lingering in an already-synced column.
  queueSyncDateToExcel(row.date);
  res.json({ ok: true });
});

router.post('/sync', async (req, res) => {
  const date = req.query.date || req.body?.date || getIstNow().date;
  try {
    const result = await syncDateToExcel(date);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Downloads the live workbook (created from the template on first use, so
// this works even before the first sync has ever run).
router.get('/excel', (_req, res) => {
  const livePath = ensureLiveWorkbook();
  res.download(livePath, 'Yuva Sabha Harinagar.xlsx');
});

// On-demand database backup, on top of the nightly 10:10 PM auto-backup
// (see jobs/backup.js) — lets an admin snapshot the database right before a
// risky change (e.g. editing the roster) without waiting for the schedule.
router.post('/backup', (_req, res) => {
  try {
    const backupPath = runBackup();
    res.json({ ok: true, path: backupPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
