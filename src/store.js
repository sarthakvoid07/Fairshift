import { randomUUID } from 'node:crypto';
import { hashSecret } from './security.js';
import { DAY, HOUR, startOfDay, weekKey, TZ_OFFSET } from './domain/time.js';

/**
 * In-memory data store, seeded with realistic demo data on every start.
 * ponytail: single-process memory, so deploy with --max-instances=1.
 * Swap these arrays for Firestore collections when you need persistence.
 */
export function createStore(now = Date.now()) {
  const db = { orgs: [], users: [], shifts: [], issues: [], feedback: [], feedbackKeys: new Set(), skills: [] };
  seed(db, now);
  return db;
}

// Public demo accounts so judges can try every role. Only hashes are kept in memory.
const DEMO_PIN = '1234';
const DEMO_PASSWORD = 'demo1234';

const ORGS = [
  { id: 'skyline', name: 'Skyline Constructions', site: 'Site 14, OMR, Chennai', sector: 'construction', admin: 'admin@skyline.demo' },
  { id: 'citycare', name: 'CityCare Hospital', site: 'Anna Nagar, Chennai', sector: 'hospital', admin: 'admin@citycare.demo' },
  { id: 'greenfield', name: 'Greenfield College', site: 'Main campus facilities', sector: 'campus', admin: 'admin@greenfield.demo' },
];

// [org, name, phone, trade, daily wage, language, work pattern, tenure in days, skills]
const WORKERS = [
  ['skyline', 'Suresh Munda', '9000000001', 'Bar bender', 750, 'hi', 'overworked', 200, ['Bar bending and steel fixing']],
  ['skyline', 'Ravi Kumar', '9000000002', 'Mason', 900, 'ta', 'steady', 400, ['Brick masonry (NSDC level 4)', 'Working at height']],
  ['skyline', 'Anjali Das', '9000000003', 'Painter', 700, 'bn', 'fading', 35, []],
  ['skyline', 'Murugan S', '9000000004', 'Scaffolder', 850, 'ta', 'steady', 900, ['Scaffold erection', 'First aid']],
  ['skyline', 'Abdul Rahman', '9000000005', 'Electrician', 1000, 'hi', 'overworked', 300, ['Wiring (ITI certified)', 'Lockout and tagout']],
  ['citycare', 'Kavitha R', '9000000011', 'Sanitation staff', 600, 'ta', 'overworked', 120, ['Biomedical waste segregation']],
  ['citycare', 'Priya Nair', '9000000012', 'Ward assistant', 650, 'en', 'steady', 500, ['Infection control', 'Patient handling']],
  ['citycare', 'Ramesh Yadav', '9000000013', 'Security guard', 700, 'hi', 'fading', 40, []],
  ['citycare', 'Fatima Begum', '9000000014', 'Housekeeping', 600, 'bn', 'steady', 700, ['Hospital housekeeping']],
  ['greenfield', 'Selvi M', '9000000021', 'Housekeeping', 550, 'ta', 'steady', 600, ['Housekeeping']],
  ['greenfield', 'Joseph Mathew', '9000000022', 'Electrician', 800, 'en', 'overworked', 250, ['Electrical maintenance']],
  ['greenfield', 'Manoj Singh', '9000000023', 'Gardener', 500, 'hi', 'fading', 30, []],
];

function seed(db, now) {
  const random = mulberry32(8);
  const today = startOfDay(now);

  for (const org of ORGS) {
    db.orgs.push({ id: org.id, name: org.name, site: org.site, sector: org.sector });
    db.users.push({
      id: randomUUID(), role: 'admin', orgId: org.id, email: org.admin,
      name: `${org.name} admin`, secretHash: hashSecret(DEMO_PASSWORD),
    });
  }

  for (const [orgId, name, phone, trade, dailyWage, lang, pattern, tenure, skills] of WORKERS) {
    const worker = {
      id: randomUUID(), role: 'worker', orgId, name, phone, trade, dailyWage, lang,
      joinedAt: today - tenure * DAY,
      pf: orgId !== 'skyline' || tenure > 365,
      esi: orgId !== 'skyline' || tenure > 365,
      advance: pattern === 'overworked' && orgId === 'skyline' ? 1000 : 0,
      secretHash: hashSecret(DEMO_PIN),
    };
    db.users.push(worker);
    const org = ORGS.find((o) => o.id === orgId);
    for (const skill of skills) {
      db.skills.push({ workerId: worker.id, name: skill, issuer: org.name, verifiedAt: worker.joinedAt + 20 * DAY });
    }

    for (let ago = 20; ago >= 0; ago -= 1) {
      const day = today - ago * DAY;
      const weekday = new Date(day + TZ_OFFSET).getUTCDay();
      const works =
        pattern === 'overworked' ||
        (pattern === 'steady' && weekday !== 0) ||
        (pattern === 'fading' && (ago > 7 ? weekday !== 0 : ago === 6 || ago === 3));
      if (!works) continue;

      const startHour = pattern === 'overworked' ? 7 : 8;
      const start = day + startHour * HOUR + Math.round(random() * 20) * 60_000;
      const length = pattern === 'overworked' ? 10.5 + random() * 1.5 : 7.5 + random() * 0.5;
      if (start > now) continue;
      const end = start + length * HOUR;
      db.shifts.push({ id: randomUUID(), workerId: worker.id, orgId, start, end: end > now ? null : end });
    }
  }

  seedIssues(db, now);
  seedFeedback(db, now);
}

