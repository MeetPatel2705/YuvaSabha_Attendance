const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../lib/adminAuth');
const { getIstNow } = require('../lib/istTime');
const { getRemark } = require('../lib/remarks');
const { buildExportWorkbook } = require('../lib/exportWorkbook');

const router = express.Router();
router.use(requireAdmin);

router.get('/attendance', async (req, res) => {
  try {
    const date = req.query.date || getIstNow().date;

    const { rows: present } = await query(
      `SELECT a.id, m.id AS "memberId", m.name, a.source, a.checkin_time AS "checkinTime"
       FROM attendance a JOIN members m ON m.id = a.member_id
       WHERE a.date = $1
       ORDER BY LOWER(m.name)`,
      [date]
    );

    const presentIds = new Set(present.map((p) => p.memberId));
    const { rows: allMembers } = await query('SELECT id, name FROM members ORDER BY LOWER(name)');
    const absent = allMembers.filter((m) => !presentIds.has(m.id));

    res.json({ date, present, absent, remark: await getRemark(date) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Present count per recorded date, oldest first — powers the admin trend
// chart. Counts both self-checkin and admin-assisted rows, same as the
// per-date view above.
router.get('/attendance/history', async (_req, res) => {
  try {
    const { rows: weeks } = await query(
      'SELECT date, COUNT(*)::int AS "presentCount" FROM attendance GROUP BY date ORDER BY date ASC'
    );
    res.json({ weeks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CHRONIC_ABSENTEE_STREAK = 3;
const RECENT_REPORT_SIZE = 5;

// Members who missed the last CHRONIC_ABSENTEE_STREAK-or-more recorded
// Saturdays in a row, most-missed first. "Recorded" dates are the distinct
// dates present in the attendance table (same universe the trend chart
// uses) — a Saturday nobody was ever marked present for isn't in that set,
// so it can't be counted as a miss either.
router.get('/attendance/absentees', async (_req, res) => {
  try {
    const { rows: dateRows } = await query('SELECT DISTINCT date FROM attendance ORDER BY date DESC');
    const dates = dateRows.map((r) => r.date);

    if (dates.length === 0) {
      return res.json({ dates: [], absentees: [] });
    }

    const { rows: members } = await query(
      'SELECT id, name, mobile, created_at, last_reminded_at FROM members ORDER BY LOWER(name)'
    );
    const { rows: attRows } = await query('SELECT member_id, date FROM attendance');
    const presentSet = new Set(attRows.map((r) => `${r.member_id}|${r.date}`));
    const { rows: lastRows } = await query(
      'SELECT member_id, MAX(date) AS "lastDate" FROM attendance GROUP BY member_id'
    );
    const lastPresentByMember = new Map(lastRows.map((r) => [r.member_id, r.lastDate]));

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full member x date attendance matrix — an at-a-glance view directly on the
// site, same idea as scanning the exported Excel sheet by eye but without
// downloading it. Newest date first so it's visible without scrolling (the
// sticky name column is the only other fixed thing on screen). Same
// join-date rule as the absentees/history endpoints above: a cell for a
// date before the member existed is `null` (not yet a member), distinct
// from `false` (was a member, didn't attend).
router.get('/attendance/grid', async (_req, res) => {
  try {
    const { rows: dateRows } = await query('SELECT DISTINCT date FROM attendance ORDER BY date DESC');
    const dates = dateRows.map((r) => r.date);
    const { rows: members } = await query('SELECT id, name, created_at FROM members ORDER BY LOWER(name)');
    const { rows: attRows } = await query('SELECT member_id, date FROM attendance');
    const presentSet = new Set(attRows.map((r) => `${r.member_id}|${r.date}`));

    const grid = members.map((member) => ({
      id: member.id,
      name: member.name,
      attendance: dates.map((date) => {
        if (member.created_at && date < member.created_at) return null;
        return presentSet.has(`${member.id}|${date}`);
      }),
    }));

    res.json({ dates, members: grid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/checkin', async (req, res) => {
  try {
    const { memberId, date } = req.body || {};
    if (!memberId) {
      return res.status(400).json({ error: 'memberId is required.' });
    }

    const memberResult = await query('SELECT id, name FROM members WHERE id = $1', [memberId]);
    const member = memberResult.rows[0];
    if (!member) {
      return res.status(400).json({ error: 'Unknown member selected.' });
    }

    const targetDate = date || getIstNow().date;

    try {
      await query(
        `INSERT INTO attendance (member_id, date, checkin_time, source, device_id, distance_meters)
         VALUES ($1, $2, $3, 'admin-assisted', NULL, NULL)`,
        [member.id, targetDate, new Date().toISOString()]
      );
    } catch (err) {
      if (String(err.message).includes('unique') || err.code === '23505') {
        return res.status(400).json({ error: 'This member is already marked present for that date.' });
      }
      throw err;
    }

    res.json({ ok: true, name: member.name, date: targetDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/attendance/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM attendance WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Attendance record not found.' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generates the Excel workbook on the fly from the database — always current
// by definition, with no synced file on disk to babysit (the old per-checkin
// sync queue and nightly auto-sync existed only to keep a disk copy fresh,
// which ephemeral-disk hosts kept wiping anyway). Newest week is the first
// date column, so the current week is visible without scrolling.
router.get('/excel', async (_req, res) => {
  try {
    const workbook = await buildExportWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Yuva Sabha Harinagar.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Could not generate the Excel file: ' + err.message });
    }
  }
});

module.exports = router;
