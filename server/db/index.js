const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Add your Postgres connection string to server/.env (locally) or the host\'s environment variables.'
  );
}

// Hosted Postgres (Neon, Render, Supabase) requires TLS; a local container
// usually doesn't support it at all.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

let initPromise = null;

// Creates the tables on first use so a fresh database works with no manual
// setup step. Safe to run repeatedly (all statements are idempotent).
//
// Schema notes carried over from the SQLite era:
// - members.created_at is the IST date (YYYY-MM-DD) the member was added via
//   the admin panel; NULL for the original seeded roster ("always been a
//   member") — the absentees streak only counts misses on/after it.
// - idx_members_sheet_row guards two concurrent "add member" requests both
//   computing the same free sheet_row: the second insert fails with a UNIQUE
//   violation instead of silently colliding.
function initDb() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS members (
        id               SERIAL PRIMARY KEY,
        sheet_row        INTEGER NOT NULL,
        sheet_no         INTEGER NOT NULL,
        name             TEXT NOT NULL,
        mobile           TEXT,
        gender           TEXT NOT NULL CHECK (gender IN ('M','F')),
        created_at       TEXT,
        last_reminded_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_members_sheet_row ON members(sheet_row);

      CREATE TABLE IF NOT EXISTS attendance (
        id              SERIAL PRIMARY KEY,
        member_id       INTEGER NOT NULL REFERENCES members(id),
        date            TEXT NOT NULL,
        checkin_time    TEXT NOT NULL,
        source          TEXT NOT NULL CHECK (source IN ('self-checkin','admin-assisted')),
        device_id       TEXT,
        distance_meters DOUBLE PRECISION,
        UNIQUE (member_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_attendance_date_device ON attendance(date, device_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS date_remarks (
        date   TEXT PRIMARY KEY,
        remark TEXT NOT NULL
      );
    `);
  }
  return initPromise;
}

async function query(sql, params) {
  await initDb();
  return pool.query(sql, params);
}

// Runs fn inside a transaction on a single connection. fn receives a
// client with the same .query(sql, params) shape.
async function withTransaction(fn) {
  await initDb();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction, initDb };
