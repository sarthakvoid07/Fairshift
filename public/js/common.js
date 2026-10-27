import { STRINGS, LANG_NAMES, SPEECH_LANG } from './i18n.js';

const LANG_KEY = 'fs_lang';

function stored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the setting just won't persist */
  }
}

let lang = stored(LANG_KEY, 'en');
if (!STRINGS[lang]) lang = 'en';
document.documentElement.lang = lang;

export const getLang = () => lang;
export const hasStoredLang = () => stored(LANG_KEY, null) !== null;

export function setLang(next, persist = true) {
  if (!STRINGS[next]) return;
  lang = next;
  document.documentElement.lang = next;
  if (persist) store(LANG_KEY, next);
  applyI18n();
}

/** Translate a key, filling {placeholders}. Falls back to English, then to the key. */
export function t(key, vars = {}) {
  const template = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

/** Fills elements marked data-i18n / data-i18n-placeholder / data-i18n-label. */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  root.querySelectorAll('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nLabel)));
}

export function fillLangSelect(select, onChange) {
  select.replaceChildren(...Object.entries(LANG_NAMES).map(([code, name]) => new Option(name, code, false, code === lang)));
  select.addEventListener('change', () => {
    setLang(select.value);
    onChange?.(select.value);
  });
}

/** Read text aloud in the current language using the phone's built-in voice. */
export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG[lang];
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}

/** JSON fetch that throws an Error whose message is an i18n key. */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('network_error'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'something_wrong'), { status: res.status });
  return data;
}

/** Tiny DOM builder. Children are appended as text nodes, so user content can never inject HTML. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export const rupees = (n) => `₹${Math.abs(n).toLocaleString('en-IN')}`;

export const clock = (ts) =>
  new Date(ts).toLocaleTimeString(`${lang}-IN`, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export const date = (ts) =>
  new Date(ts).toLocaleDateString(`${lang}-IN`, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

let toastTimer;
/** Announces a message visually and to screen readers (the toast is an aria-live region). */
export function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

export const storedList = (key) => JSON.parse(stored(key, '[]'));
export const storeList = (key, list) => store(key, JSON.stringify(list));

export const ICONS = {
  fall: '🪜', electrical: '⚡', machinery: '⚙️', heat: '🌡️', fire: '🔥', harassment: '🛑', other: '❓',
  needle: '💉', biohazard: '☣️', violence: '🚨', chemical: '🧪', slip: '💧', noise: '🔊', pay: '💰',
};
