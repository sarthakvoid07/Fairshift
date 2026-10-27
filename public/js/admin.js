import { api, h, toast, ICONS } from './common.js';

const CATEGORY = {
  fall: 'Fall from height', electrical: 'Electrical', machinery: 'Machinery', heat: 'Heat or no water', fire: 'Fire or smoke',
  harassment: 'Harassment', other: 'Other', needle: 'Needle injury', biohazard: 'Infectious waste', violence: 'Violence or threat',
  chemical: 'Chemicals', slip: 'Slippery floor', noise: 'Noise', pay: 'Pay dispute',
};
const STATUS = { open: 'Open', acknowledged: 'In progress', resolved: 'Fixed' };
const REASONS = {
  attendance_drop: 'Attendance dropped this week',
  ignored_issue: 'Their complaint is unresolved after 3 days',
  heavy_overtime: 'Over 12 hours overtime this week',
  fatigue: 'Past fatigue limits',
  new_joiner: 'Joined less than 60 days ago',
  low_morale: 'Team morale is low',
};
const FATIGUE = { long_shift: 'Shift over 10h', weekly_limit: 'Over 48h in 7 days', short_rest: 'Under 11h rest', no_rest_day: 'No rest day in 7' };
const DIMENSION = { respect: 'Respect from supervisor', safety: 'Safety at work', pay: 'Fair, on-time pay', workload: 'Workload' };
const LANGUAGE = { en: 'English', hi: 'Hindi', ta: 'Tamil', bn: 'Bengali' };

const $ = (id) => document.getElementById(id);
let data = null;

boot();

async function boot() {
  $('sign-out').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    location.replace('/');
  });
  $('brief-btn').addEventListener('click', loadBrief);

  try {
    await load();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return location.replace('/');
    toast('Could not load the dashboard. Check your connection and refresh.', 'error');
    return;
  }
  loadQr();
  setInterval(() => load().catch(() => {}), 30_000);
}

async function load() {
  data = await api('/api/admin/dashboard');
  $('org-name').textContent = data.org.name;
  $('org-meta').textContent = `${data.org.sectorName}, ${data.org.site}`;
  $('ai-badge').textContent = data.aiEnabled ? 'Gemini on' : 'Rules mode';
  $('ai-badge').dataset.on = String(data.aiEnabled);
  renderKpis();
  renderIssues();
  renderWorkers();
  renderAttendance();
  renderFeedback();
}

