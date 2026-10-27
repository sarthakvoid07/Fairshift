import { randomInt, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { createSession, hashSecret, sessionCookie, sign, safeEqual, verifySecret } from './security.js';
import { SECTORS, LANGS, categoriesFor } from './domain/sectors.js';
import { DAY, dayKey, weekKey, oneDecimal } from './domain/time.js';
import { computePayslip, shiftHours, splitHours } from './domain/pay.js';
import { fatigueFlags } from './domain/fatigue.js';
import { quitRisk } from './domain/risk.js';
import { aggregateFeedback, DIMENSIONS } from './domain/feedback.js';
import { compareIssues, isOverdue, maxSeverity, triageByRules } from './domain/issues.js';
import { secondsLeft, siteCode, siteToken, verifySiteCode, verifySiteToken } from './domain/checkin.js';
import { aiEnabled, translateForWorker, triageIssue, weeklyBrief } from './ai.js';

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

const fail = (status, code) => {
  throw new HttpError(status, code);
};

/** Validated string input: trims, enforces a max length, optional by default. */
function text(value, max, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(400, 'missing_field');
    return '';
  }
  if (typeof value !== 'string' || value.length > max) fail(400, 'invalid_field');
  return value.trim();
}

const PAY_PERIOD_DAYS = 30;
const MIN_SHIFT_MS = 5 * 60_000; // ignore an accidental double scan
const DUMMY_HASH = hashSecret('timing-equaliser');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const orgOf = (db, user) => db.orgs.find((o) => o.id === user.orgId);
const shiftsOf = (db, workerId) => db.shifts.filter((s) => s.workerId === workerId);
const passportToken = (workerId, secret) => sign(`passport:${workerId}`, secret, 16);
const feedbackKey = (workerId, now, secret) => sign(`feedback:${workerId}:${weekKey(now)}`, secret);
const issueCode = () => `FS-${Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

// ---------- Auth ----------

async function login({ db, body, now, limiter, setCookie, secret, secure }) {
  const asWorker = body.kind === 'worker';
  const id = asWorker ? text(body.phone, 15, { required: true }) : text(body.email, 120, { required: true }).toLowerCase();
  const key = `${asWorker ? 'w' : 'a'}:${id}`;
  if (limiter.blocked(key, now)) fail(429, 'too_many_attempts');

  const user = db.users.find((u) => (asWorker ? u.role === 'worker' && u.phone === id : u.role === 'admin' && u.email === id));
  const secretIn = text(asWorker ? body.pin : body.password, 100, { required: true });
  // Hash even for unknown users so response time does not reveal which accounts exist.
  const valid = verifySecret(secretIn, user?.secretHash ?? DUMMY_HASH) && Boolean(user);
  if (!valid) {
    limiter.fail(key, now);
    fail(401, 'bad_credentials');
  }
  limiter.reset(key);
  setCookie(sessionCookie(createSession(user, secret, now), { secure }));
  return { role: user.role };
}

function logout({ setCookie, secure }) {
  setCookie(sessionCookie('', { secure, maxAgeSeconds: 0 }));
  return { ok: true };
}

const me = ({ user }) => (user ? { role: user.role, name: user.name, lang: user.lang ?? 'en' } : { role: null });

// ---------- Worker ----------

function workerHome({ db, user, now, secret, origin }) {
  const org = orgOf(db, user);
  const shifts = shiftsOf(db, user.id);
  const open = shifts.find((s) => !s.end);
  const week = splitHours(shifts.filter((s) => s.start >= now - 7 * DAY));
  return {
    worker: { name: user.name, trade: user.trade, lang: user.lang },
    org: { name: org.name, site: org.site, sector: org.sector, categories: categoriesFor(org.sector) },
    shift: open ? { start: open.start } : null,
    fatigue: fatigueFlags(shifts, now),
    week: { hours: oneDecimal(week.total), overtime: oneDecimal(week.overtime) },
    payslip: { periodDays: PAY_PERIOD_DAYS, ...computePayslip(user, shifts.filter((s) => s.start >= now - PAY_PERIOD_DAYS * DAY)) },
    skills: db.skills.filter((s) => s.workerId === user.id).map(({ name, issuer, verifiedAt }) => ({ name, issuer, verifiedAt })),
    passportUrl: `${origin}/passport.html?w=${user.id}&t=${passportToken(user.id, secret)}`,
    feedbackDone: db.feedbackKeys.has(feedbackKey(user.id, now, secret)),
    openIssues: db.issues.filter((i) => i.reporterId === user.id && i.status !== 'resolved').length,
  };
}

function punch({ db, body, user, now, secret }) {
  const valid = body.token
    ? verifySiteToken(text(body.token, 200), secret, now) === user.orgId
    : verifySiteCode(user.orgId, text(body.code, 6, { required: true }), secret, now);
  if (!valid) fail(400, 'invalid_code');

  const open = db.shifts.find((s) => s.workerId === user.id && !s.end);
  if (open) {
    if (now - open.start < MIN_SHIFT_MS) fail(409, 'just_started');
    open.end = now;
    return { onShift: false, hours: oneDecimal(shiftHours(open)) };
  }
  db.shifts.push({ id: randomUUID(), workerId: user.id, orgId: user.orgId, start: now, end: null });
  return { onShift: true, start: now, fatigue: fatigueFlags(shiftsOf(db, user.id), now) };
}

async function createIssue({ db, body, user, now }) {
  const org = orgOf(db, user);
  const allowed = categoriesFor(org.sector);
  const chosen = body.category && body.category !== 'auto' ? body.category : null;
  if (chosen && !allowed.includes(chosen)) fail(400, 'bad_category');
  const description = text(body.text, 1000);
  if (!chosen && !description) fail(400, 'empty_report');
  const lang = LANGS.includes(body.lang) ? body.lang : user.lang;

  const rules = triageByRules(description, allowed, chosen);
  const ai = description ? await triageIssue({ text: description, lang, categories: allowed, sector: org.sector }) : null;
  const issue = {
    id: randomUUID(),
    code: issueCode(),
    orgId: org.id,
    // Anonymous reports store no link to the worker at all; they track status by code on their own phone.
    reporterId: body.anonymous === true ? null : user.id,
    category: chosen ?? ai?.category ?? rules.category,
    severity: maxSeverity(rules.severity, ai?.severity), // safety first: never downgrade the rule-based severity
    text: description,
    summary: ai?.summary ?? null,
    lang,
    status: 'open',
    createdAt: now,
    updates: [],
    aiTriaged: Boolean(ai),
  };
  db.issues.push(issue);
  return { code: issue.code, category: issue.category, severity: issue.severity, status: issue.status };
}

function myIssues({ db, user, query }) {
  const codes = new Set((query.get('codes') ?? '').split(',').filter(Boolean).slice(0, 50));
  return db.issues
    .filter((i) => i.orgId === user.orgId && (i.reporterId === user.id || codes.has(i.code)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((i) => ({
      code: i.code, category: i.category, severity: i.severity, status: i.status, createdAt: i.createdAt,
      anonymous: i.reporterId === null,
      updates: i.updates.map((u) => ({ status: u.status, note: u.noteTranslated ?? u.note, at: u.at })),
    }));
}

function submitFeedback({ db, body, user, now, secret }) {
  const key = feedbackKey(user.id, now, secret);
  if (db.feedbackKeys.has(key)) fail(409, 'already_submitted');
  const ratings = {};
  for (const dim of DIMENSIONS) {
    const value = body.ratings?.[dim];
    if (!Number.isInteger(value) || value < 1 || value > 5) fail(400, 'bad_rating');
    ratings[dim] = value;
  }
  const comment = text(body.comment, 500) || null;

  // "Who answered" and "what was answered" are kept apart, like a voters' register
  // and a ballot box: entries hold no worker id or timestamp, only org and week,
  // and are inserted at a random position so order cannot link them either.
  db.feedbackKeys.add(key);
  db.feedback.splice(randomInt(db.feedback.length + 1), 0, { orgId: user.orgId, week: weekKey(now), ratings, comment });
  return { ok: true };
}

function passport({ db, query, secret }) {
  const workerId = query.get('w') ?? '';
  if (!safeEqual(query.get('t') ?? '', passportToken(workerId, secret))) fail(404, 'not_found');
  const worker = db.users.find((u) => u.id === workerId && u.role === 'worker');
  if (!worker) fail(404, 'not_found');
  const shifts = shiftsOf(db, worker.id).filter((s) => s.end);
  return {
    name: worker.name,
    trade: worker.trade,
    since: worker.joinedAt,
    employer: orgOf(db, worker).name,
    verifiedDays: new Set(shifts.map((s) => dayKey(s.start))).size,
    verifiedHours: Math.round(splitHours(shifts).total),
    skills: db.skills.filter((s) => s.workerId === worker.id).map(({ name, issuer, verifiedAt }) => ({ name, issuer, verifiedAt })),
  };
}

// ---------- Employer ----------

function buildDashboard(db, user, now) {
  const org = orgOf(db, user);
  const workers = db.users.filter((u) => u.role === 'worker' && u.orgId === org.id);
  const issues = db.issues.filter((i) => i.orgId === org.id);
  const feedback = aggregateFeedback(db.feedback.filter((f) => f.orgId === org.id && f.week >= weekKey(now - 28 * DAY)));
  const morale = feedback.hidden ? null : feedback.overall;

  const rows = workers
    .map((w) => {
      const shifts = shiftsOf(db, w.id);
      const week = splitHours(shifts.filter((s) => s.start >= now - 7 * DAY));
      return {
        id: w.id, name: w.name, trade: w.trade,
        onShift: shifts.some((s) => !s.end),
        weekHours: oneDecimal(week.total),
        overtime: oneDecimal(week.overtime),
        fatigue: fatigueFlags(shifts, now),
        risk: quitRisk({ worker: w, shifts, issues, siteMorale: morale, now }),
        skills: db.skills.filter((s) => s.workerId === w.id).length,
      };
    })
    .sort((a, b) => b.risk.score - a.risk.score);

  const attendance = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(now - (13 - i) * DAY);
    const present = new Set(db.shifts.filter((s) => s.orgId === org.id && dayKey(s.start) === day).map((s) => s.workerId)).size;
    return { day, present };
  });

  const issueRows = [...issues].sort(compareIssues).map((i) => ({
    id: i.id, code: i.code, category: i.category, severity: i.severity, status: i.status,
    text: i.text, summary: i.summary, lang: i.lang, createdAt: i.createdAt, aiTriaged: i.aiTriaged,
    reporter: i.reporterId ? db.users.find((u) => u.id === i.reporterId)?.name ?? null : null,
    overdue: isOverdue(i, now),
    updates: i.updates.map(({ status, note, at }) => ({ status, note, at })),
  }));

  return {
    org: { name: org.name, site: org.site, sector: org.sector, sectorName: SECTORS[org.sector].name },
    aiEnabled: aiEnabled(),
    kpis: {
      workers: workers.length,
      onShift: rows.filter((r) => r.onShift).length,
      openIssues: issues.filter((i) => i.status !== 'resolved').length,
      overdue: issueRows.filter((i) => i.overdue).length,
      fatigued: rows.filter((r) => r.fatigue.length).length,
      highRisk: rows.filter((r) => r.risk.level === 'high').length,
      morale,
    },
    attendance,
    issues: issueRows,
    workers: rows,
    feedback,
  };
}

const dashboard = ({ db, user, now }) => buildDashboard(db, user, now);

async function qr({ user, now, secret, origin }) {
  const url = `${origin}/worker.html#punch=${siteToken(user.orgId, secret, now)}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return {
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    code: siteCode(user.orgId, secret, now),
    secondsLeft: secondsLeft(now),
  };
}

