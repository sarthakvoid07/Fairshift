import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createStore } from '../src/store.js';
import { siteCode, siteToken } from '../src/domain/checkin.js';

delete process.env.GEMINI_API_KEY; // exercise the rule-based fallbacks

const SECRET = 'test-secret';
const db = createStore();
const server = createApp({ db, secret: SECRET });
let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

async function login(body) {
  const res = await call('/api/auth/login', { method: 'POST', body });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.headers.getSetCookie()[0].split(';')[0];
}

const suresh = { kind: 'worker', phone: '9000000001', pin: '1234' };
const skylineAdmin = { kind: 'admin', email: 'admin@skyline.demo', password: 'demo1234' };

test('signed-out visitors get no role and cannot reach private data', async () => {
  assert.deepEqual((await call('/api/me')).data, { role: null });
  assert.equal((await call('/api/worker/home')).status, 401);
  assert.equal((await call('/api/admin/dashboard')).status, 401);
});

test('login rejects a wrong PIN and sets a hardened cookie on success', async () => {
  const wrong = await call('/api/auth/login', { method: 'POST', body: { ...suresh, pin: '0000' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, 'bad_credentials');

  const ok = await call('/api/auth/login', { method: 'POST', body: suresh });
  const cookie = ok.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('repeated wrong PINs lock the account even if the next PIN is right', async () => {
  const ravi = { kind: 'worker', phone: '9000000002', pin: '9999' };
  for (let i = 0; i < 5; i += 1) await call('/api/auth/login', { method: 'POST', body: ravi });
  const res = await call('/api/auth/login', { method: 'POST', body: { ...ravi, pin: '1234' } });
  assert.equal(res.status, 429);
});

test('workers cannot open the employer dashboard', async () => {
  const cookie = await login(suresh);
  assert.equal((await call('/api/admin/dashboard', { cookie })).status, 403);
});

test('worker home has payslip, sector hazards and a signed passport link', async () => {
  const cookie = await login(suresh);
  const { data } = await call('/api/worker/home', { cookie });
  assert.equal(data.org.sector, 'construction');
  assert.ok(data.org.categories.includes('fall') && data.org.categories.includes('pay'));
  assert.ok(data.payslip.gross > 0);
  assert.match(data.passportUrl, /passport\.html\?w=.+&t=.+/);

  const passport = await call(`/api/passport${new URL(data.passportUrl).search}`);
  assert.equal(passport.data.name, 'Suresh Munda');
  assert.equal(passport.data.phone, undefined, 'passport must not expose the phone number');
  assert.equal((await call(`/api/passport?w=${new URL(data.passportUrl).searchParams.get('w')}&t=forged`)).status, 404);
});

test('check-in needs a fresh code for the worker\'s own site', async () => {
  const cookie = await login(suresh);
  const worker = db.users.find((u) => u.phone === '9000000001');
  db.shifts = db.shifts.filter((s) => !(s.workerId === worker.id && !s.end));

  assert.equal((await call('/api/worker/punch', { method: 'POST', cookie, body: { code: '000000' } })).data.error, 'invalid_code');
  const otherSite = siteToken('citycare', SECRET);
  assert.equal((await call('/api/worker/punch', { method: 'POST', cookie, body: { token: otherSite } })).status, 400);

  const start = await call('/api/worker/punch', { method: 'POST', cookie, body: { token: siteToken('skyline', SECRET) } });
  assert.equal(start.data.onShift, true);
  const again = await call('/api/worker/punch', { method: 'POST', cookie, body: { code: siteCode('skyline', SECRET) } });
  assert.equal(again.status, 409, 'an accidental double scan must not end the shift');
});

test('anonymous report: employer never sees who sent it, worker still tracks it by code', async () => {
  const worker = await login(suresh);
  const sent = await call('/api/worker/issues', {
    method: 'POST', cookie: worker,
    body: { category: 'auto', text: 'Loose wire near the lift, sparks seen', anonymous: true, lang: 'en' },
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.category, 'electrical');
  assert.equal(sent.data.severity, 'high');
  assert.equal(db.issues.find((i) => i.code === sent.data.code).reporterId, null);

  const admin = await login(skylineAdmin);
  const listed = (await call('/api/admin/dashboard', { cookie: admin })).data.issues.find((i) => i.code === sent.data.code);
  assert.equal(listed.reporter, null);

  await call('/api/admin/issues', { method: 'POST', cookie: admin, body: { id: listed.id, status: 'resolved', note: 'Wire insulated.' } });
  const mine = await call(`/api/worker/issues?codes=${sent.data.code}`, { cookie: worker });
  const tracked = mine.data.find((i) => i.code === sent.data.code);
  assert.equal(tracked.status, 'resolved');
  assert.equal(tracked.updates[0].note, 'Wire insulated.');
});

test('employers can only touch their own organisation', async () => {
  const admin = await login(skylineAdmin);
  const hospitalIssue = db.issues.find((i) => i.orgId === 'citycare');
  const res = await call('/api/admin/issues', { method: 'POST', cookie: admin, body: { id: hospitalIssue.id, status: 'resolved' } });
  assert.equal(res.status, 404);
  const hospitalWorker = db.users.find((u) => u.orgId === 'citycare' && u.role === 'worker');
  assert.equal((await call('/api/admin/skills', { method: 'POST', cookie: admin, body: { workerId: hospitalWorker.id, name: 'X' } })).status, 404);
});

test('feedback is once a week and stored without any worker identity', async () => {
  const cookie = await login({ kind: 'worker', phone: '9000000004', pin: '1234' });
  const body = { ratings: { respect: 2, safety: 3, pay: 1, workload: 2 }, comment: 'Water please' };
  assert.equal((await call('/api/worker/feedback', { method: 'POST', cookie, body })).status, 200);
  assert.equal((await call('/api/worker/feedback', { method: 'POST', cookie, body })).status, 409);
  assert.equal((await call('/api/worker/feedback', { method: 'POST', cookie, body: { ratings: { respect: 9 } } })).status, 409);

  const saved = db.feedback.find((f) => f.comment === 'Water please');
  assert.deepEqual(Object.keys(saved).sort(), ['comment', 'orgId', 'ratings', 'week']);
});

test('invalid input is rejected cleanly', async () => {
  const cookie = await login(suresh);
  const bad = (body) => call('/api/worker/issues', { method: 'POST', cookie, body });
  assert.equal((await bad({ category: 'needle' })).status, 400, 'hospital hazard on a construction site');
  assert.equal((await bad({ category: 'auto', text: '' })).status, 400);
  assert.equal((await bad({ category: 'fall', text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await call('/api/worker/issues', { method: 'POST', cookie, body: 'not json' })).status, 400);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: JSON.stringify(suresh), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('/api/worker/issues', { method: 'POST', cookie, body: { text: 'x'.repeat(20_000) } })).status, 413);
});

test('employer dashboard and weekly brief work without an AI key', async () => {
  const cookie = await login(skylineAdmin);
  const { data } = await call('/api/admin/dashboard', { cookie });
  assert.equal(data.aiEnabled, false);
  assert.equal(data.attendance.length, 14);
  assert.ok(data.workers.every((w) => Array.isArray(w.risk.reasons)));

  const brief = await call('/api/admin/brief', { method: 'POST', cookie, body: {} });
  assert.equal(brief.data.source, 'rules');
  assert.ok(brief.data.actions.length > 0 && brief.data.actions.length <= 3);

  const qr = await call('/api/admin/qr', { cookie });
  assert.match(qr.data.image, /^data:image\/svg\+xml;base64,/);
  assert.match(qr.data.code, /^\d{6}$/);
});

test('static files are served with security headers and no path traversal', async () => {
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('content-encoding'), 'gzip', 'text assets are compressed for slow networks');
  assert.equal((await call('/..%2fsrc%2fserver.js')).status, 404);
  assert.equal((await call('/%2e%2e/package.json')).status, 404);
});
