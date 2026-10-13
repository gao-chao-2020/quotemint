import { randomBytes } from 'node:crypto';
import { openDb, resolveDataDir } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/auth.js';

if (process.env.DEMO_MODE !== 'true' || process.env.NODE_ENV === 'production') {
  console.log('seed: refusing to run. Demo seeding requires DEMO_MODE=true and NODE_ENV != production.');
  process.exit(1);
}

function isoDaysAgo(days, hours = 0) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000).toISOString();
}

function token() {
  return randomBytes(16).toString('hex');
}

async function insertUser(db, { email, password, name, plan, company = '', brandColor = '#4F46E5', logoText = '', renewsAt = null }) {
  const now = new Date().toISOString();
  const info = await db.run(
    `INSERT INTO users (email, password_hash, name, company, brand_color, logo_text, plan, plan_renews_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    email,
    hashPassword(password),
    name,
    company,
    brandColor,
    logoText,
    plan,
    renewsAt,
    now
  );
  return info.lastInsertRowid;
}

async function insertQuote(db, userId, quote) {
  const created = quote.createdAt || new Date().toISOString();
  const info = await db.run(
    `INSERT INTO quotes
     (user_id, public_token, title, client_name, client_email, currency, items, discount_pct, tax_pct, notes, terms,
      status, valid_until, created_at, updated_at, sent_at, viewed_at, accepted_at, declined_at, accepted_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  return info.lastInsertRowid;
}

async function insertEvent(db, quoteId, type, at, meta = '') {
  await db.run('INSERT INTO quote_events (quote_id, type, at, meta) VALUES (?, ?, ?, ?)', quoteId, type, at, meta);
}

const db = openDb(resolveDataDir());

const existing = await db.get('SELECT id FROM users WHERE email = ?', 'demo@quotemint.dev');
if (existing) {
  console.log('seed: demo data already present, skipping');
  await db.close();
  process.exit(0);
}

try {
  await db.transaction(async () => {
    const demoId = await insertUser(db, {
      email: 'demo@quotemint.dev',
      password: 'demo1234!',
      name: 'Alex Rivera',
      plan: 'free'
    });

    const draftCreated = isoDaysAgo(1, 3);
    await insertQuote(db, demoId, {
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
    const sentId = await insertQuote(db, demoId, {
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
    await insertEvent(db, sentId, 'sent', sentAt);

    const proId = await insertUser(db, {
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
    const viewedId = await insertQuote(db, proId, {
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
    await insertEvent(db, viewedId, 'sent', viewedSent);
    await insertEvent(db, viewedId, 'view', viewedAt);

    const acceptedCreated = isoDaysAgo(24);
    const acceptedSent = isoDaysAgo(23);
    const acceptedViewed = isoDaysAgo(20);
    const acceptedAt = isoDaysAgo(19, 6);
    const acceptedId = await insertQuote(db, proId, {
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
    await insertEvent(db, acceptedId, 'sent', acceptedSent);
    await insertEvent(db, acceptedId, 'view', acceptedViewed);
    await insertEvent(db, acceptedId, 'accept', acceptedAt);

    const declinedCreated = isoDaysAgo(40);
    const declinedSent = isoDaysAgo(39);
    const declinedViewed = isoDaysAgo(36);
    const declinedAt = isoDaysAgo(35, 2);
    const declinedId = await insertQuote(db, proId, {
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
    await insertEvent(db, declinedId, 'sent', declinedSent);
    await insertEvent(db, declinedId, 'view', declinedViewed);
    await insertEvent(db, declinedId, 'decline', declinedAt, 'Budget timing - will revisit next quarter.');
  });
  console.log('seed: created demo@quotemint.dev (free) and pro@quotemint.dev (pro), password demo1234!');
} finally {
  await db.close();
}