function ago(ts) {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

// ---------- KPIs ----------

function renderKpis() {
  const k = data.kpis;
  const kpi = (value, label, note, warn = false) =>
    h('div', { class: `kpi${warn ? ' warn' : ''}` },
      h('span', { class: 'kpi-value' }, value),
      h('span', { class: 'kpi-label' }, label),
      note ? h('span', { class: 'kpi-note' }, note) : null);

  $('kpis').replaceChildren(
    kpi(`${k.onShift}/${k.workers}`, 'On shift now'),
    kpi(String(k.openIssues), 'Open reports', k.overdue ? `${k.overdue} overdue` : 'None overdue', k.overdue > 0),
    kpi(String(k.fatigued), 'Past fatigue limits', 'workers this week', k.fatigued > 0),
    kpi(String(k.highRisk), 'High risk of leaving', 'workers', k.highRisk > 0),
    kpi(k.morale === null ? 'Hidden' : `${k.morale}/5`, 'Team morale', k.morale === null ? 'Needs 3 responses' : 'anonymous average', k.morale !== null && k.morale < 3),
  );
}

// ---------- Issues ----------

function renderIssues() {
  const open = data.issues.filter((i) => i.status !== 'resolved').length;
  $('issues-count').textContent = `${open} open of ${data.issues.length}`;
  $('issues').replaceChildren(...data.issues.map(issueItem));
}

function issueItem(issue) {
  const last = issue.updates.at(-1);
  return h('li', { class: `issue sev-${issue.severity} ${issue.status}` },
    h('div', { class: 'issue-main' },
      h('div', { class: 'issue-meta' },
        h('span', { class: `sev sev-${issue.severity}` }, issue.severity),
        h('span', { class: 'issue-cat' }, h('span', { 'aria-hidden': 'true' }, `${ICONS[issue.category]} `), CATEGORY[issue.category]),
        issue.overdue ? h('span', { class: 'overdue' }, 'Overdue') : null,
        h('span', { class: 'muted' }, `${issue.code}, ${ago(issue.createdAt)}`)),
      h('p', { class: 'issue-summary' }, issue.summary ?? issue.text),
      issue.lang !== 'en' && issue.summary
        ? h('p', { class: 'issue-original' }, `${LANGUAGE[issue.lang]} original: `, h('span', { lang: issue.lang }, issue.text))
        : null,
      h('p', { class: 'muted small' },
        issue.reporter ? `Reported by ${issue.reporter}` : 'Anonymous report',
        issue.aiTriaged ? ', triaged by Gemini' : ''),
      last ? h('p', { class: 'small update' }, `${STATUS[last.status]}: ${last.note || 'no note'}`) : null),
    h('div', { class: 'issue-side' },
      h('span', { class: `status-chip ${issue.status}` }, STATUS[issue.status]),
      issue.status !== 'resolved'
        ? h('button', { class: 'btn secondary small', type: 'button', onclick: () => openIssue(issue) }, 'Update', h('span', { class: 'sr-only' }, ` ${issue.code}`))
        : null));
}

function openIssue(issue) {
  const dialog = $('issue-dialog');
  $('issue-dialog-title').textContent = `Update ${issue.code}`;
  $('issue-dialog-text').textContent = issue.summary ?? issue.text;
  $('issue-status').value = issue.status === 'open' ? 'acknowledged' : 'resolved';
  $('issue-note').value = '';
  dialog.onclose = async () => {
    if (dialog.returnValue !== 'save') return;
    try {
      await api('/api/admin/issues', {
        method: 'POST',
        body: { id: issue.id, status: $('issue-status').value, note: $('issue-note').value.trim() },
      });
      toast(`${issue.code} updated. The worker sees it in My reports.`, 'ok');
      await load();
    } catch {
      toast('Could not save the update. Try again.', 'error');
    }
  };
  dialog.showModal();
}

// ---------- Workforce ----------

function renderWorkers() {
  $('workers').replaceChildren(
    ...data.workers.map((w) =>
      h('tr', {},
        h('th', { scope: 'row' },
          h('div', { class: 'cell-stack' },
            h('span', { class: 'worker-name' }, w.name),
            h('span', { class: 'muted small' }, w.trade),
            w.onShift ? h('span', { class: 'on-shift' }, 'On shift') : null)),
        h('td', {},
          h('div', { class: 'cell-stack num' },
            h('span', {}, `${w.weekHours} h`),
            h('span', { class: w.overtime ? 'ot small' : 'muted small' }, `${w.overtime} h overtime`))),
        h('td', {},
          w.fatigue.length
            ? h('ul', { class: 'chips' }, w.fatigue.map((f) => h('li', { class: 'chip warn' }, FATIGUE[f])))
            : h('span', { class: 'muted small' }, 'OK')),
        h('td', {}, riskCell(w.risk)),
        h('td', {},
          h('span', { class: 'num' }, String(w.skills)),
          h('button', { class: 'btn secondary small', type: 'button', onclick: () => openSkill(w) }, 'Add', h('span', { class: 'sr-only' }, ` skill for ${w.name}`))))),
  );
}

function riskCell(risk) {
  const meter = h('span', { class: `meter ${risk.level}`, role: 'img', 'aria-label': `${risk.score} out of 100, ${risk.level}` }, h('span', {}));
  meter.firstChild.style.setProperty('--w', `${risk.score}%`);
  return h('div', { class: 'risk' },
    h('div', { class: 'risk-top' }, meter, h('span', { class: `risk-level ${risk.level}` }, `${risk.level} (${risk.score})`)),
    risk.reasons.length ? h('ul', { class: 'reasons' }, risk.reasons.map((r) => h('li', {}, REASONS[r]))) : null);
}

function openSkill(worker) {
  const dialog = $('skill-dialog');
  $('skill-dialog-title').textContent = `Add a skill for ${worker.name}`;
  $('skill-name').value = '';
  dialog.onclose = async () => {
    const name = $('skill-name').value.trim();
    if (dialog.returnValue !== 'save' || !name) return;
    try {
      await api('/api/admin/skills', { method: 'POST', body: { workerId: worker.id, name } });
      toast(`Added to ${worker.name}'s skill passport.`, 'ok');
      await load();
    } catch {
      toast('Could not add the skill. Try again.', 'error');
    }
  };
  dialog.showModal();
}

// ---------- Attendance and feedback ----------

function renderAttendance() {
  const max = data.kpis.workers || 1;
  $('attendance').replaceChildren(
    ...data.attendance.map(({ day, present }) => {
      const d = new Date(`${day}T12:00:00+05:30`);
      const weekday = d.toLocaleDateString('en-IN', { weekday: 'narrow', timeZone: 'Asia/Kolkata' });
      const full = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
      const bar = h('span', { class: 'bar', 'aria-hidden': 'true' });
      bar.style.setProperty('--h', `${(present / max) * 100}%`);
      return h('li', { title: `${full}: ${present} of ${max}` },
        bar,
        h('span', { class: 'bar-value', 'aria-hidden': 'true' }, String(present)),
        h('span', { class: 'bar-label', 'aria-hidden': 'true' }, weekday),
        h('span', { class: 'sr-only' }, `${full}: ${present} of ${max} present`));
    }),
  );
}

function renderFeedback() {
  const f = data.feedback;
  if (f.hidden) {
    $('feedback').replaceChildren(
      h('p', { class: 'locked' },
        h('strong', {}, `${f.count} of ${f.minGroup} responses so far.`),
        ' Scores appear once at least 3 people answer, so no one can be identified from their answers.'),
    );
    return;
  }
  const rows = Object.entries(f.averages).map(([dim, avg]) => {
    const fill = h('span', {});
    fill.style.setProperty('--w', `${(avg / 5) * 100}%`);
    return h('li', { class: avg < 3 ? 'low' : '' },
      h('span', { class: 'fb-label' }, DIMENSION[dim]),
      h('span', { class: 'fb-bar', 'aria-hidden': 'true' }, fill),
      h('span', { class: 'fb-value num' }, `${avg}/5`));
  });
  $('feedback').replaceChildren(
    h('p', { class: 'muted small' }, `${f.count} anonymous responses. Overall ${f.overall}/5.`),
    h('ul', { class: 'fb-rows' }, rows),
    f.comments.length ? h('ul', { class: 'comments' }, f.comments.map((c) => h('li', {}, c))) : null,
  );
}

// ---------- Check-in QR and weekly brief ----------

let qrTimer;
async function loadQr() {
  clearInterval(qrTimer);
  try {
    const qr = await api('/api/admin/qr');
    $('qr-img').src = qr.image;
    $('qr-code').textContent = qr.code;
    let left = qr.secondsLeft;
    const tick = () => {
      $('qr-timer').textContent = `New code in ${left}s`;
      if (left-- <= 0) loadQr();
    };
    tick();
    qrTimer = setInterval(tick, 1000);
  } catch {
    $('qr-timer').textContent = 'Could not load the check-in code. Retrying.';
    setTimeout(loadQr, 5000);
  }
}

async function loadBrief() {
  const button = $('brief-btn');
  button.disabled = true;
  button.textContent = 'Writing...';
  try {
    const result = await api('/api/admin/brief', { method: 'POST', body: {} });
    $('brief').replaceChildren(...result.actions.map((a) => h('li', {}, a)));
    $('brief-source').textContent =
      result.source === 'gemini'
        ? 'Written by Gemini from anonymous totals. No names leave the server.'
        : 'Built from FairShift rules. Add a Gemini API key for AI-written briefs.';
  } catch {
    toast('Could not write the brief. Try again.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Write my weekly brief';
  }
}
