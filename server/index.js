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
const { seedMembers } = require('./lib/seedMembers');

// Auto-seeds the roster from an env var into a brand-new empty database, so
// a fresh deploy comes up with the roster without a manual step. Set
// MEMBERS_SEED_JSON to the same content as scripts/members.seed.json. No-op
// if the members table already has rows, or if the env var isn't set (e.g.
// local dev, where `npm run seed` is used instead — see README.md).
async function autoSeed() {
  if (!process.env.MEMBERS_SEED_JSON) return;
  try {
    const result = await seedMembers(JSON.parse(process.env.MEMBERS_SEED_JSON));
    if (result.seeded) {
      console.log(`[autoSeed] Seeded ${result.seeded} members from MEMBERS_SEED_JSON.`);
    }
  } catch (err) {
    console.error('[autoSeed] Failed to seed from MEMBERS_SEED_JSON:', err);
  }
}

const app = express();

// Render/Railway terminate TLS and forward through a reverse proxy — without
// this, req.ip resolves to the proxy's address for every request, which
// would make the login rate limiter (lib/rateLimiter.js) lock out all
// visitors together instead of tracking each one separately.
app.set('trust proxy', 1);

// .trim() guards against a trailing newline/whitespace sneaking in from
// pasting into a host's env var UI — invisible in the dashboard, but an
// invalid character in an HTTP header value, which crashes every request
// with ERR_INVALID_CHAR the moment `cors` tries to set the response header.
const clientOrigin = process.env.CLIENT_ORIGIN?.trim();
app.use(cors({ origin: clientOrigin || true, credentials: true }));
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
  const PORT = process.env.PORT || 4000;
  autoSeed().finally(() => {
    app.listen(PORT, () => {
      console.log(`Yuva Sabha attendance server listening on port ${PORT}`);
    });
  });
}
