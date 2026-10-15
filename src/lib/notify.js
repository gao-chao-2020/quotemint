// Owner notifications for quote lifecycle events. Fire-and-forget by contract:
// the public accept handler must never fail or block because of mail problems,
// so everything here is caught and logged, never rethrown.

import { isConfigured, sendMail } from './mailer.js';

// Same bilingual plain-text shape as the password-reset mail (routes/auth.js):
// EN section first, ZH section second.
function acceptEmailText({ title, clientName, acceptedAt, acceptedName, url }) {
  return [
    `Good news — your quote "${title}" was accepted.`,
    `好消息 —— 你的报价单“${title}”已被签收。`,
    '',
    `Client: ${clientName}`,
    `客户：${clientName}`,
    `Accepted by: ${acceptedName}`,
    `签收人：${acceptedName}`,
    `Accepted at (UTC): ${acceptedAt}`,
    `签收时间（UTC）：${acceptedAt}`,
    '',
    'Open the quote to review the acceptance:',
    '打开报价单查看签收详情：',
    '',
    url,
    '',
    'You are receiving this email because someone accepted a quote you created on QuoteMint.',
    '你收到此邮件是因为你创建的报价单被客户签收。'
  ].join('\n');
}

export async function notifyQuoteAccepted(db, quote, baseUrl) {
  try {
    const owner = await db.get('SELECT id, email FROM users WHERE id = ?', quote.user_id);
    const to = typeof owner?.email === 'string' ? owner.email.trim() : '';
    if (!to || !isConfigured()) return;
    const title = String(quote.title ?? '').trim() || `#${quote.id}`;
    const text = acceptEmailText({
      title,
      clientName: String(quote.client_name ?? ''),
      acceptedAt: String(quote.accepted_at ?? ''),
      acceptedName: String(quote.accepted_name ?? ''),
      url: `${baseUrl}/app/quotes/${quote.id}/edit`
    });
    // Subject headers must stay single-line; collapse any newlines a title could carry.
    const subjectTitle = title.replace(/\s+/g, ' ').slice(0, 150);
    await sendMail({
      to,
      subject: `Quote accepted: ${subjectTitle} / 报价已被签收：${subjectTitle}`,
      text
    });
  } catch (err) {
    console.error('[notify] could not send quote-accepted mail:', err && err.message ? err.message : err);
  }
}
