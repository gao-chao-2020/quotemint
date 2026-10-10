const BODY_LIMIT_BYTES = 1024 * 1024;

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
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

export function readJson(req) {
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
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'invalid_json', 'Request body must be valid JSON'));
      }
    });
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const jar = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    jar[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return jar;
}

export function setSessionCookie(res, token, baseUrl) {
  const secure = String(baseUrl || '').startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `qm_session=${token}; HttpOnly; SameSite=Lax; Path=/${secure}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'qm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || 'unknown';
}

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
    const host = req.headers.host;
    return Boolean(host) && originHost === host;
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
    sendError(res, 403, 'origin', 'Origin does not match Host');
    return false;
  }
  return true;
}
