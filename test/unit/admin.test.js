import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../../src/lib/auth.js';
import {
  adminEnabled,
  isAdminAuthed,
  signAdminToken,
  verifyAdminPassword,
  verifyAdminToken
} from '../../src/lib/admin.js';

function withEnv(values, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const SECRET_ENV = { ADMIN_SESSION_SECRET: 'unit-test-secret' };

test('admin token round-trips and rejects tampering, expiry, and malformed input', () => {
  withEnv(SECRET_ENV, () => {
    const exp = Date.now() + 60_000;
    const token = signAdminToken(exp);
    assert.match(token, /^\d+\.[0-9a-f]{64}$/);
    assert.equal(verifyAdminToken(token), true);

    // Tampered expiry: signature no longer matches the payload.
    assert.equal(verifyAdminToken(`2${token}`), false);

    // Tampered signature.
    const sig = token.slice(token.indexOf('.') + 1);
    const flipped = `${sig[0] === 'a' ? 'b' : 'a'}${sig.slice(1)}`;
    assert.equal(verifyAdminToken(`${exp}.${flipped}`), false);

    // Expired token.
    assert.equal(verifyAdminToken(signAdminToken(Date.now() - 1_000)), false);

    // Malformed shapes.
    for (const bad of ['', 'garbage', '.', '123.', '.abcdef', 'abc.def', '1234.zzzz', String(exp)]) {
      assert.equal(verifyAdminToken(bad), false, `expected reject: ${JSON.stringify(bad)}`);
    }
    assert.equal(verifyAdminToken(null), false);
    assert.equal(verifyAdminToken(undefined), false);

    // A different secret must not validate another instance's token.
    withEnv({ ADMIN_SESSION_SECRET: 'other-secret' }, () => {
      assert.equal(verifyAdminToken(token), false);
    });
  });
});

test('verifyAdminToken rejects when ADMIN_SESSION_SECRET is missing', () => {
  withEnv({ ADMIN_SESSION_SECRET: undefined }, () => {
    assert.equal(verifyAdminToken(signAdminToken(Date.now() + 60_000)), false);
  });
});

test('isAdminAuthed reads the qm_admin cookie and rejects tampered cookies', () => {
  withEnv(SECRET_ENV, () => {
    const token = signAdminToken(Date.now() + 60_000);
    assert.equal(isAdminAuthed({ headers: { cookie: `qm_admin=${token}` } }), true);
    assert.equal(isAdminAuthed({ headers: { cookie: `other=1; qm_admin=${token}` } }), true);
    assert.equal(isAdminAuthed({ headers: { cookie: 'qm_admin=9999999999999.badbad' } }), false);
    assert.equal(isAdminAuthed({ headers: {} }), false);
  });
});

test('admin password verify accepts the configured hash and rejects anything else', () => {
  withEnv({ ADMIN_PASSWORD_HASH: hashPassword('correct-horse-battery') }, () => {
    assert.equal(verifyAdminPassword('correct-horse-battery'), true);
    assert.equal(verifyAdminPassword('wrong-password'), false);
    assert.equal(verifyAdminPassword(''), false);
    assert.equal(verifyAdminPassword(undefined), false);
  });
  withEnv({ ADMIN_PASSWORD_HASH: 'not-a-scrypt-hash' }, () => {
    assert.equal(verifyAdminPassword('anything'), false);
  });
});

test('adminEnabled requires both ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET', () => {
  withEnv({ ADMIN_PASSWORD_HASH: undefined, ADMIN_SESSION_SECRET: undefined }, () => {
    assert.equal(adminEnabled(), false);
  });
  withEnv({ ADMIN_PASSWORD_HASH: 'scrypt$x$y', ADMIN_SESSION_SECRET: undefined }, () => {
    assert.equal(adminEnabled(), false);
  });
  withEnv({ ADMIN_PASSWORD_HASH: undefined, ADMIN_SESSION_SECRET: 'secret' }, () => {
    assert.equal(adminEnabled(), false);
  });
  withEnv({ ADMIN_PASSWORD_HASH: 'scrypt$x$y', ADMIN_SESSION_SECRET: '' }, () => {
    assert.equal(adminEnabled(), false);
  });
  withEnv({ ADMIN_PASSWORD_HASH: 'scrypt$x$y', ADMIN_SESSION_SECRET: 'secret' }, () => {
    assert.equal(adminEnabled(), true);
  });
});
