const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../lib/adminAuth');
const { writeMemberRowToExcel, clearMemberRowInExcel } = require('../lib/excelSync');
const { getIstNow } = require('../lib/istTime');

const router = express.Router();
router.use(requireAdmin);

const BLOCK_RANGES = { M: [3, 127], F: [128, 227] };

const findUsedRows = db.prepare(
  'SELECT sheet_row FROM members WHERE sheet_row BETWEEN ? AND ?'
);
const findByName = db.prepare('SELECT id FROM members WHERE name = ? COLLATE NOCASE');
const findByNameExcludingId = db.prepare(
  'SELECT id FROM members WHERE name = ? COLLATE NOCASE AND id != ?'
);
const findById = db.prepare(
  'SELECT id, sheet_row, sheet_no, name, mobile, gender, created_at FROM members WHERE id = ?'
);
const listAll = db.prepare(
  'SELECT id, name, mobile, gender FROM members ORDER BY name COLLATE NOCASE'
);
const insertMember = db.prepare(
  'INSERT INTO members (sheet_row, sheet_no, name, mobile, gender, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const updateMember = db.prepare('UPDATE members SET name = ?, mobile = ? WHERE id = ?');
const markReminded = db.prepare('UPDATE members SET last_reminded_at = ? WHERE id = ?');
const deleteMemberAttendance = db.prepare('DELETE FROM attendance WHERE member_id = ?');
const deleteMember = db.prepare('DELETE FROM members WHERE id = ?');

function findFreeRow(gender) {
  const [lo, hi] = BLOCK_RANGES[gender];
  const used = new Set(findUsedRows.all(lo, hi).map((r) => r.sheet_row));
  for (let row = lo; row <= hi; row++) {
    if (!used.has(row)) return row;
  }
  return null;
}

router.post('/members', async (req, res) => {
  const { name, mobile, gender } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (gender !== 'M' && gender !== 'F') {
    return res.status(400).json({ error: 'Gender must be selected.' });
  }

  const cleanName = name.trim();
  if (findByName.get(cleanName)) {
    return res.status(400).json({ error: `A member named "${cleanName}" already exists.` });
  }

  const sheetRow = findFreeRow(gender);
  if (sheetRow === null) {
    const blockLabel = gender === 'M' ? 'men' : 'women';
    return res.status(400).json({
      error:
        `No blank row is available for ${blockLabel} in the Excel sheet — every row in that ` +
        `block is already assigned. Adding another ${blockLabel === 'men' ? 'man' : 'woman'} ` +
        'would require inserting a new row into the spreadsheet, which isn\'t automated ' +
        '(it risks breaking the existing formulas). Add the row manually in Excel first, ' +
        'then ask for the row range to be extended.',
    });
  }

  const sheetNo = sheetRow - 2;
  const cleanMobile = mobile && mobile.trim() ? mobile.trim() : null;

  let result;
  try {
    result = insertMember.run(sheetRow, sheetNo, cleanName, cleanMobile, gender, getIstNow().date);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({
        error: 'That row was just taken by another request. Please try adding the member again.',
      });
    }
    throw err;
  }

  try {
    await writeMemberRowToExcel({ sheetRow, sheetNo, name: cleanName, mobile: cleanMobile });
  } catch (err) {
    return res.json({
      ok: true,
      id: result.lastInsertRowid,
      name: cleanName,
      sheetRow,
      excelWarning: `Member added, but writing their name into Excel failed: ${err.message}`,
    });
  }

  res.json({ ok: true, id: result.lastInsertRowid, name: cleanName, sheetRow });
});

router.get('/members', (_req, res) => {
  res.json(listAll.all());
});

router.put('/members/:id', async (req, res) => {
  const { name, mobile } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  const member = findById.get(req.params.id);
  if (!member) {
    return res.status(404).json({ error: 'Member not found.' });
  }

  const cleanName = name.trim();
  if (findByNameExcludingId.get(cleanName, member.id)) {
    return res.status(400).json({ error: `Another member named "${cleanName}" already exists.` });
  }

  const cleanMobile = mobile && mobile.trim() ? mobile.trim() : null;
  updateMember.run(cleanName, cleanMobile, member.id);

  try {
    await writeMemberRowToExcel({
      sheetRow: member.sheet_row,
      sheetNo: member.sheet_no,
      name: cleanName,
      mobile: cleanMobile,
    });
  } catch (err) {
    return res.json({
      ok: true,
      id: member.id,
      name: cleanName,
      excelWarning: `Member updated, but writing the change into Excel failed: ${err.message}`,
    });
  }

  res.json({ ok: true, id: member.id, name: cleanName });
});

// Removes a member entirely — their attendance history is deleted along
// with them (the DB's foreign key means it can't be orphaned), and their
// Excel row is wiped so it's genuinely free for the next person, not just
// missing from the members table with stale data still sitting in the
// sheet. The frontend confirms with the admin before calling this,
// especially when the member has recorded attendance to lose.
router.delete('/members/:id', async (req, res) => {
  const member = findById.get(req.params.id);
  if (!member) {
    return res.status(404).json({ error: 'Member not found.' });
  }

  db.exec('BEGIN');
  try {
    deleteMemberAttendance.run(member.id);
    deleteMember.run(member.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  try {
    await clearMemberRowInExcel(member.sheet_row);
  } catch (err) {
    return res.json({
      ok: true,
      id: member.id,
      excelWarning: `Member deleted, but clearing their row in Excel failed: ${err.message}`,
    });
  }

  res.json({ ok: true, id: member.id });
});

// Records that an admin just clicked "Remind" for this member (see the
// WhatsApp reminder link in AdminDashboard.jsx). Purely a timestamp — it
// doesn't confirm the message was actually sent, since wa.me hands off to
// WhatsApp itself, but it's enough to show "reminded 2 days ago" so admins
// don't lose track of who they've already nudged this week.
router.post('/members/:id/remind', (req, res) => {
  const member = findById.get(req.params.id);
  if (!member) {
    return res.status(404).json({ error: 'Member not found.' });
  }
  const remindedAt = new Date().toISOString();
  markReminded.run(remindedAt, member.id);
  res.json({ ok: true, id: member.id, lastReminded: remindedAt });
});

// Full attendance history for one member — every recorded Yuva Sabha date
// since they joined (same join-date rule as the absentees streak), oldest
// first, with a present/absent flag and the running percentage. Powers the
// member profile view in the admin panel.
router.get('/members/:id/history', (req, res) => {
  const member = findById.get(req.params.id);
  if (!member) {
    return res.status(404).json({ error: 'Member not found.' });
  }

  const dates = db
    .prepare('SELECT DISTINCT date FROM attendance ORDER BY date ASC')
    .all()
    .map((r) => r.date)
    .filter((d) => !member.created_at || d >= member.created_at);

  const presentDates = new Set(
    db.prepare('SELECT date FROM attendance WHERE member_id = ?').all(member.id).map((r) => r.date)
  );

  const history = dates.map((d) => ({ date: d, present: presentDates.has(d) }));
  const presentCount = history.filter((h) => h.present).length;

  res.json({
    id: member.id,
    name: member.name,
    mobile: member.mobile,
    history,
    presentCount,
    totalCount: history.length,
    percentage: history.length ? Math.round((presentCount / history.length) * 100) : null,
  });
});

module.exports = router;
