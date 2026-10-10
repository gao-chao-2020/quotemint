import { randomBytes } from 'node:crypto';
import { openDb, resolveDataDir } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/auth.js';

function isoDaysAgo(days, hours = 0) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000).toISOString();
}

function token() {
  return randomBytes(16).toString('hex');
}

function insertUser(db, { email, password, name, plan, company = '', brandColor = '#4F46E5', logoText = '', renewsAt = null }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, name, company, brand_color, logo_text, plan, plan_renews_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(email, hashPassword(password), name, company, brandColor, logoText, plan, renewsAt, now);
  return Number(info.lastInsertRowid);
}

function insertQuote(db, userId, quote) {
  const created = quote.createdAt || new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO quotes
       (user_id, public_token, title, client_name, client_email, currency, items, discount_pct, tax_pct, notes, terms,
        status, valid_until, created_at, updated_at, sent_at, viewed_at, accepted_at, declined_at, accepted_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      token(),
      quote.title,
      quote.clientName,
      quote.clientEmail || '',
      quote.currency,
      JSON.stringify(quote.items),
      quote.discountPct || 0,
      quote.taxPct || 0,
      quote.notes || '',
      quote.terms || '',
      quote.status,
      quote.validUntil || null,
      created,
      quote.updatedAt || created,
      quote.sentAt || null,
      quote.viewedAt || null,
      quote.acceptedAt || null,
      quote.declinedAt || null,
      quote.acceptedName || ''
    );
  return Number(info.lastInsertRowid);
}

function insertEvent(db, quoteId, type, at, meta = '') {
  db.prepare('INSERT INTO quote_events (quote_id, type, at, meta) VALUES (?, ?, ?, ?)').run(quoteId, type, at, meta);
}

const db = openDb(resolveDataDir());

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@quotemint.dev');
if (existing) {
  console.log('seed: demo data already present, skipping');
  process.exit(0);
}

