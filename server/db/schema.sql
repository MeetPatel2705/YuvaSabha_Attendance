CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_row INTEGER NOT NULL,
  sheet_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  mobile TEXT,
  gender TEXT NOT NULL CHECK(gender IN ('M','F')),
  -- IST date (YYYY-MM-DD) the member was added through the admin panel.
  -- NULL for the original seeded roster, meaning "always been a member" —
  -- see routes/adminAttendance.js absentees streak, which only counts a
  -- member absent for dates on/after this (so newly added members aren't
  -- flagged as chronic absentees for Saturdays before they even joined).
  created_at TEXT,
  -- ISO timestamp of the last time an admin clicked "Remind" for this member
  -- (see routes/adminMembers.js POST /:id/remind). NULL if never reminded.
  last_reminded_at TEXT
);

-- Guards against two concurrent "add member" requests both computing the
-- same free sheet_row (check-then-act race in routes/adminMembers.js) and
-- silently colliding. The second insert now fails with a UNIQUE violation
-- instead of quietly overwriting the first member's row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_sheet_row ON members(sheet_row);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  date TEXT NOT NULL,
  checkin_time TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('self-checkin','admin-assisted')),
  device_id TEXT,
  distance_meters REAL,
  UNIQUE(member_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date_device ON attendance(date, device_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS date_remarks (
  date TEXT PRIMARY KEY,
  remark TEXT NOT NULL
);
