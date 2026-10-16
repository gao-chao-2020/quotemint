const BODY_LIMIT_BYTES = 1024 * 1024;

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Raw request body (Buffer), capped at 1MB. Callers that need bytes (webhook
// signature verification) use this directly; readJson() layers JSON parsing on top.
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        overflow = true;
        chunks.length = 0;
        // Drop excess but keep draining so the 413 response reaches the client.
        if (size > BODY_LIMIT_BYTES * 8) {
          reject(new HttpError(413, 'payload_too_large', 'Request body exceeds 1MB'));
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (overflow) {
        reject(new HttpError(413, 'payload_too_large', 'Request body exceeds 1MB'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export async function readJson(req) {
  const raw = (await readBody(req)).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const jar = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    const raw = part.slice(idx + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // Malformed percent-encoding: fall back to the raw value instead of rejecting the request.
    }
    jar[name] = value;
  }
  return jar;
}

export function setSessionCookie(res, token, baseUrl) {
  const secure =
    String(baseUrl || '').startsWith('https') || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `qm_session=${token}; HttpOnly; SameSite=Lax; Path=/${secure}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'qm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

export function clientIp(req) {
  // XFF is client-forgeable; only honor it behind a trusted reverse proxy. The trusted
  // proxy appends the peer it saw, so the RIGHTMOST entry is the trustworthy one
  // (leftmost can be attacker-supplied when the proxy appends instead of overwriting).
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const parts = forwarded.split(',');
      const last = parts[parts.length - 1].trim();
      if (last) return last;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

// In-memory per-process state: on Netlify Functions every warm instance keeps
// its own counters, so effective limits are per-instance. Accepted v0 — move
// to a shared store if abuse ever shows up.
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const cutoff = now - windowMs;
      const recent = (hits.get(key) || []).filter((ts) => ts > cutoff);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10000) {
        for (const [k, v] of hits) {
          if (v.length === 0 || v[v.length - 1] <= cutoff) hits.delete(k);
        }
      }
      return true;
    }
  };
}

export function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    // Proxies (Netlify, EdgeOne) may rewrite Host or append a default port;
    // accept the origin when it matches a forwarded or injected public host
    // in any of the equivalent spellings (with/without :443/:80). EdgeOne
    // replaces Host with an internal domain and passes the public one in
    // eo-pages-host.
    const rawHosts = [req.headers['x-forwarded-host'], req.headers['eo-pages-host'], req.headers.host];
    const candidates = [];
    for (const raw of rawHosts) {
      if (!raw) continue;
      candidates.push(raw, raw.replace(/:(443|80)$/, ''));
    }
    return candidates.includes(originHost);
  } catch {
    return false;
  }
}

export function enforceCsrf(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    sendError(res, 403, 'csrf', 'Missing X-Requested-With header');
    return false;
  }
  if (!checkOrigin(req)) {
    console.error('[csrf-origin] mismatch', JSON.stringify({
      origin: req.headers.origin,
      host: req.headers.host,
      xForwardedHost: req.headers['x-forwarded-host']
    }));
    sendError(res, 403, 'origin', 'Origin does not match Host');
    return false;
  }
  return true;
}
