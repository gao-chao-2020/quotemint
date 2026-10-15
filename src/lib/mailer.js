import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { connect as netConnect, isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { HttpError } from './http.js';

const DEFAULT_TIMEOUT_MS = 10 * 1000;
const BASE64_LINE_LENGTH = 76;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shaped like HttpError (status/code) so HTTP callers can map mail failures
// without a special case; the distinct class keeps SMTP call sites explicit.
export class MailError extends HttpError {}

function nonEmpty(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0;
}

// Env is read at call time: serverless bundles must not capture configuration
// at module load (see the lazy-loading note in paths.js).
export function isConfigured() {
  return nonEmpty('SMTP_HOST') && nonEmpty('SMTP_PORT') && nonEmpty('SMTP_USER') && nonEmpty('SMTP_PASS');
}

// RFC 5321: every line of transmitted mail text starting with '.' gets one
// extra leading dot so it can never be mistaken for the DATA terminator.
export function dotStuff(text) {
  return text.replace(/^\./gm, '..');
}

// RFC 2047: ASCII stays readable; anything else becomes one encoded word.
function encodeHeaderValue(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrapBase64(text) {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  const lines = [];
  for (let start = 0; start < encoded.length; start += BASE64_LINE_LENGTH) {
    lines.push(encoded.slice(start, start + BASE64_LINE_LENGTH));
  }
  return lines.join('\r\n');
}

export function buildMessage({ from, to, subject, text, date = new Date(), messageId }) {
  const at = from.lastIndexOf('@');
  const domain = at === -1 ? 'quotemint.local' : from.slice(at + 1);
  const headers = [
    `From: ${encodeHeaderValue(from)}`,
    `To: ${encodeHeaderValue(to)}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${date.toUTCString().replace(/GMT$/, '+0000')}`,
    `Message-ID: ${messageId || `<${randomBytes(16).toString('hex')}@${domain}>`}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64'
  ];
  return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(text)}\r\n`;
}

// Returns the first complete SMTP reply in the buffer (multi-line replies are
// merged) plus whatever is left over, or null when the reply is incomplete.
function parseReply(buffer) {
  let rest = buffer;
  const lines = [];
  for (;;) {
    const end = rest.indexOf('\r\n');
    if (end === -1) return null;
    const line = rest.slice(0, end);
    rest = rest.slice(end + 2);
    lines.push(line);
    const match = /^(\d{3})([- ]|$)/.exec(line);
    if (match && match[2] !== '-') {
      return { rest, reply: { code: Number(match[1]), lines } };
    }
    if (!match) {
      // Not an SMTP status line: surface it as a failure instead of hanging.
      return { rest, reply: { code: Number.NaN, lines } };
    }
  }
}

function createSession(socket) {
  let buffer = '';
  let pending = null;
  let aborted = null;

  const failPending = (error) => {
    if (!pending) return;
    const entry = pending;
    pending = null;
    entry.reject(error);
  };

  const read = () => {
    if (aborted) return Promise.reject(aborted);
    const parsed = parseReply(buffer);
    if (parsed) {
      buffer = parsed.rest;
      return Promise.resolve(parsed.reply);
    }
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
    });
  };

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (!pending) return;
    const parsed = parseReply(buffer);
    if (!parsed) return;
    buffer = parsed.rest;
    const entry = pending;
    pending = null;
    entry.resolve(parsed.reply);
  });
  socket.on('error', (error) => {
    failPending(new MailError(502, 'mail_connection_failed', `SMTP connection failed: ${error.message}`));
  });
  socket.on('close', () => {
    failPending(new MailError(502, 'mail_connection_failed', 'SMTP connection closed before the reply arrived'));
  });

  return {
    read,
    command(line) {
      socket.write(`${line}\r\n`);
      return read();
    },
    write(data) {
      socket.write(data);
    },
    abort(error) {
      aborted = error;
      socket.destroy();
      failPending(error);
    }
  };
}

function openSocket({ host, port, secure, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let socket;
    try {
      socket = secure
        ? tlsConnect({ host, port, ...(isIP(host) ? {} : { servername: host }) })
        : netConnect({ host, port });
    } catch (error) {
      fail(new MailError(502, 'mail_connection_failed', `SMTP connect to ${host}:${port} failed: ${error.message}`));
      return;
    }
    socket.setTimeout(Math.max(timeoutMs, 1));
    socket.once('timeout', () => {
      socket.destroy();
      fail(new MailError(504, 'mail_timeout', `SMTP connect to ${host}:${port} timed out after ${timeoutMs}ms`));
    });
    socket.once('error', (error) => {
      fail(new MailError(502, 'mail_connection_failed', `SMTP connect to ${host}:${port} failed: ${error.message}`));
    });
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0); // the overall deadline covers the dialog phase
      resolve(socket);
    });
  });
}

function expectAccepted(reply, stage) {
  if (reply.code >= 200 && reply.code <= 399) return;
  const detail = reply.lines.join(' ').trim() || 'empty reply';
  throw new MailError(502, 'mail_rejected', `SMTP ${stage} was rejected: ${detail}`);
}

export async function sendMail({ to, subject, text, from } = {}, { timeoutMs } = {}) {
  const recipient = String(to ?? '').trim();
  if (!EMAIL_RE.test(recipient)) {
    throw new MailError(400, 'invalid_recipient', `Not a valid email address: ${JSON.stringify(to ?? '')}`);
  }
  if (!isConfigured()) {
    throw new MailError(
      503,
      'mail_not_configured',
      'SMTP is not configured; set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS'
    );
  }
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailError(503, 'mail_not_configured', `SMTP_PORT must be a TCP port number, got ${JSON.stringify(process.env.SMTP_PORT)}`);
  }
  const secure = process.env.SMTP_SECURE !== '0';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const sender = String(from || process.env.MAIL_FROM || user);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const message = buildMessage({
    from: sender,
    to: recipient,
    subject: String(subject ?? ''),
    text: String(text ?? '')
  });

  const deadline = Date.now() + timeout;
  const socket = await openSocket({ host, port, secure, timeoutMs: timeout });
  const session = createSession(socket);
  const timer = setTimeout(() => {
    session.abort(new MailError(504, 'mail_timeout', `SMTP send to ${recipient} timed out after ${timeout}ms`));
  }, Math.max(deadline - Date.now(), 1));

  try {
    expectAccepted(await session.read(), 'greeting');
    expectAccepted(await session.command(`EHLO ${hostname() || 'localhost'}`), 'EHLO');
    expectAccepted(await session.command('AUTH LOGIN'), 'AUTH LOGIN');
    expectAccepted(await session.command(Buffer.from(user, 'utf8').toString('base64')), 'AUTH username');
    expectAccepted(await session.command(Buffer.from(pass, 'utf8').toString('base64')), 'AUTH password');
    expectAccepted(await session.command(`MAIL FROM:<${sender}>`), 'MAIL FROM');
    expectAccepted(await session.command(`RCPT TO:<${recipient}>`), 'RCPT TO');
    expectAccepted(await session.command('DATA'), 'DATA');
    session.write(`${dotStuff(message)}.\r\n`);
    expectAccepted(await session.read(), 'message body');
    try {
      await session.command('QUIT');
    } catch {
      // The message is already accepted; a broken QUIT must not fail the send.
    }
    return { ok: true };
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}
