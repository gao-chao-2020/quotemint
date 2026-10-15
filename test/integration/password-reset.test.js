import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { api, assertErr, assertOk, boot, sessionCookie, signup, uniqueEmail } from './helpers.js';

const PORT = 3230;
const PORT_OFF = 3231;
const SMTP_USER = 'test@quotemint.dpdns.org';
const INVALID_EN = 'This reset link is invalid or has expired.';
const INVALID_ZH = '此重置链接无效或已过期。';

// Plain-TCP mock SMTP server (same dialog as test/unit/mailer.test.js, plus a
// delivery counter) so the suite runs fully offline.
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

// sendMail is awaited before the API responds, so the capture is normally
// already there; the poll only guards against scheduling skew.
async function waitForMail(mock, minCount) {
  const deadline = Date.now() + 5000;
  while (mock.received.count < minCount) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for mail #${minCount}`);
    await sleep(25);
  }
  return mock.received.data;
}

function resetTokenFrom(text) {
  const match = /\/reset\?token=([0-9a-f]{64})/.exec(text);
  assert.ok(match, `no reset link in mail body:\n${text}`);
  return match[1];
}

function forgot(server, email, ip) {
  return api(server, 'POST', '/api/auth/forgot', { body: { email }, headers: { 'X-Forwarded-For': ip } });
}

let mock;
let server;
let off;
let knownUser;
let knownResponse;

