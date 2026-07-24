const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const COOKIE_NAME = 'admin_token';
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET env var is not set');
  }
  return secret;
}

function issueAdminToken() {
  return jwt.sign({ role: 'admin' }, getJwtSecret(), { expiresIn: TOKEN_TTL_MS / 1000 });
}

// In production the client and server may be on different origins (e.g.
// Vercel + Render — see "Frontend and backend on different origins" in
// DEPLOY.md), so the cookie needs sameSite:'none' to be sent on cross-site
// requests at all, which browsers only honor when paired with secure:true.
// Locally (same-origin via the Vite proxy, plain http://localhost) sameSite
// 'none' would just get the cookie rejected outright without HTTPS, so this
// only switches on in production.
const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd,
};

function setAdminCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: TOKEN_TTL_MS });
}

function clearAdminCookie(res) {
  // clearCookie must be called with the same sameSite/secure attributes the
  // cookie was originally set with, or the browser won't recognize it as
  // the same cookie and silently won't clear it.
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    jwt.verify(token, getJwtSecret());
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// Password hashing for the admin password once it's changed from the UI
// (see routes/adminAuthRoutes.js). Node's built-in scrypt, so no extra
// dependency — `salt:hash`, both hex, stored as one string.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidateBuffer = crypto.scryptSync(password, salt, hashBuffer.length);
  if (hashBuffer.length !== candidateBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, candidateBuffer);
}

module.exports = {
  issueAdminToken,
  setAdminCookie,
  clearAdminCookie,
  requireAdmin,
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
};
