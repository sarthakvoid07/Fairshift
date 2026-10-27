import {
  api, t, h, speak, rupees, clock, date, toast, setLang, getLang, hasStoredLang,
  fillLangSelect, applyI18n, storedList, storeList, ICONS,
} from './common.js';
import { SPEECH_LANG } from './i18n.js';

const main = document.getElementById('main');
const CODES_KEY = 'fs_issue_codes'; // anonymous report codes live only on this phone
const PUNCH_KEY = 'fs_punch';
const DIMENSIONS = ['respect', 'safety', 'pay', 'workload'];
const FACES = ['😠', '🙁', '😐', '🙂', '😄'];
const LINE_ICONS = { basic: '🕗', overtime: '⏱️', pf: '🏦', esi: '🏥', advance: '💵' };
const STATUS_ICONS = { open: '⏳', acknowledged: '👀', resolved: '✅' };

const views = { '': renderHome, pay: renderPay, report: renderReport, voice: renderVoice, skills: renderSkills, reports: renderReports };

let home = null;
let clockTimer = null;
let presetCategory = null;

// Scanning the site QR with the phone's own camera opens worker.html#punch=<token>.
const scanned = location.hash.match(/punch=([\w.-]+)/);
if (scanned) {
  sessionStorage.setItem(PUNCH_KEY, scanned[1]);
  history.replaceState(null, '', location.pathname);
}

boot();

async function boot() {
  applyI18n();
  fillLangSelect(document.getElementById('lang'), () => show());
  document.getElementById('sign-out').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    location.replace('/');
  });

  try {
    await refresh();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return location.replace('/');
    return main.replaceChildren(h('p', { class: 'error' }, t(err.message)));
  }
  if (!hasStoredLang()) {
    setLang(home.worker.lang, false);
    document.getElementById('lang').value = home.worker.lang;
  }
  window.addEventListener('hashchange', () => show(true));
  show();

  const pending = sessionStorage.getItem(PUNCH_KEY);
  if (pending) {
    sessionStorage.removeItem(PUNCH_KEY);
    punch({ token: pending });
  }
}

async function refresh() {
  home = await api('/api/worker/home');
}

function show(moveFocus = false) {
  clearInterval(clockTimer);
  const view = views[location.hash.slice(1)] ?? renderHome;
  main.replaceChildren(...[view()].flat().filter(Boolean));
  if (moveFocus) main.querySelector('h1, h2')?.focus();
}

// ---------- Shared pieces ----------

const listenButton = (getText) =>
  h('button', { class: 'listen', type: 'button', onclick: () => speak(getText()) },
    h('span', { 'aria-hidden': 'true' }, '🔊'), h('span', {}, t('listen')));

const viewHead = (title, speech) =>
  h('div', { class: 'view-head' },
    h('a', { class: 'back', href: '#' }, h('span', { 'aria-hidden': 'true' }, '← '), t('back')),
    h('h2', { tabindex: '-1' }, title),
    speech ? listenButton(speech) : null);

const tile = (view, icon, label, meta, extra = '') =>
  h('a', { class: `tile ${extra}`, href: `#${view}` },
    h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'tile-label' }, label),
    meta ? h('span', { class: 'tile-meta' }, meta) : null);

