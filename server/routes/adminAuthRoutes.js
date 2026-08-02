const express = require('express');
const {
  issueAdminToken,
  setAdminCookie,
  clearAdminCookie,
  requireAdmin,
  hashPassword,
  verifyPassword,
} = require('../lib/adminAuth');
const { getAdminPasswordHash, setAdminPasswordHash } = require('../lib/settings');
const { createLoginLimiter } = require('../lib/rateLimiter');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;

// Separate limiters: a stranger guessing the login password shouldn't burn
// the same budget as someone who's already authenticated guessing the
// current password on change-password (a narrower, lower-volume threat, but
// still worth throttling since a stolen session cookie alone isn't enough).
const loginLimiter = createLoginLimiter();
const changePasswordLimiter = createLoginLimiter();

function lockedResponse(res, retryAfterSeconds) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return res.status(429).json({
    error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
  });
}

// True once the password has been changed from the UI; before that, the
// plain ADMIN_PASSWORD env var is the source of truth (initial bootstrap).
async function checkPassword(password) {
  const storedHash = await getAdminPasswordHash();
  if (storedHash) {
    return verifyPassword(password, storedHash);
  }
  // .trim() guards against invisible trailing whitespace/newlines from
  // pasting or typing into a host's env var UI (bit us with CLIENT_ORIGIN
  // and VITE_API_BASE_URL already this session) — without it, a hidden
  // trailing character makes every login attempt fail with no visible cause.
  const envPassword = process.env.ADMIN_PASSWORD?.trim();
  if (!envPassword) return null; // server misconfigured
  return password === envPassword;
}

router.post('/login', async (req, res) => {
  try {
    const retryAfter = loginLimiter.check(req);
    if (retryAfter) return lockedResponse(res, retryAfter);

    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Password is required.' });
    }

    const valid = await checkPassword(password);
    if (valid === null) {
      return res.status(500).json({ error: 'Server misconfigured: ADMIN_PASSWORD not set.' });
    }
    if (!valid) {
      loginLimiter.recordFailure(req);
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    loginLimiter.recordSuccess(req);
    const token = issueAdminToken();
    setAdminCookie(res, token);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (_req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

router.post('/change-password', requireAdmin, async (req, res) => {
  try {
    const retryAfter = changePasswordLimiter.check(req);
    if (retryAfter) return lockedResponse(res, retryAfter);

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const valid = await checkPassword(currentPassword);
    if (valid === null) {
      return res.status(500).json({ error: 'Server misconfigured: ADMIN_PASSWORD not set.' });
    }
    if (!valid) {
      changePasswordLimiter.recordFailure(req);
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    changePasswordLimiter.recordSuccess(req);
    await setAdminPasswordHash(hashPassword(newPassword));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
