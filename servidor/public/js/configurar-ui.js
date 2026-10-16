import { requireAuth, startStatusLoop, renderAuthHeader } from './client-nav.js';

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await requireAuth())) return;
  renderAuthHeader('configurar');
  startStatusLoop();
  const isAdmin = (sessionStorage.getItem('scb_role') || localStorage.getItem('scb_role')) === 'admin';
  document.querySelectorAll('[data-admin]').forEach((a) => { a.hidden = !isAdmin; });
});
