// One-time migration: copies everything from the old SQLite file into
// Postgres (DATABASE_URL). Preserves member ids so attendance rows keep
// pointing at the right people. Refuses to run against a Postgres that
// already has members, so it can't double-import.
//
//   node scripts/migrateSqliteToPg.js [path/to/attendance.sqlite]
//
// Default SQLite path: server/data/attendance.sqlite (same as the old app).
require('dotenv').config();
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { pool, query, withTransaction } = require('../db');

const sqlitePath = process.argv[2] || path.join(__dirname, '..', 'data', 'attendance.sqlite');

async function main() {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });

  const members = sqlite.prepare('SELECT * FROM members ORDER BY id').all();
  const attendance = sqlite.prepare('SELECT * FROM attendance ORDER BY id').all();
  const settings = sqlite.prepare('SELECT * FROM settings').all();
  const remarks = sqlite.prepare('SELECT * FROM date_remarks').all();
  console.log(
    `SQLite: ${members.length} members, ${attendance.length} attendance rows, ` +
      `${settings.length} settings, ${remarks.length} remarks`
  );

  const existing = await query('SELECT COUNT(*)::int AS n FROM members');
  if (existing.rows[0].n > 0) {
    throw new Error(
      `Target Postgres already has ${existing.rows[0].n} members — refusing to import twice. ` +
        'Point DATABASE_URL at an empty database.'
    );
  }

  await withTransaction(async (client) => {
    for (const m of members) {
      await client.query(
        `INSERT INTO members (id, sheet_row, sheet_no, name, mobile, gender, created_at, last_reminded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [m.id, m.sheet_row, m.sheet_no, m.name, m.mobile, m.gender, m.created_at, m.last_reminded_at]
      );
    }
    for (const a of attendance) {
      await client.query(
        `INSERT INTO attendance (member_id, date, checkin_time, source, device_id, distance_meters)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [a.member_id, a.date, a.checkin_time, a.source, a.device_id, a.distance_meters]
      );
    }
    for (const s of settings) {
      // last_sync_info belonged to the removed disk-file sync — don't carry it.
      if (s.key === 'last_sync_info') continue;
      await client.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [s.key, s.value]);
    }
    for (const r of remarks) {
      await client.query('INSERT INTO date_remarks (date, remark) VALUES ($1, $2)', [r.date, r.remark]);
    }
    // members.id came over explicitly, so bump the sequence past the max id
    // or the next INSERT would collide.
    await client.query(`SELECT setval(pg_get_serial_sequence('members', 'id'), (SELECT MAX(id) FROM members))`);
  });

  const check = await query('SELECT COUNT(*)::int AS n FROM attendance');
  console.log(`Done. Postgres now has ${check.rows[0].n} attendance rows.`);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
