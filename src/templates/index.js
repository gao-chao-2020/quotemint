// PLACEHOLDER barrel - owned by frontend, will be replaced.
// Backend routes import ONLY from this file.

import { layout } from './layout.js';

const stub = (name) => layout({ title: `QuoteMint - ${name}`, body: `<main><h1>${name}</h1><p>Placeholder template.</p></main>` });

export const renderLanding = () => stub('Landing');
export const renderAuth = () => stub('Auth');
export const renderDashboard = () => stub('Dashboard');
export const renderEditor = () => stub('Editor');
export const renderBilling = () => stub('Billing');
export const renderPublicQuote = () => stub('Quote');
export const renderError = () => stub('Error');
