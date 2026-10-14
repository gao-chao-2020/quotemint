// Barrel: backend routes import page renderers from this file only (contract §12).

export { renderLanding } from './landing.js';
export { renderAuth } from './auth.js';
export { renderDashboard } from './dashboard.js';
export { renderEditor } from './editor.js';
export { renderBilling } from './billing.js';
export { renderPublicQuote } from './publicquote.js';
export { renderLegal } from './legal.js';
export { renderAdminDashboard, renderAdminLogin, renderAdminUsers } from './admin.js';
export { renderError } from './error.js';