function seedIssues(db, now) {
  const by = (name) => db.users.find((u) => u.name === name).id;
  const issue = (fields) => db.issues.push({
    id: randomUUID(), reporterId: null, summary: null, updates: [], aiTriaged: false, ...fields, code: `FS-${fields.code}`,
  });

  issue({ code: 'K7Q2M', orgId: 'skyline', reporterId: by('Murugan S'), category: 'fall', severity: 'critical', lang: 'ta',
    text: 'மூன்றாவது மாடி கிழக்குப் பக்க சாரத்தின் கைப்பிடி உடைந்துள்ளது. ஒருவர் கிட்டத்தட்ட விழுந்தார்.',
    summary: 'Scaffold guardrail on the 3rd floor east side is broken; a worker nearly fell.',
    status: 'open', createdAt: now - 3 * HOUR });
  issue({ code: 'P3X8D', orgId: 'skyline', reporterId: by('Anjali Das'), category: 'pay', severity: 'medium', lang: 'bn',
    text: 'গত রবিবারের ওভারটাইমের টাকা পাইনি।',
    summary: 'Overtime for last Sunday was not paid.',
    status: 'open', createdAt: now - 5 * DAY });
  issue({ code: 'W9H4T', orgId: 'skyline', category: 'electrical', severity: 'high', lang: 'hi',
    text: 'मिक्सर के पास बिजली का तार खुला है, पास में पानी भरा है।',
    summary: 'Exposed electrical wire beside the cement mixer with water pooling around it.',
    status: 'acknowledged', createdAt: now - 26 * HOUR,
    updates: [{ status: 'acknowledged', note: 'Electrician assigned. Area taped off until fixed.',
      noteTranslated: 'इलेक्ट्रीशियन को भेजा गया है। ठीक होने तक जगह को घेर दिया गया है।', at: now - 20 * HOUR }] });
  issue({ code: 'B2N6R', orgId: 'citycare', reporterId: by('Kavitha R'), category: 'needle', severity: 'high', lang: 'ta',
    text: 'வார்டு 4-ல் ஊசி குப்பைத் தொட்டி நிரம்பி வழிகிறது.',
    summary: 'Sharps disposal bin in Ward 4 is overflowing.',
    status: 'resolved', createdAt: now - 2 * DAY,
    updates: [{ status: 'resolved', note: 'New sharps bins placed. Collection now twice a day.',
      noteTranslated: 'புதிய ஊசி தொட்டிகள் வைக்கப்பட்டுள்ளன. இனி தினமும் இரண்டு முறை எடுக்கப்படும்.', at: now - DAY }] });
  issue({ code: 'V5J1C', orgId: 'citycare', category: 'violence', severity: 'high', lang: 'en',
    text: 'A patient relative threatened the night staff at the emergency desk. No guard was there.',
    summary: 'Night staff at the emergency desk were threatened by a patient relative; no guard present.',
    status: 'open', createdAt: now - 30 * HOUR });
  issue({ code: 'R8L3F', orgId: 'citycare', reporterId: by('Ramesh Yadav'), category: 'pay', severity: 'medium', lang: 'hi',
    text: 'दो हफ्ते से रात की शिफ्ट का भत्ता नहीं मिला।',
    summary: 'Night shift allowance not paid for two weeks.',
    status: 'open', createdAt: now - 4 * DAY });
  issue({ code: 'G4S7E', orgId: 'greenfield', reporterId: by('Manoj Singh'), category: 'electrical', severity: 'high', lang: 'hi',
    text: 'बगीचे के पंप का सॉकेट चालू करने पर चिंगारी देता है।',
    summary: 'Garden pump socket sparks when switched on.',
    status: 'open', createdAt: now - 6 * DAY });
  issue({ code: 'M6T9A', orgId: 'greenfield', reporterId: by('Selvi M'), category: 'slip', severity: 'medium', lang: 'ta',
    text: 'நூலக படிக்கட்டு அருகே தரை ஈரமாக உள்ளது, எச்சரிக்கை பலகை இல்லை.',
    summary: 'Wet floor near the library stairs with no warning sign.',
    status: 'acknowledged', createdAt: now - 20 * HOUR,
    updates: [{ status: 'acknowledged', note: 'Sign boards ordered, mopping schedule changed.',
      noteTranslated: 'எச்சரிக்கை பலகைகள் வாங்கப்படுகின்றன, துடைக்கும் நேரம் மாற்றப்பட்டுள்ளது.', at: now - 10 * HOUR }] });
}

function seedFeedback(db, now) {
  const rows = [
    ['skyline', [2, 3, 2, 2], 'Supervisor shouts at the helpers in front of everyone.'],
    ['skyline', [3, 2, 2, 2], 'Need shade and drinking water at lunch time.'],
    ['skyline', [4, 3, 2, 3], 'Payment comes late every month.'],
    ['skyline', [3, 3, 3, 2], null],
    ['skyline', [2, 2, 1, 2], 'Overtime is not counted properly.'],
    ['citycare', [4, 4, 3, 3], 'Night shifts are too long.'],
    ['citycare', [4, 3, 4, 3], null],
    ['greenfield', [4, 4, 3, 4], 'Good team, but no raincoats during monsoon.'],
    ['greenfield', [5, 4, 4, 4], null],
    ['greenfield', [3, 4, 3, 3], 'Please fix the broken socket in the garden shed.'],
  ];
  rows.forEach(([orgId, [respect, safety, pay, workload], comment], i) => {
    db.feedback.push({ orgId, week: weekKey(now - (i % 3) * 7 * DAY), ratings: { respect, safety, pay, workload }, comment });
  });
}

/** Small deterministic PRNG so demo data looks the same on every start. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
