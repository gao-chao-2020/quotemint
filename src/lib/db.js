import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export function resolveDataDir() {
  return resolve(process.env.DATA_DIR || './data');
}

export function dbPathFor(dataDir) {
  return join(dataDir, 'app.db');
}

export function usingPostgres() {
  return Boolean(process.env.DATABASE_URL);
}

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  brand_color TEXT NOT NULL DEFAULT '#4F46E5',
  logo_text TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_renews_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  items TEXT NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  tax_pct REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT, viewed_at TEXT, accepted_at TEXT, declined_at TEXT,
  accepted_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_token ON quotes(public_token);
CREATE TABLE IF NOT EXISTS quote_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_quote ON quote_events(quote_id);
CREATE TABLE IF NOT EXISTS admin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  target_email TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
`;

// Same columns as SQLite; timestamps stay TEXT ISO strings so both drivers
// read and write byte-identical values. Identity instead of AUTOINCREMENT.
const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  brand_color TEXT NOT NULL DEFAULT '#4F46E5',
  logo_text TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_renews_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  items TEXT NOT NULL,
  discount_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT, viewed_at TEXT, accepted_at TEXT, declined_at TEXT,
  accepted_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_token ON quotes(public_token);
CREATE TABLE IF NOT EXISTS quote_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id BIGINT NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_quote ON quote_events(quote_id);
CREATE TABLE IF NOT EXISTS admin_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  target_email TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
`;

// Rewrites ? placeholders to $1..$n, skipping single-quoted string literals.
function toPgSql(sql) {
  let out = '';
  let n = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
    } else if (ch === "'") {
      inString = true;
      out += ch;
    } else if (ch === '?') {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function pgPoolConfig() {
  const connectionString = process.env.DATABASE_URL;
  let ssl;
  try {
    const url = new URL(connectionString);
    if (url.hostname.endsWith('.neon.tech') || url.searchParams.get('sslmode') === 'require') {
      ssl = { rejectUnauthorized: true };
    }
  } catch {
    // Let pg surface the malformed connection string in its own error.
  }
  return { connectionString, ssl, max: 5 };
}

let pgInit = null;

function ensurePg() {
  if (!pgInit) {
    pgInit = (async () => {
      const mod = await import('pg');
      const pg = mod.default ?? mod;
      // int8 (BIGINT ids and COUNT(*)) comes back as a BigInt-safe string by
      // default; SQLite returned numbers, so keep JSON payload types identical.
      pg.types.setTypeParser(20, Number);
      const pool = new pg.Pool(pgPoolConfig());
      await pool.query(PG_SCHEMA);
      return pool;
    })().catch((err) => {
      pgInit = null;
      throw err;
    });
  }
  return pgInit;
}

function openSqliteDb(dataDir) {
  let openPromise = null;

  // Lazy so the Postgres path (Netlify/Neon) never imports node:sqlite or
  // touches the filesystem at module load. The specifier is assembled at
  // runtime so bundlers (esbuild on EdgeOne) cannot try to resolve node:sqlite
  // at build time on their older builtin lists.
  function open() {
    if (!openPromise) {
      openPromise = (async () => {
        const sqliteBuiltin = ['node', 'sqlite'].join(':');
        const { DatabaseSync } = await import(sqliteBuiltin);
        mkdirSync(dataDir, { recursive: true });
        const db = new DatabaseSync(dbPathFor(dataDir));
        db.exec('PRAGMA journal_mode = WAL;');
        db.exec('PRAGMA foreign_keys = ON;');
        db.exec(SQLITE_SCHEMA);
        return db;
      })().catch((err) => {
        openPromise = null;
        throw err;
      });
    }
    return openPromise;
  }

  return {
    dialect: 'sqlite',
    async get(sql, ...params) {
      const db = await open();
      return db.prepare(sql).get(...params);
    },
    async all(sql, ...params) {
      const db = await open();
      return db.prepare(sql).all(...params);
    },
    async run(sql, ...params) {
      const db = await open();
      const info = db.prepare(sql).run(...params);
      return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
    },
    // Same BEGIN IMMEDIATE / COMMIT / ROLLBACK flow as before. DatabaseSync
    // calls resolve without I/O, so the awaited statements of one transaction
    // cannot be interleaved with another request's handler.
    async transaction(fn) {
      const db = await open();
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async close() {
      if (!openPromise) return;
      const db = await openPromise;
      openPromise = null;
      db.close();
    },
    isUniqueError(err) {
      return typeof err?.message === 'string' && err.message.includes('UNIQUE constraint failed');
    }
  };
}

function openPgDb() {
  const txStore = new AsyncLocalStorage();

  async function query(sql, params) {
    const pool = await ensurePg();
    const client = txStore.getStore() ?? pool;
    return client.query(toPgSql(sql), params);
  }

  return {
    dialect: 'postgres',
    async get(sql, ...params) {
      const result = await query(sql, params);
      return result.rows[0];
    },
    async all(sql, ...params) {
      const result = await query(sql, params);
      return result.rows;
    },
    async run(sql, ...params) {
      if (/^\s*insert\b/i.test(sql) && !/\breturning\b/i.test(sql)) {
        const result = await query(`${sql} RETURNING id`, params);
        return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id ?? 0 };
      }
      const result = await query(sql, params);
      return { changes: result.rowCount ?? 0, lastInsertRowid: 0 };
    },
    async transaction(fn) {
      const pool = await ensurePg();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // SQLite's BEGIN IMMEDIATE serializes every writer; this global
        // transaction-scoped advisory lock reproduces that for the quota
        // check-plus-insert. Revisit per-user locks if throughput ever matters.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['quotemint:write']);
        const result = await txStore.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Connection already broken; the original error is what matters.
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      if (!pgInit) return;
      const pool = await pgInit;
      pgInit = null;
      await pool.end();
    },
    isUniqueError(err) {
      return err?.code === '23505';
    }
  };
}

export function openDb(dataDir = resolveDataDir()) {
  return usingPostgres() ? openPgDb() : openSqliteDb(dataDir);
}
