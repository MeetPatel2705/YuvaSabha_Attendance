const fs = require('fs');
const path = require('path');
const request = require('supertest');

const sqlitePath = path.join(__dirname, 'test-rate-limit.sqlite');
process.env.SQLITE_PATH = sqlitePath;
process.env.ADMIN_PASSWORD = 'correct-password';

if (fs.existsSync(sqlitePath)) {
  fs.unlinkSync(sqlitePath);
}

const app = require('../index');
const db = require('../db');

afterAll(() => {
  if (typeof db.close === 'function') {
    db.close();
  }
  if (fs.existsSync(sqlitePath)) {
    fs.unlinkSync(sqlitePath);
  }
  vi.useRealTimers();
});

it('locks out login after 5 failed attempts, even with the correct password, and unlocks after the cooldown', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await request(app).post('/api/admin/login').send({ password: 'wrong' });
    expect(res.status).toBe(401);
  }

  const lockedOutButCorrect = await request(app)
    .post('/api/admin/login')
    .send({ password: 'correct-password' });
  expect(lockedOutButCorrect.status).toBe(429);
  expect(lockedOutButCorrect.body.error).toMatch(/too many failed attempts/i);

  const realNowMs = Date.now();
  vi.useFakeTimers();
  vi.setSystemTime(realNowMs + 16 * 60 * 1000); // past the 15-minute lockout

  const afterCooldown = await request(app).post('/api/admin/login').send({ password: 'correct-password' });
  expect(afterCooldown.status).toBe(200);
});

it('a successful login resets the failure count', async () => {
  const res1 = await request(app).post('/api/admin/login').send({ password: 'wrong-again' });
  expect(res1.status).toBe(401);

  const success = await request(app).post('/api/admin/login').send({ password: 'correct-password' });
  expect(success.status).toBe(200);

  // Fresh budget after the success — one more wrong guess shouldn't be locked.
  const res2 = await request(app).post('/api/admin/login').send({ password: 'wrong-once-more' });
  expect(res2.status).toBe(401);
});
