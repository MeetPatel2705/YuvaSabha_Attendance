const fs = require('fs');
const path = require('path');
const request = require('supertest');

const sqlitePath = path.join(__dirname, 'test-absentees.sqlite');
process.env.SQLITE_PATH = sqlitePath;
process.env.ADMIN_PASSWORD = 'admin-pw';

if (fs.existsSync(sqlitePath)) {
  fs.unlinkSync(sqlitePath);
}

const app = require('../index');
const db = require('../db');

const insertMember = db.prepare(
  'INSERT INTO members (sheet_row, sheet_no, name, mobile, gender) VALUES (?, ?, ?, ?, ?)'
);
const insertAttendance = db.prepare(
  `INSERT INTO attendance (member_id, date, checkin_time, source, device_id, distance_meters)
   VALUES (?, ?, ?, 'admin-assisted', NULL, NULL)`
);

// Four recorded Saturdays, oldest first.
const DATES = ['2026-06-27', '2026-07-04', '2026-07-11', '2026-07-18'];

let chronic; // absent all 4 -> streak 4
let borderline; // present on the 2nd-oldest, absent the last 2 -> streak 2 (below threshold 3)
let justOverThreshold; // present only on the oldest -> absent the most recent 3 -> streak 3
let regular; // present on the most recent -> streak 0

beforeAll(() => {
  chronic = insertMember.run(1, 1, 'Chronic Absentee', '1', 'M').lastInsertRowid;
  borderline = insertMember.run(2, 1, 'Borderline Member', '2', 'M').lastInsertRowid;
  justOverThreshold = insertMember.run(3, 1, 'Just Over Threshold', '3', 'M').lastInsertRowid;
  regular = insertMember.run(4, 1, 'Regular Member', '4', 'M').lastInsertRowid;
  // Present every week, purely so all 4 dates have at least one attendance
  // row and stay in the "recorded dates" universe the endpoint derives from
  // DISTINCT date — mirrors real usage where some member always shows up.
  const alwaysPresent = insertMember.run(5, 1, 'Always Present', '5', 'M').lastInsertRowid;

  const now = new Date().toISOString();
  insertAttendance.run(borderline, DATES[1], now);
  insertAttendance.run(justOverThreshold, DATES[0], now);
  insertAttendance.run(regular, DATES[3], now);
  for (const date of DATES) {
    insertAttendance.run(alwaysPresent, date, now);
  }
});

let agent;
beforeAll(async () => {
  agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'admin-pw' });
});

afterAll(() => {
  if (typeof db.close === 'function') {
    db.close();
  }
  if (fs.existsSync(sqlitePath)) {
    fs.unlinkSync(sqlitePath);
  }
});

it('flags only members absent 3+ recorded Saturdays in a row, most-missed first', async () => {
  const res = await agent.get('/api/admin/attendance/absentees');
  expect(res.status).toBe(200);
  expect(res.body.threshold).toBe(3);
  expect(res.body.dates).toEqual([...DATES].reverse());

  const byName = Object.fromEntries(res.body.absentees.map((a) => [a.name, a]));

  expect(byName['Chronic Absentee'].streak).toBe(4);
  expect(byName['Chronic Absentee'].lastPresent).toBeNull();
  expect(byName['Just Over Threshold'].streak).toBe(3);
  expect(byName['Just Over Threshold'].lastPresent).toBe(DATES[0]);

  expect(byName['Borderline Member']).toBeUndefined();
  expect(byName['Regular Member']).toBeUndefined();

  expect(res.body.absentees[0].name).toBe('Chronic Absentee');
});
