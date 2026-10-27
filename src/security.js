import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_HOURS = 12;

/** Short URL-safe HMAC of `data`. */
export const sign = (data, secret, length = 22) =>
  createHmac('sha256', secret).update(data).digest('base64url').slice(0, length);

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PINs and passwords are stored as salted scrypt hashes, never in plain text. */
export function hashSecret(plain) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(plain, salt, 32).toString('hex')}`;
}

export function verifySecret(plain, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(plain, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

/** Stateless session: base64url(JSON payload) + "." + HMAC. Stored in an HttpOnly cookie. */
export function createSession(user, secret, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ uid: user.id, role: user.role, exp: now + SESSION_HOURS * 3_600_000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret, 43)}`;
}

export function readSession(cookieHeader, secret, now = Date.now()) {
  const raw = parseCookies(cookieHeader).fs_session;
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload, secret, 43))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.exp > now ? session : null;
  } catch {
    return null;
  }
}

export function sessionCookie(value, { secure, maxAgeSeconds = SESSION_HOURS * 3600 }) {
  return [`fs_session=${value}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAgeSeconds}`, secure && 'Secure']
    .filter(Boolean)
    .join('; ');
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => {
      const i = part.indexOf('=');
      return [part.slice(0, i).trim(), part.slice(i + 1).trim()];
    }),
  );
}

/** Locks an identifier out after repeated failed logins. */
export function createLoginLimiter({ limit = 5, windowMs = 15 * 60_000 } = {}) {
  const failures = new Map();
  return {
    blocked(key, now = Date.now()) {
      const f = failures.get(key);
      return Boolean(f && now - f.first < windowMs && f.count >= limit);
    },
    fail(key, now = Date.now()) {
      // ponytail: crude memory cap; move to Redis/Firestore if running many instances
      if (failures.size > 10_000) failures.clear();
      const f = failures.get(key);
      if (!f || now - f.first >= windowMs) failures.set(key, { first: now, count: 1 });
      else f.count += 1;
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