function withDb(fn) {
  const db = new DatabaseSync(join(server.dataDir, 'app.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

before(async () => {
  mock = await startMockSmtp();
  off = await boot({ port: PORT_OFF, env: { SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' } });
  server = await boot({
    port: PORT,
    env: {
      TRUST_PROXY: '1',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(mock.port),
      SMTP_SECURE: '0',
      SMTP_USER,
      SMTP_PASS: 'x',
      MAIL_FROM: ''
    }
  });
  knownUser = await signup(server, { name: 'Reset User' });
});

after(async () => {
  await off?.close();
  await server?.close();
  await mock?.close();
});

test('forgot for an existing account: 200 and a bilingual mail with the reset link', async () => {
  const before = mock.received.count;
  knownResponse = await forgot(server, knownUser.email, '198.51.100.11');
  assert.deepEqual(knownResponse.body, { ok: true });

  const data = await waitForMail(mock, before + 1);
  assert.equal(mock.received.rcptTo, `RCPT TO:<${knownUser.email}>`);
  assert.equal(mock.received.mailFrom, `MAIL FROM:<${SMTP_USER}>`);
  const subject = decodedSubject(data);
  assert.ok(subject.includes('Reset your QuoteMint password'), subject);
  assert.ok(subject.includes('重置密码'), subject);

  const body = decodedBody(data);
  assert.match(body, /\/reset\?token=[0-9a-f]{64}/);
  assert.match(body, /valid for 1 hour/);
  assert.match(body, /1 小时内有效/);
});

test('forgot for an unknown email: identical 200 response and no mail sent', async () => {
  const countBefore = mock.received.count;
  const unknown = await forgot(server, uniqueEmail('ghost'), '198.51.100.12');
  assert.equal(unknown.status, knownResponse.status);
  assert.deepEqual(unknown.body, knownResponse.body, 'response must not reveal whether the account exists');
  assert.equal(mock.received.count, countBefore, 'no mail may be sent for an unknown account');
});

test('GET /forgot renders the email form and /login links to it', async () => {
  const page = await api(server, 'GET', '/forgot');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.ok(page.text.includes('data-mode="forgot"'));
  assert.ok(page.text.includes('id="auth-email"'));

  const login = await api(server, 'GET', '/login');
  assert.ok(login.text.includes('href="/forgot"'), 'login page must link to /forgot');
  assert.ok(login.text.includes('Forgot password?'));
});

test('GET /reset with a live token renders the form; absent/unknown tokens render the invalid state', async () => {
  const before = mock.received.count;
  assertOk(await forgot(server, knownUser.email, '198.51.100.13'));
  const token = resetTokenFrom(decodedBody(await waitForMail(mock, before + 1)));

  const form = await api(server, 'GET', `/reset?token=${token}`);
  assert.equal(form.status, 200);
  assert.ok(form.text.includes('data-mode="reset"'));
  assert.ok(form.text.includes(`value="${token}"`));
  assert.ok(form.text.includes('id="auth-password"'));
  assert.ok(form.text.includes('id="auth-password-confirm"'));

  for (const path of ['/reset', '/reset?token=', '/reset?token=deadbeef', `/reset?token=${'a'.repeat(64)}`]) {
    const bad = await api(server, 'GET', path);
    assert.equal(bad.status, 200, path);
    assert.ok(bad.text.includes(INVALID_EN), `${path} must show the invalid-link state`);
    assert.ok(!bad.text.includes('data-mode="reset"'), `${path} must not render the form`);
  }

  const zh = await api(server, 'GET', '/reset', { cookie: 'lang=zh' });
  assert.ok(zh.text.includes(INVALID_ZH), 'zh copy must come from the dictionary');
});

test('reset with an absent or unknown token -> 400 invalid_token', async () => {
  assertErr(
    await api(server, 'POST', '/api/auth/reset', { body: { token: 'deadbeef', password: 'kkkkkkkk4' } }),
    400,
    'invalid_token'
  );
  assertErr(
    await api(server, 'POST', '/api/auth/reset', { body: { password: 'kkkkkkkk4' } }),
    400,
    'invalid_token'
  );
});

test('full flow: reset updates the password, kills sessions, and the token is single-use', async () => {
  const user = knownUser;
  const login = await api(server, 'POST', '/api/auth/login', { body: { email: user.email, password: user.password } });
  const preResetCookie = sessionCookie(login.setCookie);
  assert.ok(preResetCookie, 'pre-reset login must issue a session');

  const before = mock.received.count;
  assertOk(await forgot(server, user.email, '198.51.100.15'));
  const token = resetTokenFrom(decodedBody(await waitForMail(mock, before + 1)));

  const newPassword = 'brand-new-password-456';
  const reset = await api(server, 'POST', '/api/auth/reset', { body: { token, password: newPassword } });
  assert.deepEqual(reset.body, { ok: true });

  assertErr(await api(server, 'GET', '/api/auth/me', { cookie: preResetCookie }), 401, 'not_authenticated');
  assertErr(
    await api(server, 'POST', '/api/auth/login', { body: { email: user.email, password: user.password } }),
    401,
    'invalid_credentials'
  );
  assertOk(await api(server, 'POST', '/api/auth/login', { body: { email: user.email, password: newPassword } }));

  assertErr(
    await api(server, 'POST', '/api/auth/reset', { body: { token, password: 'another-password-789' } }),
    400,
    'invalid_token'
  );
  const usedPage = await api(server, 'GET', `/reset?token=${token}`);
  assert.ok(usedPage.text.includes(INVALID_EN), 'a used token must render the invalid state');
});

test('a new forgot invalidates the previous unused token', async () => {
  const user = await signup(server);
  const ip = '198.51.100.16';

  let count = mock.received.count;
  assertOk(await forgot(server, user.email, ip));
  const staleToken = resetTokenFrom(decodedBody(await waitForMail(mock, count + 1)));

  count = mock.received.count;
  assertOk(await forgot(server, user.email, ip));
  const freshToken = resetTokenFrom(decodedBody(await waitForMail(mock, count + 1)));

  assertErr(
    await api(server, 'POST', '/api/auth/reset', { body: { token: staleToken, password: 'kkkkkkkk1' } }),
    400,
    'invalid_token'
  );
  assertOk(await api(server, 'POST', '/api/auth/reset', { body: { token: freshToken, password: 'kkkkkkkk1' } }));
});

test('an expired token -> 400 invalid_token and the invalid page state; stored hash matches sha256(raw)', async () => {
  const user = await signup(server);
  const count = mock.received.count;
  assertOk(await forgot(server, user.email, '198.51.100.17'));
  const token = resetTokenFrom(decodedBody(await waitForMail(mock, count + 1)));

  const row = withDb((db) =>
    db.prepare('SELECT token_hash FROM password_resets WHERE user_id = (SELECT id FROM users WHERE email = ?)')
      .get(user.email)
  );
  assert.equal(row.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(row.token_hash, token, 'the raw token must never be stored');

  withDb((db) =>
    db.prepare('UPDATE password_resets SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), row.token_hash)
  );

  assertErr(
    await api(server, 'POST', '/api/auth/reset', { body: { token, password: 'kkkkkkkk2' } }),
    400,
    'invalid_token'
  );
  const page = await api(server, 'GET', `/reset?token=${token}`);
  assert.ok(page.text.includes(INVALID_EN));
});

test('weak password -> 400 invalid_password and the token stays usable', async () => {
  const user = await signup(server);
  const count = mock.received.count;
  assertOk(await forgot(server, user.email, '198.51.100.18'));
  const token = resetTokenFrom(decodedBody(await waitForMail(mock, count + 1)));

  assertErr(await api(server, 'POST', '/api/auth/reset', { body: { token, password: 'short' } }), 400, 'invalid_password');
  assertOk(await api(server, 'POST', '/api/auth/reset', { body: { token, password: 'kkkkkkkk3' } }));
});

test('forgot is rate limited to 5 per client per 15 minutes', async () => {
  const ip = '198.51.100.99';
  for (let i = 0; i < 5; i += 1) {
    assertOk(await forgot(server, uniqueEmail('rate'), ip));
  }
  assertErr(await forgot(server, uniqueEmail('rate'), ip), 429, 'rate_limited');
});

test('a malformed email still gets the uniform 200 with no mail', async () => {
  const before = mock.received.count;
  const res = await api(server, 'POST', '/api/auth/forgot', {
    body: { email: 'not-an-email' },
    headers: { 'X-Forwarded-For': '198.51.100.21' }
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(mock.received.count, before);
});

test('with SMTP unconfigured: forgot still answers 200 and stays silent', async () => {
  const user = await signup(off, { name: 'Offline SMTP User' });
  const res = await api(off, 'POST', '/api/auth/forgot', { body: { email: user.email } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
