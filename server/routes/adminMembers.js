const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAdmin } = require('../lib/adminAuth');
const { getIstNow } = require('../lib/istTime');

const router = express.Router();
router.use(requireAdmin);

const BLOCK_RANGES = { M: [3, 127], F: [128, 227] };

async function findFreeRow(gender) {
  const [lo, hi] = BLOCK_RANGES[gender];
  const { rows } = await query('SELECT sheet_row FROM members WHERE sheet_row BETWEEN $1 AND $2', [lo, hi]);
  const used = new Set(rows.map((r) => r.sheet_row));
  for (let row = lo; row <= hi; row++) {
    if (!used.has(row)) return row;
  }
  return null;
}

router.post('/members', async (req, res) => {
  try {
    const { name, mobile, gender, occupation } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (gender !== 'M' && gender !== 'F') {
      return res.status(400).json({ error: 'Gender must be selected.' });
    }

    const cleanName = name.trim();
    const dupe = await query('SELECT id FROM members WHERE LOWER(name) = LOWER($1)', [cleanName]);
    if (dupe.rows[0]) {
      return res.status(400).json({ error: `A member named "${cleanName}" already exists.` });
    }

    const sheetRow = await findFreeRow(gender);
    if (sheetRow === null) {
      const blockLabel = gender === 'M' ? 'men' : 'women';
      return res.status(400).json({
        error:
          `No free row slot is available for ${blockLabel} — every slot in that block ` +
          `(${BLOCK_RANGES[gender][0]}-${BLOCK_RANGES[gender][1]}) is already assigned. ` +
          'The block range would need to be extended in the code before adding another ' +
          `${blockLabel === 'men' ? 'man' : 'woman'}.`,
      });
    }

    const sheetNo = sheetRow - 2;
    const cleanMobile = mobile && mobile.trim() ? mobile.trim() : null;
    const cleanOccupation = occupation && occupation.trim() ? occupation.trim() : null;

    let inserted;
    try {
      const result = await query(
        'INSERT INTO members (sheet_row, sheet_no, name, mobile, gender, occupation, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [sheetRow, sheetNo, cleanName, cleanMobile, gender, cleanOccupation, getIstNow().date]
      );
      inserted = result.rows[0];
    } catch (err) {
      if (String(err.message).includes('unique') || err.code === '23505') {
        return res.status(400).json({
          error: 'That row was just taken by another request. Please try adding the member again.',
        });
      }
      throw err;
    }

    res.json({ ok: true, id: inserted.id, name: cleanName, sheetRow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/members', async (_req, res) => {
  try {
    const { rows } = await query('SELECT id, name, mobile, gender, occupation FROM members ORDER BY LOWER(name)');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/members/:id', async (req, res) => {
  try {
    const { name, mobile, occupation } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    const found = await query('SELECT id FROM members WHERE id = $1', [req.params.id]);
    const member = found.rows[0];
    if (!member) {
      return res.status(404).json({ error: 'Member not found.' });
    }

    const cleanName = name.trim();
    const dupe = await query('SELECT id FROM members WHERE LOWER(name) = LOWER($1) AND id != $2', [
      cleanName,
      member.id,
    ]);
    if (dupe.rows[0]) {
      return res.status(400).json({ error: `Another member named "${cleanName}" already exists.` });
    }

    const cleanMobile = mobile && mobile.trim() ? mobile.trim() : null;
    const cleanOccupation = occupation && occupation.trim() ? occupation.trim() : null;
    await query('UPDATE members SET name = $1, mobile = $2, occupation = $3 WHERE id = $4', [
      cleanName,
      cleanMobile,
      cleanOccupation,
      member.id,
    ]);

    res.json({ ok: true, id: member.id, name: cleanName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Removes a member entirely — their attendance history is deleted along with
// them (in one transaction, so it can't be orphaned), and their sheet_row is
// genuinely free for the next person. The frontend confirms with the admin
// before calling this, especially when the member has recorded attendance.
router.delete('/members/:id', async (req, res) => {
  try {
    const found = await query('SELECT id FROM members WHERE id = $1', [req.params.id]);
    const member = found.rows[0];
    if (!member) {
      return res.status(404).json({ error: 'Member not found.' });
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM attendance WHERE member_id = $1', [member.id]);
      await client.query('DELETE FROM members WHERE id = $1', [member.id]);
    });

    res.json({ ok: true, id: member.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Records that an admin just clicked "Remind" for this member (see the
// WhatsApp reminder link in AdminDashboard.jsx). Purely a timestamp — it
// doesn't confirm the message was actually sent, since wa.me hands off to
// WhatsApp itself, but it's enough to show "reminded 2 days ago" so admins
// don't lose track of who they've already nudged this week.
router.post('/members/:id/remind', async (req, res) => {
  try {
    const found = await query('SELECT id FROM members WHERE id = $1', [req.params.id]);
    const member = found.rows[0];
    if (!member) {
      return res.status(404).json({ error: 'Member not found.' });
    }
    const remindedAt = new Date().toISOString();
    await query('UPDATE members SET last_reminded_at = $1 WHERE id = $2', [remindedAt, member.id]);
    res.json({ ok: true, id: member.id, lastReminded: remindedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full attendance history for one member — every recorded Yuva Sabha date
// since they joined (same join-date rule as the absentees streak), oldest
// first, with a present/absent flag and the running percentage. Powers the
// member profile view in the admin panel.
router.get('/members/:id/history', async (req, res) => {
  try {
    const found = await query(
      'SELECT id, name, mobile, occupation, created_at FROM members WHERE id = $1',
      [req.params.id]
    );
    const member = found.rows[0];
    if (!member) {
      return res.status(404).json({ error: 'Member not found.' });
    }

    const { rows: dateRows } = await query('SELECT DISTINCT date FROM attendance ORDER BY date ASC');
    const dates = dateRows
      .map((r) => r.date)
      .filter((d) => !member.created_at || d >= member.created_at);

    const { rows: presentRows } = await query('SELECT date FROM attendance WHERE member_id = $1', [member.id]);
    const presentDates = new Set(presentRows.map((r) => r.date));

    const history = dates.map((d) => ({ date: d, present: presentDates.has(d) }));
    const presentCount = history.filter((h) => h.present).length;

    res.json({
      id: member.id,
      name: member.name,
      mobile: member.mobile,
      occupation: member.occupation,
      history,
      presentCount,
      totalCount: history.length,
      percentage: history.length ? Math.round((presentCount / history.length) * 100) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
