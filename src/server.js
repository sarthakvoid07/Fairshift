import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { HttpError, routes } from './routes.js';
import { createStore } from './store.js';
import { createLoginLimiter, readSession } from './security.js';

const PUBLIC_DIR = join(process.cwd(), 'public') + sep;
const MAX_BODY_BYTES = 16 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
};

export function createApp({ db = createStore(), secret = process.env.SESSION_SECRET } = {}) {
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    console.warn('SESSION_SECRET not set: using a random one. Sessions, QR codes and passport links reset on restart.');
  }
  const limiter = createLoginLimiter();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') return send(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, { db, secret, limiter });
      return await serveStatic(req, res, url.pathname);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'server_error' });
    }
  });
}

async function handleApi(req, res, url, { db, secret, limiter }) {
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) throw new HttpError(404, 'not_found');
  const now = Date.now();

  const session = readSession(req.headers.cookie, secret, now);
  const user = (session && db.users.find((u) => u.id === session.uid)) ?? null;
  if (route.role && !user) throw new HttpError(401, 'unauthenticated');
  if (route.role && user.role !== route.role) throw new HttpError(403, 'forbidden');

  // JSON-only POSTs plus SameSite=Strict cookies block cross-site form submissions (CSRF).
  let body = {};
  if (req.method === 'POST') {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'json_only');
    body = await readJson(req);
  }

  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
  const cookies = [];
  const result = await route.handler({
    db, body, user, now, secret, limiter,
    query: url.searchParams,
    origin: process.env.PUBLIC_URL ?? `${proto}://${req.headers.host}`,
    secure: proto === 'https',
    setCookie: (cookie) => cookies.push(cookie),
  });
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  send(res, 200, result);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      // Stop buffering past the limit; the rest is drained and discarded so the 413 still reaches the client.
      if (size > MAX_BODY_BYTES) reject(new HttpError(413, 'too_large'));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(new HttpError(400, 'bad_json'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
  let decoded;
  try {
    decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    throw new HttpError(400, 'bad_path');
  }
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  const file = join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR) || relative.split(sep).includes('..')) throw new HttpError(404, 'not_found');

  const asset = await loadAsset(file);
  const gzip = Boolean(asset.gzipped && /\bgzip\b/.test(req.headers['accept-encoding'] ?? ''));
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': asset.type,
    'Cache-Control': asset.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : gzip ? asset.gzipped : asset.raw);
}

// Static files are small and fixed per deploy: read and gzip each once (cuts the worker app to a few KB on 2G).
const assets = new Map();
async function loadAsset(file) {
  if (!assets.has(file)) {
    let raw;
    try {
      raw = await readFile(file);
    } catch {
      throw new HttpError(404, 'not_found');
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    const compressible = /^(text\/|image\/svg|application\/(json|manifest))/.test(type);
    assets.set(file, { raw, type, gzipped: compressible ? gzipSync(raw) : null });
  }
  return assets.get(file);
}

function send(res, status, data) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Vercel imports this module through api/index.js and must not open a port.
if (!process.env.VERCEL && process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  createApp().listen(port, () => console.log(`FairShift listening on :${port}`));
}