async function updateIssue({ db, body, user, now }) {
  const issue = db.issues.find((i) => i.id === body.id && i.orgId === user.orgId);
  if (!issue) fail(404, 'not_found');
  if (!['acknowledged', 'resolved'].includes(body.status)) fail(400, 'bad_status');
  const note = text(body.note, 300);
  issue.status = body.status;
  issue.updates.push({ status: body.status, note, noteTranslated: note ? await translateForWorker(note, issue.lang) : null, at: now });
  return { ok: true };
}

function addSkill({ db, body, user, now }) {
  const worker = db.users.find((u) => u.id === body.workerId && u.role === 'worker' && u.orgId === user.orgId);
  if (!worker) fail(404, 'not_found');
  db.skills.push({ workerId: worker.id, name: text(body.name, 80, { required: true }), issuer: orgOf(db, user).name, verifiedAt: now });
  return { ok: true };
}

/** Plain rules that always work; Gemini rewrites them into sharper actions when configured. */
function ruleBrief(d) {
  const actions = [];
  const overdue = d.issues.filter((i) => i.overdue);
  if (overdue.length) actions.push(`Act on ${overdue.length} overdue safety report${overdue.length > 1 ? 's' : ''}, starting with ${overdue[0].code} (${overdue[0].severity}).`);
  if (d.kpis.fatigued) actions.push(`Rotate shifts for ${d.kpis.fatigued} worker${d.kpis.fatigued > 1 ? 's' : ''} past fatigue limits and give a weekly rest day.`);
  if (d.kpis.highRisk) actions.push(`Talk one-to-one with ${d.kpis.highRisk} worker${d.kpis.highRisk > 1 ? 's' : ''} at high risk of leaving; close their open complaints first.`);
  if (!d.feedback.hidden) {
    const [lowest] = Object.entries(d.feedback.averages).sort((a, b) => a[1] - b[1]);
    actions.push(`Lowest feedback score is ${lowest[0]} (${lowest[1]}/5). Share one fix with the team this week.`);
  }
  return actions.slice(0, 3);
}

