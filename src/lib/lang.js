import { parseCookies } from './http.js';

export function resolveLang(req) {
  const cookie = parseCookies(req).lang;
  if (cookie === 'en' || cookie === 'zh') return cookie;
  const header = req.headers['accept-language'];
  if (typeof header === 'string') {
    let bestTag = '';
    let bestQ = -1;
    for (const part of header.split(',')) {
      const [rawTag, ...params] = part.split(';');
      const tag = rawTag.trim().toLowerCase();
      if (!tag) continue;
      let q = 1;
      for (const param of params) {
        const eq = param.indexOf('=');
        if (eq === -1 || param.slice(0, eq).trim().toLowerCase() !== 'q') continue;
        const parsed = Number.parseFloat(param.slice(eq + 1));
        q = Number.isFinite(parsed) ? parsed : 0;
      }
      if (q > bestQ) {
        bestQ = q;
        bestTag = tag;
      }
    }
    if (bestTag.startsWith('zh')) return 'zh';
  }
  return 'en';
}

export function safeNext(next) {
  if (typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  // URL parsers strip ASCII tab/newline, turning "/<TAB>/evil.com" into "//evil.com" (open redirect).
  if (/[\u0000-\u0020\u007F]/.test(next)) return '/';
  return next;
}
