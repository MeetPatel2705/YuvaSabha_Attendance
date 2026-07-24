const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'attendance.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// CREATE TABLE IF NOT EXISTS above only applies to brand-new databases —
// existing ones need newly added columns bolted on explicitly. Ignore the
// "duplicate column" error on repeat runs (idempotent across restarts).
const MEMBER_COLUMN_MIGRATIONS = ['ALTER TABLE members ADD COLUMN created_at TEXT', 'ALTER TABLE members ADD COLUMN last_reminded_at TEXT'];
for (const migration of MEMBER_COLUMN_MIGRATIONS) {
  try {
    db.exec(migration);
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
}

module.exports = db;