db.exec('BEGIN');
try {
  const demoId = insertUser(db, {
    email: 'demo@quotemint.dev',
    password: 'demo1234!',
    name: 'Alex Rivera',
    plan: 'free'
  });

  const draftCreated = isoDaysAgo(1, 3);
  insertQuote(db, demoId, {
    title: 'Brand Refresh - Phase 1',
    clientName: 'Northwind Cafe',
    clientEmail: 'owner@northwindcafe.example',
    currency: 'USD',
    items: [
      { desc: 'Logo redesign with 3 concepts', qty: 1, unit_price_cents: 145000 },
      { desc: 'Menu + signage artwork', qty: 1, unit_price_cents: 68000 },
      { desc: 'Brand guideline document', qty: 2.5, unit_price_cents: 24000 }
    ],
    discountPct: 5,
    taxPct: 0,
    notes: 'Phase 2 (packaging) quoted separately after direction is locked.',
    terms: '50% deposit to start, balance on delivery. Two revision rounds included.',
    validUntil: null,
    status: 'draft',
    createdAt: draftCreated
  });

  const sentCreated = isoDaysAgo(6);
  const sentAt = isoDaysAgo(5, 22);
  const sentId = insertQuote(db, demoId, {
    title: 'Marketing Website Redesign',
    clientName: 'Bloom & Co',
    clientEmail: 'hello@bloomco.example',
    currency: 'USD',
    items: [
      { desc: 'UX audit and wireframes (6 pages)', qty: 1, unit_price_cents: 120000 },
      { desc: 'Visual design - desktop and mobile', qty: 6, unit_price_cents: 85000 },
      { desc: 'Front-end build', qty: 40, unit_price_cents: 14500 }
    ],
    discountPct: 10,
    taxPct: 8.25,
    notes: 'Timeline: 4 weeks from kickoff. Includes one round of revisions per page.',
    terms: 'Net 14. Late payments accrue 1.5% monthly interest.',
    validUntil: isoDaysAgo(-14).slice(0, 10),
    status: 'sent',
    createdAt: sentCreated,
    updatedAt: sentAt,
    sentAt
  });
  insertEvent(db, sentId, 'sent', sentAt);

  const proId = insertUser(db, {
    email: 'pro@quotemint.dev',
    password: 'demo1234!',
    name: 'Priya Patel',
    plan: 'pro',
    company: 'Patel Studio',
    brandColor: '#0EA5E9',
    logoText: 'PS',
    renewsAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
  });

  const viewedCreated = isoDaysAgo(12);
  const viewedSent = isoDaysAgo(11);
  const viewedAt = isoDaysAgo(9, 4);
  const viewedId = insertQuote(db, proId, {
    title: 'iOS App - Discovery Sprint',
    clientName: 'Vector Labs GmbH',
    clientEmail: 'procurement@vectorlabs.example',
    currency: 'EUR',
    items: [
      { desc: 'Stakeholder interviews (5)', qty: 5, unit_price_cents: 18000 },
      { desc: 'Competitive teardown', qty: 1, unit_price_cents: 95000 },
      { desc: 'Clickable prototype', qty: 1, unit_price_cents: 220000 }
    ],
    discountPct: 0,
    taxPct: 19,
    notes: 'Prices exclude travel. Remote delivery via weekly checkpoints.',
    terms: 'Invoice on acceptance. Payment within 30 days.',
    validUntil: isoDaysAgo(-30).slice(0, 10),
    status: 'viewed',
    createdAt: viewedCreated,
    updatedAt: viewedAt,
    sentAt: viewedSent,
    viewedAt
  });
  insertEvent(db, viewedId, 'sent', viewedSent);
  insertEvent(db, viewedId, 'view', viewedAt);

  const acceptedCreated = isoDaysAgo(24);
  const acceptedSent = isoDaysAgo(23);
  const acceptedViewed = isoDaysAgo(20);
  const acceptedAt = isoDaysAgo(19, 6);
  const acceptedId = insertQuote(db, proId, {
    title: 'Book Cover & Interior Layout',
    clientName: 'Fable House Publishing',
    clientEmail: 'editor@fablehouse.example',
    currency: 'GBP',
    items: [
      { desc: 'Cover design - 2 directions', qty: 1, unit_price_cents: 90000 },
      { desc: 'Interior typesetting (240 pages)', qty: 240, unit_price_cents: 375 },
      { desc: 'Print-ready PDF + epub export', qty: 1, unit_price_cents: 30000 }
    ],
    discountPct: 7.5,
    taxPct: 0,
    notes: 'Ships with source files. ISBN barcode setup included.',
    terms: 'Net 30 from acceptance.',
    validUntil: null,
    status: 'accepted',
    createdAt: acceptedCreated,
    updatedAt: acceptedAt,
    sentAt: acceptedSent,
    viewedAt: acceptedViewed,
    acceptedAt,
    acceptedName: 'Jordan Lee'
  });
  insertEvent(db, acceptedId, 'sent', acceptedSent);
  insertEvent(db, acceptedId, 'view', acceptedViewed);
  insertEvent(db, acceptedId, 'accept', acceptedAt);

  const declinedCreated = isoDaysAgo(40);
  const declinedSent = isoDaysAgo(39);
  const declinedViewed = isoDaysAgo(36);
  const declinedAt = isoDaysAgo(35, 2);
  const declinedId = insertQuote(db, proId, {
    title: 'Quarterly Content Retainer',
    clientName: 'Summit Fitness',
    clientEmail: 'marketing@summitfit.example',
    currency: 'USD',
    items: [
      { desc: '8 blog posts per month', qty: 8, unit_price_cents: 42000 },
      { desc: 'Email newsletter copy', qty: 4, unit_price_cents: 15000 }
    ],
    discountPct: 15,
    taxPct: 0,
    notes: 'Rollover of unused posts not included in this tier.',
    terms: 'Billed monthly in advance.',
    validUntil: null,
    status: 'declined',
    createdAt: declinedCreated,
    updatedAt: declinedAt,
    sentAt: declinedSent,
    viewedAt: declinedViewed,
    declinedAt
  });
  insertEvent(db, declinedId, 'sent', declinedSent);
  insertEvent(db, declinedId, 'view', declinedViewed);
  insertEvent(db, declinedId, 'decline', declinedAt, 'Budget timing - will revisit next quarter.');

  db.exec('COMMIT');
  console.log('seed: created demo@quotemint.dev (free) and pro@quotemint.dev (pro), password demo1234!');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}
