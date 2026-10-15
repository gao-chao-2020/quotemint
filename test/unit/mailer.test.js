import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { MailError, buildMessage, dotStuff, isConfigured, sendMail } from '../../src/lib/mailer.js';

const SMTP_USER_NAME = 'quotemint@example.com';
const SMTP_PASSWORD = 'client-app-password-123';

// Plain-TCP mock SMTP server so the suite runs fully offline. Every socket gets
// its own dialog state; `received` captures what the client actually sent.
async function startMockSmtp({ authReject = false, stall = false } = {}) {
  const received = { lines: [], authUser: null, authPass: null, mailFrom: null, rcptTo: null, data: null };
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    if (stall) return;
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
          socket.write(authReject ? '535 5.7.8 Authentication failed\r\n' : '235 2.7.0 Accepted\r\n');
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

async function withSmtpEnv(port, overrides, fn) {
  const vars = {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_SECURE: '0',
    SMTP_USER: SMTP_USER_NAME,
    SMTP_PASS: SMTP_PASSWORD,
    MAIL_FROM: undefined,
    ...overrides
  };
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function isMailError(code) {
  return (error) => {
    assert.ok(error instanceof MailError, `expected MailError, got ${error}`);
    assert.equal(error.code, code, error.message);
    return true;
  };
}

test('isConfigured requires host, port, user and pass', () => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(isConfigured(), false);
    process.env.SMTP_HOST = 'smtp.exmail.qq.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = SMTP_USER_NAME;
    assert.equal(isConfigured(), false);
    process.env.SMTP_PASS = SMTP_PASSWORD;
    assert.equal(isConfigured(), true);
    process.env.SMTP_PASS = '';
    assert.equal(isConfigured(), false);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('sendMail runs the full dialog against a mock server and delivers the message', async (t) => {
  const mock = await startMockSmtp();
  t.after(() => mock.close());
  const text = '你好，报价已被接受。\nSecond line.\n.borderline dot line\nlast line';

  const result = await withSmtpEnv(mock.port, {}, () =>
    sendMail({ to: 'client@example.com', subject: '报价已接受 ✓', text })
  );

  assert.deepEqual(result, { ok: true });
  assert.match(mock.received.lines[0], /^EHLO \S+$/);
  assert.equal(mock.received.lines[1], 'AUTH LOGIN');
  assert.equal(mock.received.lines.at(-1), 'QUIT');
  assert.equal(mock.received.authUser, SMTP_USER_NAME);
  assert.equal(mock.received.authPass, SMTP_PASSWORD);
  assert.equal(mock.received.mailFrom, `MAIL FROM:<${SMTP_USER_NAME}>`);
  assert.equal(mock.received.rcptTo, 'RCPT TO:<client@example.com>');

  const [headerBlock, ...bodyParts] = mock.received.data.split('\r\n\r\n');
  assert.match(headerBlock, /^From: quotemint@example\.com$/m);
  assert.match(headerBlock, /^To: client@example\.com$/m);
  const encodedSubject = /^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m.exec(headerBlock);
  assert.ok(encodedSubject, `subject must be RFC 2047 encoded:\n${headerBlock}`);
  assert.equal(Buffer.from(encodedSubject[1], 'base64').toString('utf8'), '报价已接受 ✓');
  assert.match(headerBlock, /^Date: \w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000$/m);
  assert.match(headerBlock, /^Message-ID: <[0-9a-f]{32}@example\.com>$/m);
  assert.match(headerBlock, /^MIME-Version: 1\.0$/m);
  assert.match(headerBlock, /^Content-Type: text\/plain; charset=utf-8$/m);
  assert.match(headerBlock, /^Content-Transfer-Encoding: base64$/m);

  const decodedBody = Buffer.from(bodyParts.join(''), 'base64').toString('utf8');
  assert.equal(decodedBody, text);
});

test('MAIL_FROM sets the default sender and an explicit from wins', async (t) => {
  const mock = await startMockSmtp();
  t.after(() => mock.close());

  await withSmtpEnv(mock.port, { MAIL_FROM: 'reminders@quotemint.net' }, async () => {
    await sendMail({ to: 'client@example.com', subject: 's', text: 't' });
    assert.equal(mock.received.mailFrom, 'MAIL FROM:<reminders@quotemint.net>');
    assert.match(mock.received.data, /^From: reminders@quotemint\.net$/m);
    assert.match(mock.received.data, /^Subject: s$/m); // ASCII subjects stay unencoded
  });

  await withSmtpEnv(mock.port, { MAIL_FROM: 'reminders@quotemint.net' }, async () => {
    await sendMail({ to: 'client@example.com', subject: 's', text: 't', from: 'billing@quotemint.net' });
    assert.equal(mock.received.mailFrom, 'MAIL FROM:<billing@quotemint.net>');
  });
});

test('SMTP env is read at call time, not at module load', async (t) => {
  const mock = await startMockSmtp();
  t.after(() => mock.close());
  await withSmtpEnv(mock.port, { SMTP_PASS: undefined }, async () => {
    assert.equal(isConfigured(), false);
    await assert.rejects(sendMail({ to: 'client@example.com', subject: 's', text: 't' }), isMailError('mail_not_configured'));
    process.env.SMTP_PASS = SMTP_PASSWORD;
    assert.equal(isConfigured(), true);
    assert.deepEqual(await sendMail({ to: 'client@example.com', subject: 's', text: 't' }), { ok: true });
  });
});

test('buildMessage produces RFC 2047 headers, wrapped base64 body and pure CRLF', () => {
  const message = buildMessage({
    from: 'noreply@example.com',
    to: 'client@example.com',
    subject: '续费提醒',
    text: 'A'.repeat(120),
    date: new Date('2026-10-14T08:09:10Z'),
    messageId: '<fixed@example.com>'
  });

  assert.match(message, /^From: noreply@example\.com\r\n/);
  const encodedSubject = /^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m.exec(message);
  assert.equal(Buffer.from(encodedSubject[1], 'base64').toString('utf8'), '续费提醒');
  assert.ok(message.includes('Date: Wed, 14 Oct 2026 08:09:10 +0000\r\n'));
  assert.ok(message.includes('Message-ID: <fixed@example.com>\r\n'));
  assert.ok(message.endsWith('\r\n'));

  assert.equal(/(^|[^\r])\n/.test(message), false, 'every LF must be part of CRLF');
  assert.equal(/\r(?!\n)/.test(message), false, 'no lone CR');

  const body = message.split('\r\n\r\n')[1];
  assert.ok(body.endsWith('\r\n'));
  const bodyLines = body.slice(0, -2).split('\r\n');
  assert.ok(bodyLines.every((line) => line.length <= 76 && line.length > 0));
  assert.equal(Buffer.from(bodyLines.join(''), 'base64').toString('utf8'), 'A'.repeat(120));
});

test('dotStuff escapes only leading dots and keeps everything else intact', () => {
  assert.equal(dotStuff('one\r\n.two\r\nx.y\r\n..three\r\n'), 'one\r\n..two\r\nx.y\r\n...three\r\n');
  assert.equal(dotStuff('no dots here'), 'no dots here');
});

test('sendMail rejects with mail_rejected when AUTH is refused', async (t) => {
  const mock = await startMockSmtp({ authReject: true });
  t.after(() => mock.close());
  await withSmtpEnv(mock.port, {}, async () => {
    await assert.rejects(
      sendMail({ to: 'client@example.com', subject: 's', text: 't' }),
      (error) => isMailError('mail_rejected')(error) && /535/.test(error.message)
    );
    assert.equal(mock.received.data, null); // never reached DATA
  });
});

test('sendMail rejects when the port is closed', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));

  await withSmtpEnv(port, {}, async () => {
    await assert.rejects(
      sendMail({ to: 'client@example.com', subject: 's', text: 't' }, { timeoutMs: 2000 }),
      isMailError('mail_connection_failed')
    );
  });
});

test('sendMail rejects with mail_timeout when the server never replies', async (t) => {
  const mock = await startMockSmtp({ stall: true });
  t.after(() => mock.close());
  await withSmtpEnv(mock.port, {}, async () => {
    const started = Date.now();
    await assert.rejects(
      sendMail({ to: 'client@example.com', subject: 's', text: 't' }, { timeoutMs: 300 }),
      isMailError('mail_timeout')
    );
    assert.ok(Date.now() - started < 5000);
  });
});

test('sendMail rejects with mail_not_configured before connecting', async () => {
  await withSmtpEnv(0, {
    SMTP_HOST: undefined,
    SMTP_PORT: undefined,
    SMTP_USER: undefined,
    SMTP_PASS: undefined
  }, async () => {
    await assert.rejects(
      sendMail({ to: 'client@example.com', subject: 's', text: 't' }),
      isMailError('mail_not_configured')
    );
  });
});

test('sendMail rejects invalid recipient addresses', async () => {
  for (const bad of ['not-an-email', 'two words@example.com', 'user@localhost', 'a@b.', '']) {
    await assert.rejects(
      sendMail({ to: bad, subject: 's', text: 't' }),
      isMailError('invalid_recipient')
    );
  }
});
