import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { api, assertErr, assertOk, boot, createQuote, sendQuote, signup } from './helpers.js';
import { hashPassword } from '../../src/lib/auth.js';

const PORT = 3238;
const PORT_OFF = 3239;
const PORT_ADMIN_NO_SMTP = 3240;
const ADMIN_PASSWORD = 'admin-password-123';
const ADMIN_SECRET = 'notify-admin-secret';
const SMTP_USER = 'test@quotemint.dpdns.org';

// Plain-TCP mock SMTP server (same dialog as test/integration/password-reset.test.js).
async function startMockSmtp() {
  const received = { lines: [], authUser: null, authPass: null, mailFrom: null, rcptTo: null, data: null, count: 0 };
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 mock.smtp ESMTP ready\r\n');

    let buffer = '';
    let authStep = 0; // 0 = idle, 1 = awaiting username, 2 = awaiting password
    let dataLines = null;
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (dataLines) {
          if (line === '.') {
            received.data = dataLines.join('\r\n');
            received.count += 1;
            dataLines = null;
            socket.write('250 2.0.0 Ok: queued\r\n');
          } else {
            dataLines.push(line.startsWith('.') ? line.slice(1) : line);
          }
          continue;
        }
        if (authStep === 1) {
          received.authUser = Buffer.from(line, 'base64').toString('utf8');
          authStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
          continue;
        }
        if (authStep === 2) {
          received.authPass = Buffer.from(line, 'base64').toString('utf8');
          authStep = 3;
          socket.write('235 2.7.0 Accepted\r\n');
          continue;
        }
        received.lines.push(line);
        if (line.startsWith('EHLO ')) socket.write('250-mock.smtp greets you\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
        else if (line === 'AUTH LOGIN') {
          authStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (line.startsWith('MAIL FROM:')) {
          received.mailFrom = line;
          socket.write('250 2.1.0 Ok\r\n');
        } else if (line.startsWith('RCPT TO:')) {
          received.rcptTo = line;
          socket.write('250 2.1.5 Ok\r\n');
        } else if (line === 'DATA') {
          dataLines = [];
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (line === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('502 5.5.2 Command not implemented\r\n');
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    received,
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

function decodeHeaderValue(value) {
  const match = /^=\?UTF-8\?B\?([^?]+)\?=$/.exec(value);
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : value;
}

function decodedBody(data) {
  const [, ...bodyParts] = data.split('\r\n\r\n');
  return Buffer.from(bodyParts.join(''), 'base64').toString('utf8');
}

function decodedSubject(data) {
  const headerBlock = data.split('\r\n\r\n')[0];
  const match = /^Subject: (.*)$/m.exec(headerBlock);
  return match ? decodeHeaderValue(match[1]) : '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Accept notifications are fire-and-forget, so the capture may trail the API
// response; poll briefly instead of assuming ordering.
async function waitForMail(mock, minCount) {
  const deadline = Date.now() + 5000;
  while (mock.received.count < minCount) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for mail #${minCount}`);
    await sleep(25);
  }
  return mock.received.data;
}

// Reads a server's live SQLite file directly (WAL allows concurrent readers).
function withDb(dir, fn) {
  const db = new DatabaseSync(join(dir, 'app.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

let mock;
let server;
let off;
let adminOffSmtp;
let adminCookie = '';

async function adminLogin(srv) {
  const res = await api(srv, 'POST', '/admin/login', { body: { password: ADMIN_PASSWORD } });
  assert.equal(res.status, 200, `admin login failed: ${res.text}`);
  const match = /qm_admin=([^;]+)/.exec(res.setCookie || '');
  return match ? `qm_admin=${match[1]}` : '';
}

before(async () => {
  mock = await startMockSmtp();
  off = await boot({
    port: PORT_OFF,
    env: { SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' }
  });
  adminOffSmtp = await boot({
    port: PORT_ADMIN_NO_SMTP,
    env: {
      ADMIN_PASSWORD_HASH: hashPassword(ADMIN_PASSWORD),
      ADMIN_SESSION_SECRET: ADMIN_SECRET,
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      MAIL_FROM: ''
    }
  });
  server = await boot({
    port: PORT,
    env: {
      TRUST_PROXY: '1',
      ADMIN_PASSWORD_HASH: hashPassword(ADMIN_PASSWORD),
      ADMIN_SESSION_SECRET: ADMIN_SECRET,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(mock.port),
      SMTP_SECURE: '0',
      SMTP_USER,
      SMTP_PASS: 'x',
      MAIL_FROM: ''
    }
  });
  adminCookie = await adminLogin(server);
});

after(async () => {
  await adminOffSmtp?.close();
  await off?.close();
  await server?.close();
  await mock?.close();
});

test('accept notifies the owner: bilingual mail with title, client, signer, and editor link', async () => {
  const owner = await signup(server, { name: 'Owner Accept' });
  const created = assertOk(
    await createQuote(server, owner.cookie, { title: 'Accept Notify Quote', client_name: 'Acme Corp' }),
    201
  );
  assertOk(await sendQuote(server, owner.cookie, created.quote.id));

  const count = mock.received.count;
  const accepted = assertOk(
    await api(server, 'POST', `/api/public/quotes/${created.quote.public_token}/accept`, {
      body: { name: 'Jane Doe', agree: true }
    })
  );
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.accepted_name, 'Jane Doe');

  const data = await waitForMail(mock, count + 1);
  assert.equal(mock.received.rcptTo, `RCPT TO:<${owner.email}>`);
  const subject = decodedSubject(data);
  assert.ok(subject.includes('Quote accepted: Accept Notify Quote'), subject);
  assert.ok(subject.includes('报价已被签收'), subject);

  const body = decodedBody(data);
  assert.ok(body.includes('Accept Notify Quote'), body);
  assert.ok(body.includes('Acme Corp'), body);
  assert.ok(body.includes('Jane Doe'), body);
  assert.ok(body.includes(`${server.base}/app/quotes/${created.quote.id}/edit`), 'editor link expected');
  assert.ok(body.includes('签收人'), 'zh section expected');
});

test('with SMTP unconfigured: accept still returns 200 and sends nothing', async () => {
  const owner = await signup(off, { name: 'Offline Owner' });
  const created = assertOk(await createQuote(off, owner.cookie, { title: 'Offline Accept Quote' }), 201);
  assertOk(await sendQuote(off, owner.cookie, created.quote.id));

  const count = mock.received.count;
  const accepted = assertOk(
    await api(off, 'POST', `/api/public/quotes/${created.quote.public_token}/accept`, {
      body: { name: 'Offline Client', agree: true }
    })
  );
  assert.equal(accepted.status, 'accepted');
  await sleep(250); // give a wrongful fire-and-forget send time to land
  assert.equal(mock.received.count, count, 'no mail may be sent while SMTP is unconfigured');
});

test('GET /admin/expiring renders the empty state and the nav link appears on admin pages', async () => {
  const page = await api(server, 'GET', '/admin/expiring', { cookie: adminCookie });
  assert.equal(page.status, 200, page.text);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.ok(page.text.includes('class="admin-empty"'), 'empty state expected');
  assert.ok(page.text.includes('No renewals are due in the next 7 days.'), 'empty copy expected');

  const dash = await api(server, 'GET', '/admin', { cookie: adminCookie });
  assert.ok(dash.text.includes('href="/admin/expiring"'), 'nav link expected on the dashboard');
});

test('expiring page requires admin: GET -> 302 login, remind POST -> 401 / 403 csrf', async () => {
  const unauth = await api(server, 'GET', '/admin/expiring');
  assert.equal(unauth.status, 302);
  assert.equal(unauth.location, '/admin/login');

  assertErr(
    await api(server, 'POST', '/admin/expiring/remind', { body: { email: 'x@test.local' } }),
    401,
    'not_authenticated'
  );
  assertErr(
    await api(server, 'POST', '/admin/expiring/remind', { cookie: adminCookie, csrf: false, body: { email: 'x@test.local' } }),
    403,
    'csrf'
  );
});

test('GET /admin/expiring lists pro accounts due within 7 days, soonest first, and excludes the rest', async () => {
  const earlier = await signup(server, { name: 'Due Earlier' });
  const due = await signup(server, { name: 'Due Soon' });
  const later = await signup(server, { name: 'Later Renewal' });
  const freeUser = await signup(server, { name: 'Free With Date' });
  const earlierAt = new Date(Date.now() + 86_400_000).toISOString();
  const dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const laterAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  withDb(server.dataDir, (db) => {
    db.prepare("UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE email = ?").run(earlierAt, earlier.email);
    db.prepare("UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE email = ?").run(dueAt, due.email);
    db.prepare("UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE email = ?").run(laterAt, later.email);
    db.prepare("UPDATE users SET plan = 'free', plan_renews_at = ? WHERE email = ?").run(dueAt, freeUser.email);
  });

  const page = await api(server, 'GET', '/admin/expiring', { cookie: adminCookie });
  assert.equal(page.status, 200, page.text);
  assert.ok(page.text.includes(due.email));
  assert.ok(page.text.includes(`data-admin-remind="${due.email}"`), 'remind button expected');
  assert.ok(page.text.includes('class="admin-col-days">3<'), '3 days left expected');
  assert.ok(!page.text.includes(later.email), 'a +30d renewal must not be listed');
  assert.ok(!page.text.includes(freeUser.email), 'a free account must not be listed');
  assert.ok(
    page.text.indexOf(earlier.email) < page.text.indexOf(due.email),
    'soonest renewal must come first'
  );
});

test('POST /admin/expiring/remind sends the bilingual reminder and writes the audit row', async () => {
  const user = await signup(server, { name: 'Remind Target' });
  const renewsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
  withDb(server.dataDir, (db) =>
    db.prepare("UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE email = ?").run(renewsAt, user.email)
  );

  const count = mock.received.count;
  const data = assertOk(
    await api(server, 'POST', '/admin/expiring/remind', { cookie: adminCookie, body: { email: user.email } })
  );
  assert.equal(data.renews_at, renewsAt);

  const mail = await waitForMail(mock, count + 1);
  assert.equal(mock.received.rcptTo, `RCPT TO:<${user.email}>`);
  const subject = decodedSubject(mail);
  assert.ok(subject.includes('Renew your QuoteMint Pro plan'), subject);
  assert.ok(subject.includes('专业版续费提醒'), subject);

  const body = decodedBody(mail);
  assert.ok(body.includes(renewsAt.slice(0, 10)), 'renews date expected in the body');
  assert.ok(body.includes('¥68'), 'Alipay hint expected');
  assert.ok(body.includes(`/app/billing`), 'billing link expected');

  const events = withDb(server.dataDir, (db) =>
    db.prepare('SELECT action, target_email, detail FROM admin_events ORDER BY id DESC').all()
  );
  assert.equal(events[0].action, 'remind');
  assert.equal(events[0].target_email, user.email);
  assert.equal(events[0].detail, renewsAt);
});

test('remind: unknown email -> 404 user_not_found, non-pro account -> 400 not_pro', async () => {
  assertErr(
    await api(server, 'POST', '/admin/expiring/remind', { cookie: adminCookie, body: { email: 'nobody@test.local' } }),
    404,
    'user_not_found'
  );
  const free = await signup(server, { name: 'Free Target' });
  assertErr(
    await api(server, 'POST', '/admin/expiring/remind', { cookie: adminCookie, body: { email: free.email } }),
    400,
    'not_pro'
  );
  assertErr(
    await api(server, 'POST', '/admin/expiring/remind', { cookie: adminCookie, body: {} }),
    400,
    'invalid_email'
  );
});

test('remind with SMTP unconfigured -> 503 mail_not_configured and no audit row', async () => {
  const cookie = await adminLogin(adminOffSmtp);
  const user = await signup(adminOffSmtp, { name: 'No SMTP Target' });
  withDb(adminOffSmtp.dataDir, (db) =>
    db
      .prepare("UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE email = ?")
      .run(new Date(Date.now() + 86_400_000).toISOString(), user.email)
  );

  assertErr(
    await api(adminOffSmtp, 'POST', '/admin/expiring/remind', { cookie, body: { email: user.email } }),
    503,
    'mail_not_configured'
  );
  const counted = withDb(adminOffSmtp.dataDir, (db) =>
    db.prepare("SELECT COUNT(*) AS n FROM admin_events WHERE action = 'remind'").get()
  );
  assert.equal(counted.n, 0, 'no audit row when the mail was never sent');
});
