import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// esbuild's CJS bundle for Lambda has an empty import.meta, so nothing here
// may run at module-load time. Resolve on first use and cache the result.
let cachedRoot = null;

function projectRoot() {
  if (!cachedRoot) {
    const rawMetaUrl = import.meta.url;
    const metaUrl = typeof rawMetaUrl === 'string' && rawMetaUrl ? rawMetaUrl : '';
    cachedRoot = metaUrl ? fileURLToPath(new URL('../..', metaUrl)) : process.env.LAMBDA_TASK_ROOT || process.cwd();
  }
  return cachedRoot;
}

export function publicDir() {
  return resolve(projectRoot(), 'public');
}

// Assets deliberately kept OUT of public/ (served only through gated routes).
export function assetsDir() {
  return resolve(projectRoot(), 'src', 'assets');
}
