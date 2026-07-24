require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const membersRoute = require('./routes/members');
const checkinRoute = require('./routes/checkin');
const adminAuthRoute = require('./routes/adminAuthRoutes');
const adminAttendanceRoute = require('./routes/adminAttendance');
const adminSettingsRoute = require('./routes/adminSettings');
const adminMembersRoute = require('./routes/adminMembers');
const { scheduleBackup } = require('./jobs/backup');

const app = express();

// Render/Railway terminate TLS and forward through a reverse proxy — without
// this, req.ip resolves to the proxy's address for every request, which
// would make the login rate limiter (lib/rateLimiter.js) lock out all
// visitors together instead of tracking each one separately.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/members', membersRoute);
app.use('/api/attendance/checkin', checkinRoute);
app.use('/api/admin', adminAuthRoute);
app.use('/api/admin', adminAttendanceRoute);
app.use('/api/admin', adminSettingsRoute);
app.use('/api/admin', adminMembersRoute);

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

module.exports = app;

if (require.main === module) {
  scheduleBackup();

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Yuva Sabha attendance server listening on port ${PORT}`);
  });
}
