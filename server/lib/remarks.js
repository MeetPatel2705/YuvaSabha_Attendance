const { query } = require('../db');

async function getRemark(date) {
  const { rows } = await query('SELECT remark FROM date_remarks WHERE date = $1', [date]);
  return rows[0] ? rows[0].remark : null;
}

async function setRemark(date, remark) {
  if (!remark || !remark.trim()) {
    await query('DELETE FROM date_remarks WHERE date = $1', [date]);
    return;
  }
  await query(
    `INSERT INTO date_remarks (date, remark) VALUES ($1, $2)
     ON CONFLICT (date) DO UPDATE SET remark = EXCLUDED.remark`,
    [date, remark.trim()]
  );
}

module.exports = { getRemark, setRemark };
