import { EventEmitter } from 'node:events';
import { handleRequest } from '../server.js';

function normalizeHeaders(event) {
  const headers = {};
  for (const [name, value] of Object.entries(event.headers || {})) {
    if (value == null) continue;
    headers[name.toLowerCase()] = String(value);
  }
  for (const [name, values] of Object.entries(event.multiValueHeaders || {})) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const key = name.toLowerCase();
    headers[key] = values.map(String).join(key === 'cookie' ? '; ' : ', ');
  }
  return headers;
}

// readJson/readBody attach their data/error/end listeners synchronously, so the
// buffered body is replayed on the first listener; emitting any earlier would
// lose it, since an EventEmitter drops events that have no listeners.
class ShadowRequest extends EventEmitter {
  constructor({ method, url, headers, body, remoteAddress }) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.socket = { remoteAddress };
    this._body = body;
    this._scheduled = false;
  }

  on(event, listener) {
    const result = super.on(event, listener);
    if (!this._scheduled && (event === 'data' || event === 'end')) {
      this._scheduled = true;
      queueMicrotask(() => {
        if (this._body.length > 0) this.emit('data', this._body);
        this.emit('end');
      });
    }
    return result;
  }

  // readJson calls destroy() on oversized bodies; a fully buffered event has
  // nothing to tear down.
  destroy() {}
}

export function createResponseCollector() {
  const headers = new Map();
  const chunks = [];
  let statusCode = 200;
  let sent = false;

  function setHeader(name, value) {
    const key = String(name).toLowerCase();
    if (key === 'set-cookie') {
      const values = Array.isArray(value) ? value : [value];
      headers.set(key, [...(headers.get(key) || []), ...values.map(String)]);
    } else {
      headers.set(key, [String(Array.isArray(value) ? value[0] : value)]);
    }
  }

  function writeHead(status, head) {
    statusCode = status;
    sent = true;
    for (const [name, value] of Object.entries(head || {})) setHeader(name, value);
  }

  function end(chunk) {
    if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
    sent = true;
  }

  const res = {
    // Unlike node:http, setHeader alone must not mark headers as sent — the
    // error handler in handleRequest relies on this to still send error pages.
    get headersSent() {
      return sent;
    },
    setHeader,
    writeHead,
    end,
    // server.js only calls destroy() after headersSent; nothing to tear down.
    destroy() {}
  };

  function toResponse() {
    const single = {};
    const multi = {};
    for (const [name, values] of headers) {
      if (name === 'set-cookie' && values.length > 1) {
        multi['Set-Cookie'] = values;
      } else if (values.length > 1) {
        single[name] = values.join(', ');
      } else {
        single[name] = values[0];
      }
    }
    // Netlify/Lambda v1: multiple Set-Cookie headers only survive via
    // multiValueHeaders; a single one goes in headers like any other.
    const response = {
      statusCode,
      headers: single,
      body: Buffer.concat(chunks).toString('base64'),
      isBase64Encoded: true
    };
    if (Object.keys(multi).length > 0) response.multiValueHeaders = multi;
    return response;
  }

  return { res, toResponse };
}

export async function adapt(event, context = {}) {
  const headers = normalizeHeaders(event);
  const method = String(event.httpMethod || event.method || 'GET').toUpperCase();
  const query = typeof event.rawQuery === 'string' && event.rawQuery ? `?${event.rawQuery}` : '';
  const url = typeof event.rawUrl === 'string' && event.rawUrl ? event.rawUrl : `${event.path || '/'}${query}`;
  const body =
    typeof event.body === 'string' && event.body.length > 0
      ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
      : Buffer.alloc(0);

  const req = new ShadowRequest({
    method,
    url,
    headers,
    body,
    remoteAddress: headers['x-nf-client-connection-ip'] || context.ip || 'unknown'
  });
  const collector = createResponseCollector();

  try {
    await handleRequest(req, collector.res);
  } catch (err) {
    console.error('[error] serverless adapter:', err && err.stack ? err.stack : err);
    if (!collector.res.headersSent) {
      collector.res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      collector.res.end(JSON.stringify({ ok: false, error: { code: 'internal_error', message: 'Something went wrong' } }));
    }
  }

  const response = collector.toResponse();
  if (method === 'HEAD') response.body = '';
  return response;
}
