import { api, applyI18n, date, fillLangSelect, h, t } from './common.js';

const main = document.getElementById('main');
let passport = null;

applyI18n();
fillLangSelect(document.getElementById('lang'), render);

api(`/api/passport${location.search}`)
  .then((data) => {
    passport = data;
    render();
  })
  .catch((err) => main.replaceChildren(h('p', { class: 'error' }, t(err.status === 404 ? 'something_wrong' : err.message))));

function render() {
  if (!passport) return;
  const p = passport;
  main.replaceChildren(
    h('article', { class: 'passport' },
      h('p', { class: 'passport-kicker' }, t('passport_title')),
      h('h1', {}, p.name),
      h('p', { class: 'passport-trade' }, `${p.trade}, ${p.employer}`),
      h('dl', { class: 'passport-stats' },
        h('div', {}, h('dt', {}, t('total_days', { n: '' }).trim()), h('dd', {}, String(p.verifiedDays))),
        h('div', {}, h('dt', {}, t('total_hours', { n: '' }).trim()), h('dd', {}, String(p.verifiedHours)))),
      h('p', { class: 'muted' }, t('member_since', { date: date(p.since) })),
      p.skills.length
        ? h('ul', { class: 'skills' },
            p.skills.map((s) =>
              h('li', {},
                h('span', { class: 'skill-icon', 'aria-hidden': 'true' }, '🎖️'),
                h('span', {}, h('strong', {}, s.name), h('small', {}, `${t('verified_by', { org: s.issuer })}, ${date(s.verifiedAt)}`)))))
        : h('p', { class: 'empty' }, t('no_skills'))),
  );
}
