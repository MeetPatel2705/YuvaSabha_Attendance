const request = require('supertest');
const { query, resetDb, closeDb } = require('./helpers');

process.env.ADMIN_PASSWORD = 'admin-pw';

// Checkin is gated on the real day/time window, so tests pin the system
// clock to a Saturday inside 9-10 PM IST rather than relying on whenever the
// suite happens to run. 2026-07-25T16:00:00Z is 21:30 IST that Saturday.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-25T16:00:00Z'));
});

afterAll(async () => {
  vi.useRealTimers();
  await closeDb();
});

const app = require('../index');

let memberId;

beforeAll(async () => {
  await resetDb();
  const { rows } = await query(
    "INSERT INTO members (sheet_row, sheet_no, name, mobile, gender) VALUES (1, 1, 'Test Member', '9999999999', 'M') RETURNING id"
  );
  memberId = rows[0].id;
});

beforeEach(async () => {
  await query('DELETE FROM attendance');
});

it('returns a healthy response on /api/health', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});

it('rejects checkin requests with missing fields', async () => {
  const res = await request(app).post('/api/attendance/checkin').send({});
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Missing memberId, deviceId, or GPS coordinates/i);
});

it('allows checkin within the day/time/geofence window and stores attendance', async () => {
  const res = await request(app)
    .post('/api/attendance/checkin')
    .send({ memberId, deviceId: 'device-1', lat: 22.314688, lng: 73.153199 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.name).toBe('Test Member');
  expect(res.body.date).toBeDefined();

  const { rows } = await query('SELECT * FROM attendance WHERE device_id = $1', ['device-1']);
  expect(rows[0]).toBeTruthy();
  expect(rows[0].member_id).toBe(memberId);
});

it('rejects checkin from outside the geofence', async () => {
  const res = await request(app)
    .post('/api/attendance/checkin')
    // Roughly 5km from the mandir — well outside the 50m radius.
    .send({ memberId, deviceId: 'device-far', lat: 22.36, lng: 73.15 });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/more than 50m from the mandir/i);
});

it('prevents duplicate device checkin on the same day', async () => {
  await request(app)
    .post('/api/attendance/checkin')
    .send({ memberId, deviceId: 'device-dup', lat: 22.314688, lng: 73.153199 });

  const res = await request(app)
    .post('/api/attendance/checkin')
    .send({ memberId, deviceId: 'device-dup', lat: 22.314688, lng: 73.153199 });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Attendance already marked from this device today/i);
});
