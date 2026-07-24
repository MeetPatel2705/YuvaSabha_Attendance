const db = require('../db');

const getStmt = db.prepare('SELECT remark FROM date_remarks WHERE date = ?');
const upsertStmt = db.prepare(
  `INSERT INTO date_remarks (date, remark) VALUES (?, ?)
   ON CONFLICT(date) DO UPDATE SET remark = excluded.remark`
);
const deleteStmt = db.prepare('DELETE FROM date_remarks WHERE date = ?');

function getRemark(date) {
  const row = getStmt.get(date);
  return row ? row.remark : null;
}

function setRemark(date, remark) {
  if (!remark || !remark.trim()) {
    deleteStmt.run(date);
    return;
  }
  upsertStmt.run(date, remark.trim());
}

module.exports = { getRemark, setRemark };
