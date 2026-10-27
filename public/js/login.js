import { api, applyI18n, fillLangSelect, t } from './common.js';

const workerForm = document.getElementById('worker-form');
const adminForm = document.getElementById('admin-form');
const error = document.getElementById('login-error');
const DEMO_SECRET = { worker: '1234', admin: 'demo1234' }; // public demo accounts, shown on the page

const goHome = (role) => location.replace(role === 'admin' ? '/admin.html' : '/worker.html');

// Already signed in? Skip the form.
api('/api/me').then((me) => me.role && goHome(me.role)).catch(() => {});

applyI18n();
fillLangSelect(document.getElementById('lang'));

document.querySelectorAll('input[name="role"]').forEach((radio) =>
  radio.addEventListener('change', () => {
    workerForm.hidden = radio.value !== 'worker';
    adminForm.hidden = radio.value !== 'admin';
    error.textContent = '';
  }),
);

async function signIn(body) {
  error.textContent = '';
  try {
    const { role } = await api('/api/auth/login', { method: 'POST', body });
    goHome(role);
  } catch (err) {
    error.textContent = body.kind === 'admin' && err.message === 'bad_credentials' ? 'Wrong email or password.' : t(err.message);
  }
}

workerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  signIn({ kind: 'worker', phone: workerForm.phone.value.trim(), pin: workerForm.pin.value });
});

adminForm.addEventListener('submit', (event) => {
  event.preventDefault();
  signIn({ kind: 'admin', email: adminForm.email.value.trim(), password: adminForm.password.value });
});

document.querySelectorAll('.demo-btn').forEach((button) =>
  button.addEventListener('click', () => {
    const { kind, id } = button.dataset;
    signIn(kind === 'worker' ? { kind, phone: id, pin: DEMO_SECRET.worker } : { kind, email: id, password: DEMO_SECRET.admin });
  }),
);
