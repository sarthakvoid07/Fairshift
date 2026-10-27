import { HOUR } from './time.js';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

/** How long an issue may stay unacknowledged before it is escalated as overdue. */
const SLA_HOURS = { critical: 2, high: 24, medium: 72, low: 168 };

const BASE_SEVERITY = {
  fall: 'high', electrical: 'high', machinery: 'high', fire: 'high', needle: 'high',
  biohazard: 'high', violence: 'high', chemical: 'high', harassment: 'high',
  heat: 'medium', slip: 'medium', noise: 'medium', pay: 'medium', other: 'low',
};

// Offline fallback when Gemini is not configured. Covers English, Hindi, Tamil and Bengali.
const KEYWORDS = {
  fall: ['fall', 'fell', 'height', 'scaffold', 'ladder', 'railing', 'गिर', 'सीढ़ी', 'விழ', 'ஏணி', 'পড়ে', 'মই'],
  electrical: ['wire', 'shock', 'electric', 'spark', 'socket', 'बिजली', 'तार', 'करंट', 'மின்', 'கம்பி', 'বিদ্যুৎ', 'তার'],
  fire: ['fire', 'smoke', 'burn', 'आग', 'धुआ', 'புகை', 'எரி', 'আগুন', 'ধোঁয়া'],
  machinery: ['machine', 'mixer', 'crane', 'belt', 'मशीन', 'இயந்திர', 'যন্ত্র'],
  heat: ['heat', 'drinking water', 'thirst', 'sunstroke', 'गर्मी', 'प्यास', 'வெயில்', 'தண்ணீர்', 'গরম', 'জল নেই'],
  needle: ['needle', 'sharps', 'syringe', 'सुई', 'ஊசி', 'সুঁচ'],
  biohazard: ['blood bag', 'infect', 'waste', 'कचरा', 'கழிவு', 'বর্জ্য'],
  violence: ['threat', 'attack', 'assault', 'slapped', 'धमकी', 'हमला', 'மிரட்ட', 'தாக்க', 'হুমকি', 'মারধর'],
  chemical: ['chemical', 'acid', 'gas', 'fumes', 'रसायन', 'இரசாயன', 'রাসায়নিক'],
  slip: ['slip', 'wet floor', 'फिसल', 'வழுக்', 'পিছল'],
  noise: ['noise', 'loud', 'शोर', 'சத்தம்', 'শব্দ'],
  harassment: ['harass', 'abuse', 'touch', 'shout', 'उत्पीड़न', 'गाली', 'துன்புறுத்த', 'হয়রানি'],
  pay: ['pay', 'salary', 'wage', 'overtime', 'money', 'वेतन', 'पैसा', 'भत्ता', 'சம்பளம்', 'கூலி', 'মজুরি', 'টাকা'],
};

const CRITICAL_WORDS = ['blood', 'unconscious', 'collapse', 'trapped', 'not breathing', 'खून', 'बेहोश', 'ரத்தம்', 'மயக்க', 'রক্ত', 'অজ্ঞান'];

export const maxSeverity = (a, b) =>
  SEVERITIES[Math.max(SEVERITIES.indexOf(a), SEVERITIES.indexOf(b ?? 'low'))];

/** Rule-based triage: worker's chosen category wins, otherwise keywords guess it. */
export function triageByRules(text, allowed, chosen = null) {
  const lower = text.toLowerCase();
  const category = allowed.includes(chosen)
    ? chosen
    : allowed.find((c) => KEYWORDS[c]?.some((k) => lower.includes(k))) ?? 'other';
  const severity = CRITICAL_WORDS.some((k) => lower.includes(k)) ? 'critical' : BASE_SEVERITY[category] ?? 'low';
  return { category, severity };
}

export const isOverdue = (issue, now = Date.now()) =>
  issue.status === 'open' && now - issue.createdAt > SLA_HOURS[issue.severity] * HOUR;

const STATUS_ORDER = { open: 0, acknowledged: 1, resolved: 2 };

/** Open first, then most severe, then oldest. */
export const compareIssues = (a, b) =>
  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
  SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) ||
  a.createdAt - b.createdAt;
