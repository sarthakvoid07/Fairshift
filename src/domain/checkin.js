import { createHmac } from 'node:crypto';
import { safeEqual, sign } from '../security.js';

/**
 * Site check-in codes rotate every minute and are signed with the server secret,
 * so a photo of the QR forwarded on WhatsApp stops working within minutes.
 */
const WINDOW_MS = 60_000;
const GRACE_WINDOWS = 2; // accept codes up to ~3 minutes old (slow phones, slow networks)

const windowOf = (now) => Math.floor(now / WINDOW_MS);

export function siteToken(siteId, secret, now = Date.now()) {
  const w = windowOf(now);
  return `${siteId}.${w}.${sign(`site:${siteId}:${w}`, secret)}`;
}

/** Returns the site id if the token is genuine and fresh, otherwise null. */
export function verifySiteToken(token, secret, now = Date.now()) {
  const [siteId, w, sig] = String(token).split('.');
  const age = windowOf(now) - Number(w);
  if (!siteId || !sig || !Number.isInteger(age) || age < 0 || age > GRACE_WINDOWS) return null;
  return safeEqual(sig, sign(`site:${siteId}:${w}`, secret)) ? siteId : null;
}

/** Six-digit code shown under the QR for phones that cannot scan. */
export function siteCode(siteId, secret, now = Date.now()) {
  return codeFor(siteId, windowOf(now), secret);
}

export function verifySiteCode(siteId, code, secret, now = Date.now()) {
  const current = windowOf(now);
  for (let w = current; w >= current - GRACE_WINDOWS; w -= 1) {
    if (safeEqual(code, codeFor(siteId, w, secret))) return true;
  }
  return false;
}

function codeFor(siteId, w, secret) {
  const digest = createHmac('sha256', secret).update(`code:${siteId}:${w}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export const secondsLeft = (now = Date.now()) => Math.ceil((WINDOW_MS - (now % WINDOW_MS)) / 1000);
