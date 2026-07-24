const fs = require('fs');
const path = require('path');
const request = require('supertest');

const sqlitePath = path.join(__dirname, 'test-admin-auth.sqlite');
process.env.SQLITE_PATH = sqlitePath;
process.env.ADMIN_PASSWORD = 'original-password';

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
});

it('rejects login with the wrong password', async () => {
  const res = await request(app).post('/api/admin/login').send({ password: 'nope' });
  expect(res.status).toBe(401);
});

it('logs in with the env ADMIN_PASSWORD before any change', async () => {
  const res = await request(app).post('/api/admin/login').send({ password: 'original-password' });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

it('rejects a change-password request with no session', async () => {
  const res = await request(app)
    .post('/api/admin/change-password')
    .send({ currentPassword: 'original-password', newPassword: 'brand-new-password' });
  expect(res.status).toBe(401);
});

it('rejects a new password shorter than 8 characters', async () => {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'original-password' });

  const res = await agent
    .post('/api/admin/change-password')
    .send({ currentPassword: 'original-password', newPassword: 'short' });
  expect(res.status).toBe(400);
});

it('rejects change-password with the wrong current password', async () => {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'original-password' });

  const res = await agent
    .post('/api/admin/change-password')
    .send({ currentPassword: 'wrong-current', newPassword: 'brand-new-password' });
  expect(res.status).toBe(401);
});

it('changes the password, after which the old password is rejected and the new one works', async () => {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'original-password' });

  const changeRes = await agent
    .post('/api/admin/change-password')
    .send({ currentPassword: 'original-password', newPassword: 'brand-new-password' });
  expect(changeRes.status).toBe(200);

  const oldLogin = await request(app).post('/api/admin/login').send({ password: 'original-password' });
  expect(oldLogin.status).toBe(401);

  const newLogin = await request(app).post('/api/admin/login').send({ password: 'brand-new-password' });
  expect(newLogin.status).toBe(200);
});
