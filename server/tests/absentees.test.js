const request = require('supertest');
const { query, resetDb, closeDb } = require('./helpers');

process.env.ADMIN_PASSWORD = 'admin-pw';

const app = require('../index');

// Four recorded Saturdays, oldest first.
const DATES = ['2026-06-27', '2026-07-04', '2026-07-11', '2026-07-18'];

async function insertMember(sheetRow, name, mobile) {
  const { rows } = await query(
    'INSERT INTO members (sheet_row, sheet_no, name, mobile, gender) VALUES ($1, 1, $2, $3, $4) RETURNING id',
    [sheetRow, name, mobile, 'M']
  );
  return rows[0].id;
}

async function insertAttendance(memberId, date) {
  await query(
    `INSERT INTO attendance (member_id, date, checkin_time, source, device_id, distance_meters)
     VALUES ($1, $2, $3, 'admin-assisted', NULL, NULL)`,
    [memberId, date, new Date().toISOString()]
  );
}

beforeAll(async () => {
  await resetDb();
  const chronic = await insertMember(1, 'Chronic Absentee', '1'); // absent all 4 -> streak 4
  const borderline = await insertMember(2, 'Borderline Member', '2'); // streak 2 (below threshold 3)
  const justOverThreshold = await insertMember(3, 'Just Over Threshold', '3'); // streak 3
  const regular = await insertMember(4, 'Regular Member', '4'); // streak 0
  // Present every week, purely so all 4 dates have at least one attendance
  // row and stay in the "recorded dates" universe the endpoint derives from
  // DISTINCT date — mirrors real usage where some member always shows up.
  const alwaysPresent = await insertMember(5, 'Always Present', '5');

  await insertAttendance(borderline, DATES[1]);
  await insertAttendance(justOverThreshold, DATES[0]);
  await insertAttendance(regular, DATES[3]);
  for (const date of DATES) {
    await insertAttendance(alwaysPresent, date);
  }
  void chronic;
});

let agent;
beforeAll(async () => {
  agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'admin-pw' });
});

afterAll(async () => {
  await closeDb();
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
