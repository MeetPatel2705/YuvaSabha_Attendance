const db = require('../db');

const CHECKIN_WEEKDAY_KEY = 'checkin_weekday';
const OVERRIDE_DATE_KEY = 'override_attendance_date';
const ADMIN_PASSWORD_HASH_KEY = 'admin_password_hash';
const LAST_SYNC_KEY = 'last_sync_info';
const DEFAULT_WEEKDAY = 'Sat';

// Matches the short weekday values Intl.DateTimeFormat produces (see istTime.js).
const WEEKDAY_LABELS = {
  Sun: 'Sundays',
  Mon: 'Mondays',
  Tue: 'Tuesdays',
  Wed: 'Wednesdays',
  Thu: 'Thursdays',
  Fri: 'Fridays',
  Sat: 'Saturdays',
};

const VALID_WEEKDAYS = Object.keys(WEEKDAY_LABELS);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parsed as a UTC calendar date (not local/IST) purely to read off the
// day-of-week without any timezone shift risk — matches the client's own
// isSaturday() check in AdminDashboard.jsx.
function isSaturday(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
}

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsertStmt = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);
const deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');

function getCheckinWeekday() {
  const row = getStmt.get(CHECKIN_WEEKDAY_KEY);
  return row ? row.value : DEFAULT_WEEKDAY;
}

function setCheckinWeekday(weekday) {
  if (!VALID_WEEKDAYS.includes(weekday)) {
    throw new Error('Invalid weekday.');
  }
  upsertStmt.run(CHECKIN_WEEKDAY_KEY, weekday);
}

// The target date self check-ins should be recorded under, for weeks where
// Yuva Sabha is held on a different day than usual (e.g. moved to Friday but
// still recorded as that Saturday, since the Excel template only has
// pre-built Saturday columns). Null/cleared means "just use today".
function getOverrideAttendanceDate() {
  const row = getStmt.get(OVERRIDE_DATE_KEY);
  return row ? row.value : null;
}

function setOverrideAttendanceDate(date) {
  if (date === null) {
    deleteStmt.run(OVERRIDE_DATE_KEY);
    return;
  }
  if (!DATE_RE.test(date)) {
    throw new Error('Invalid date.');
  }
  if (!isSaturday(date)) {
    throw new Error('Override date must be a Saturday — the Excel template only has Saturday columns.');
  }
  upsertStmt.run(OVERRIDE_DATE_KEY, date);
}

// Resolves which date a check-in happening right now should be recorded
// under. The override only applies up to and including its own date — once
// it's in the past it's treated as expired automatically, so forgetting to
// clear it can't silently misdate a later week.
function resolveAttendanceDate(istNow) {
  const override = getOverrideAttendanceDate();
  if (override && override >= istNow.date) {
    return override;
  }
  return istNow.date;
}

// Once the admin changes their password from the UI, the hash lives here
// instead of the ADMIN_PASSWORD env var (see routes/adminAuthRoutes.js,
// which falls back to the env var until this is ever set).
function getAdminPasswordHash() {
  const row = getStmt.get(ADMIN_PASSWORD_HASH_KEY);
  return row ? row.value : null;
}

function setAdminPasswordHash(hash) {
  upsertStmt.run(ADMIN_PASSWORD_HASH_KEY, hash);
}

// Set after every successful Excel sync (manual or the scheduled auto-sync —
// see lib/excelSync.js), so the admin panel can show "last synced" without
// anyone needing to read server logs.
function getLastSync() {
  const row = getStmt.get(LAST_SYNC_KEY);
  return row ? JSON.parse(row.value) : null;
}

function setLastSync({ at, date, presentCount }) {
  upsertStmt.run(LAST_SYNC_KEY, JSON.stringify({ at, date, presentCount }));
}

module.exports = {
  getCheckinWeekday,
  setCheckinWeekday,
  getOverrideAttendanceDate,
  setOverrideAttendanceDate,
  resolveAttendanceDate,
  getAdminPasswordHash,
  setAdminPasswordHash,
  getLastSync,
  setLastSync,
  VALID_WEEKDAYS,
  WEEKDAY_LABELS,
};
