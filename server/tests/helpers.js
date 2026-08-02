// Shared Postgres test setup. Each test file points DATABASE_URL at the
// dedicated attendance_test database and wipes it before its suite runs —
// vitest.config.js disables file parallelism so files can't stomp on each
// other mid-run.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/attendance_test';

const { pool, query } = require('../db');

async function resetDb() {
  await query('TRUNCATE attendance, members, settings, date_remarks RESTART IDENTITY CASCADE');
}

async function closeDb() {
  await pool.end();
}

module.exports = { query, resetDb, closeDb };