function elapsed(start) {
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60_000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

const money = (n) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// ---------- Home: the shift dial ----------

function renderHome() {
  const onShift = Boolean(home.shift);
  const dialTime = h('span', { class: 'dial-time' });
  if (onShift) {
    dialTime.textContent = elapsed(home.shift.start);
    clockTimer = setInterval(() => (dialTime.textContent = elapsed(home.shift.start)), 30_000);
  }

  const speech = () =>
    [
      home.worker.name,
      onShift ? t('on_shift_since', { time: clock(home.shift.start) }) : t('off_shift'),
      `${t('this_week')}: ${t('hours', { n: home.week.hours })}, ${t('overtime_hours', { n: home.week.overtime })}`,
      ...home.fatigue.map((f) => t(`fatigue_${f}`)),
    ].join('. ');

  return [
    h('h1', { class: 'sr-only', tabindex: '-1' }, home.worker.name),
    h('section', { class: 'hello' },
      h('div', {},
        h('p', { class: 'who' }, home.worker.name),
        h('p', { class: 'where' }, `${home.worker.trade}, ${home.org.name}`)),
      listenButton(speech)),
    home.fatigue.length
      ? h('section', { class: 'fatigue', role: 'alert' },
          h('span', { class: 'fatigue-icon', 'aria-hidden': 'true' }, '😴'),
          h('div', {}, h('h2', {}, t('fatigue_title')), h('ul', {}, home.fatigue.map((f) => h('li', {}, t(`fatigue_${f}`))))))
      : null,
    h('section', { class: 'punch' },
      h('button', { class: `dial${onShift ? ' on' : ''}`, type: 'button', onclick: scanQr, 'aria-describedby': 'punch-status' },
        h('span', { class: 'dial-label' }, t(onShift ? 'end_shift' : 'start_shift')),
        onShift ? dialTime : h('span', { class: 'dial-sub' }, t('scan_qr'))),
      h('p', { id: 'punch-status', class: 'punch-status' },
        onShift ? t('on_shift_since', { time: clock(home.shift.start) }) : t('off_shift')),
      codeForm()),
    h('div', { class: 'week' },
      h('span', {}, t('this_week')),
      h('strong', {}, t('hours', { n: home.week.hours })),
      h('span', { class: home.week.overtime ? 'ot' : '' }, t('overtime_hours', { n: home.week.overtime }))),
    h('nav', { class: 'tiles', 'aria-label': t('tagline') },
      tile('pay', '💰', t('my_pay'), rupees(home.payslip.net)),
      tile('report', '⚠️', t('report_danger'), null, 'danger'),
      tile('voice', '🗣️', t('speak_up'), home.feedbackDone ? '✓' : null),
      tile('skills', '🎓', t('my_skills'), String(home.skills.length)),
      tile('reports', '📋', t('my_reports'), home.openIssues ? t('open_count', { n: home.openIssues }) : null)),
  ];
}

function codeForm() {
  const input = h('input', {
    id: 'site-code', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code',
    pattern: '[0-9]{6}', required: true, 'aria-describedby': 'scan-hint',
  });
  return h('form', { class: 'code-form', onsubmit: (e) => { e.preventDefault(); punch({ code: input.value.trim() }); } },
    h('label', { for: 'site-code' }, t('site_code')),
    h('div', { class: 'code-row' }, input, h('button', { class: 'btn primary' }, t('confirm'))),
    h('p', { id: 'scan-hint', class: 'hint' }, t('scan_hint')));
}

async function punch(body) {
  try {
    const result = await api('/api/worker/punch', { method: 'POST', body });
    const message = result.onShift
      ? t('shift_started', { time: clock(result.start) })
      : t('shift_ended', { hours: result.hours });
    await refresh();
    if (location.hash) location.hash = '';
    show();
    document.querySelector('.dial')?.classList.add('stamped');
    toast(message, 'ok');
    speak(message);
  } catch (err) {
    toast(t(err.message), 'error');
    speak(t(err.message));
  }
}

/** In-app scanner where the browser supports it; otherwise the code field takes over. */
async function scanQr() {
  const codeInput = document.getElementById('site-code');
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return codeInput?.focus();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    return codeInput?.focus();
  }
  const dialog = document.getElementById('scanner');
  const video = document.getElementById('camera');
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  let scanning = true;
  const stop = () => {
    if (!scanning) return;
    scanning = false;
    stream.getTracks().forEach((track) => track.stop());
    if (dialog.open) dialog.close();
  };
  document.getElementById('scan-cancel').onclick = stop;
  dialog.addEventListener('close', stop, { once: true });

  video.srcObject = stream;
  dialog.showModal();
  await video.play().catch(() => {});
  while (scanning) {
    const [code] = await detector.detect(video).catch(() => []);
    const token = code?.rawValue.match(/punch=([\w.-]+)/)?.[1];
    if (token) {
      stop();
      return punch({ token });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// ---------- Pay ----------

function renderPay() {
  const p = home.payslip;
  const label = (line) => t(`line_${line.key}`);
  const speech = () =>
    [
      t('my_pay'),
      t('days_worked', { n: p.daysWorked }),
      ...p.lines.map((line) => `${label(line)}: ${rupees(line.amount)}`),
      `${t('take_home')}: ${rupees(p.net)}`,
    ].join('. ');

  return [
    viewHead(t('my_pay'), speech),
    h('p', { class: 'muted' }, `${t('pay_period', { n: p.periodDays })}, ${t('days_worked', { n: p.daysWorked })}`),
    h('ul', { class: 'payslip' },
      p.lines.map((line) =>
        h('li', { class: line.amount < 0 ? 'minus' : '' },
          h('span', { class: 'line-icon', 'aria-hidden': 'true' }, LINE_ICONS[line.key]),
          h('span', { class: 'line-text' },
            h('span', {}, label(line)),
            line.hours !== undefined ? h('small', {}, t('hours_x_rate', { hours: line.hours, rate: money(line.rate) })) : null),
          h('span', { class: 'line-amount' }, `${line.amount < 0 ? '−' : ''}${rupees(line.amount)}`)))),
    h('div', { class: 'net' }, h('span', {}, t('take_home')), h('strong', {}, rupees(p.net))),
    h('a', { class: 'btn secondary wide', href: '#report', onclick: () => (presetCategory = 'pay') },
      h('span', { 'aria-hidden': 'true' }, '💰 '), t('question_pay')),
  ];
}

// ---------- Report a danger or a pay problem ----------

function renderReport() {
  const chosen = presetCategory;
  presetCategory = null;
  const textarea = h('textarea', { id: 'report-text', rows: '3', maxlength: '1000' });
  const anonymous = h('input', { type: 'checkbox', id: 'anon' });
  const send = h('button', { class: 'btn primary wide' }, t('send_report'));

  const form = h('form', { class: 'report-form', onsubmit: submit },
    h('fieldset', { class: 'cats' },
      h('legend', {}, t('what_danger')),
      home.org.categories.map((c) =>
        h('label', { class: 'cat' },
          h('input', { type: 'radio', name: 'cat', value: c, checked: c === chosen }),
          h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, ICONS[c]),
          h('span', {}, t(`cat_${c}`))))),
    h('label', { for: 'report-text' }, t('describe')),
    textarea,
    micButton(textarea),
    h('label', { class: 'check' }, anonymous, h('span', {}, t('stay_anonymous'))),
    send);

  async function submit(event) {
    event.preventDefault();
    const category = form.querySelector('input[name="cat"]:checked')?.value ?? 'auto';
    if (category === 'auto' && !textarea.value.trim()) return toast(t('empty_report'), 'error');
    send.disabled = true;
    try {
      const res = await api('/api/worker/issues', {
        method: 'POST',
        body: { category, text: textarea.value.trim(), anonymous: anonymous.checked, lang: getLang() },
      });
      if (anonymous.checked) storeList(CODES_KEY, [...storedList(CODES_KEY), res.code].slice(-50));
      await refresh();
      location.hash = '#reports';
      const message = t('report_sent', { code: res.code });
      toast(message, 'ok');
      speak(message);
    } catch (err) {
      toast(t(err.message), 'error');
      send.disabled = false;
    }
  }

  return [h('div', { class: 'hazard-band', 'aria-hidden': 'true' }), viewHead(t('report_danger')), form];
}

/** Speech-to-text in the worker's language, for people who find typing hard. */
function micButton(target) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const text = h('span', {}, t('speak_now'));
  const button = h('button', { type: 'button', class: 'btn secondary mic' }, h('span', { 'aria-hidden': 'true' }, '🎤 '), text);
  button.addEventListener('click', () => {
    const recognition = new Recognition();
    recognition.lang = SPEECH_LANG[getLang()];
    recognition.onresult = (e) => (target.value = `${target.value} ${e.results[0][0].transcript}`.trim());
    recognition.onend = () => {
      button.disabled = false;
      text.textContent = t('speak_now');
    };
    button.disabled = true;
    text.textContent = t('listening');
    recognition.start();
  });
  return button;
}

// ---------- Anonymous feedback ----------

function renderVoice() {
  if (home.feedbackDone) return [viewHead(t('speak_up')), h('p', { class: 'notice' }, t('feedback_done'))];

  const form = h('form', { class: 'feedback', onsubmit: submit },
    h('p', { class: 'privacy' }, h('span', { 'aria-hidden': 'true' }, '🔒 '), t('feedback_intro')),
    DIMENSIONS.map((dim) =>
      h('fieldset', { class: 'faces' },
        h('legend', {}, t(`dim_${dim}`)),
        h('div', { class: 'face-row' },
          FACES.map((face, i) =>
            h('label', { class: 'face', title: t(`rating_${i + 1}`) },
              h('input', { type: 'radio', name: dim, value: String(i + 1) }),
              h('span', { 'aria-hidden': 'true' }, face),
              h('span', { class: 'sr-only' }, t(`rating_${i + 1}`))))))),
    h('label', { for: 'fb-comment' }, t('comment_optional')),
    h('textarea', { id: 'fb-comment', rows: '3', maxlength: '500' }),
    h('button', { class: 'btn primary wide' }, t('send_feedback')));

  async function submit(event) {
    event.preventDefault();
    const ratings = Object.fromEntries(
      DIMENSIONS.map((dim) => [dim, Number(form.querySelector(`input[name="${dim}"]:checked`)?.value ?? 0)]),
    );
    if (Object.values(ratings).some((v) => !v)) return toast(t('rate_all'), 'error');
    try {
      await api('/api/worker/feedback', {
        method: 'POST',
        body: { ratings, comment: form.querySelector('#fb-comment').value.trim() },
      });
      home.feedbackDone = true;
      location.hash = '';
      toast(t('feedback_sent'), 'ok');
      speak(t('feedback_sent'));
    } catch (err) {
      toast(t(err.message), 'error');
    }
  }

  return [viewHead(t('speak_up'), () => t('feedback_intro')), form];
}

// ---------- Skill passport ----------

function renderSkills() {
  async function share() {
    if (navigator.share) return navigator.share({ title: t('passport_title'), url: home.passportUrl }).catch(() => {});
    try {
      await navigator.clipboard.writeText(home.passportUrl);
      toast(t('link_copied'), 'ok');
    } catch {
      toast(home.passportUrl);
    }
  }

  return [
    viewHead(t('my_skills'), () => [t('skills_intro'), ...home.skills.map((s) => s.name)].join('. ')),
    h('p', { class: 'muted' }, t('skills_intro')),
    home.skills.length
      ? h('ul', { class: 'skills' },
          home.skills.map((s) =>
            h('li', {},
              h('span', { class: 'skill-icon', 'aria-hidden': 'true' }, '🎖️'),
              h('span', {}, h('strong', {}, s.name), h('small', {}, `${t('verified_by', { org: s.issuer })}, ${date(s.verifiedAt)}`)))))
      : h('p', { class: 'empty' }, t('no_skills')),
    h('button', { class: 'btn primary wide', type: 'button', onclick: share }, h('span', { 'aria-hidden': 'true' }, '🔗 '), t('share_passport')),
    h('a', { class: 'text-link', href: home.passportUrl, target: '_blank', rel: 'noopener' }, t('passport_title')),
  ];
}

// ---------- My reports ----------

function renderReports() {
  let items = [];
  const list = h('div', { class: 'reports', 'aria-busy': 'true' });
  const codes = encodeURIComponent(storedList(CODES_KEY).join(','));
  api(`/api/worker/issues?codes=${codes}`)
    .then((result) => {
      items = result;
      list.removeAttribute('aria-busy');
      list.replaceChildren(items.length ? h('ul', {}, items.map(reportItem)) : h('p', { class: 'empty' }, t('no_reports')));
    })
    .catch((err) => list.replaceChildren(h('p', { class: 'error' }, t(err.message))));

  const speech = () => items.map((i) => `${t(`cat_${i.category}`)}: ${t(`status_${i.status}`)}`).join('. ') || t('no_reports');
  return [viewHead(t('my_reports'), speech), list];
}

const reportItem = (issue) =>
  h('li', { class: `report-item ${issue.status}` },
    h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, ICONS[issue.category]),
    h('div', { class: 'report-body' },
      h('strong', {}, t(`cat_${issue.category}`)),
      h('small', {}, [issue.code, date(issue.createdAt), issue.anonymous ? t('anonymous') : null].filter(Boolean).join(', ')),
      issue.updates.filter((u) => u.note).map((u) => h('p', { class: 'note' }, t('office_note', { note: u.note })))),
    h('span', { class: 'status' }, h('span', { 'aria-hidden': 'true' }, `${STATUS_ICONS[issue.status]} `), t(`status_${issue.status}`)));