async function brief({ db, user, now }) {
  const d = buildDashboard(db, user, now);
  const metrics = {
    sector: d.org.sectorName,
    ...d.kpis,
    overtimeHoursThisWeek: oneDecimal(d.workers.reduce((s, w) => s + w.overtime, 0)),
    openIssuesByCategory: d.issues.filter((i) => i.status !== 'resolved').map((i) => `${i.category}:${i.severity}${i.overdue ? ':overdue' : ''}`),
    feedbackAverages: d.feedback.hidden ? 'hidden (fewer than 3 responses)' : d.feedback.averages,
    quitRiskReasons: d.workers.flatMap((w) => w.risk.reasons),
  };
  const ai = await weeklyBrief(metrics);
  return { source: ai ? 'gemini' : 'rules', actions: ai ?? ruleBrief(d) };
}

/** Route table. `role` gates access; routes without a role are public. */
export const routes = {
  'POST /api/auth/login': { handler: login },
  'POST /api/auth/logout': { handler: logout },
  'GET /api/me': { handler: me },
  'GET /api/passport': { handler: passport },
  'GET /api/worker/home': { role: 'worker', handler: workerHome },
  'POST /api/worker/punch': { role: 'worker', handler: punch },
  'POST /api/worker/issues': { role: 'worker', handler: createIssue },
  'GET /api/worker/issues': { role: 'worker', handler: myIssues },
  'POST /api/worker/feedback': { role: 'worker', handler: submitFeedback },
  'GET /api/admin/dashboard': { role: 'admin', handler: dashboard },
  'GET /api/admin/qr': { role: 'admin', handler: qr },
  'POST /api/admin/issues': { role: 'admin', handler: updateIssue },
  'POST /api/admin/skills': { role: 'admin', handler: addSkill },
  'POST /api/admin/brief': { role: 'admin', handler: brief },
};
