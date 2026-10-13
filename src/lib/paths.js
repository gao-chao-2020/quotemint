import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// esbuild's CJS bundle for Lambda has an empty import.meta, so nothing here
// may run at module-load time. Resolve on first use and cache the result.
let cached = null;

export function publicDir() {
  if (!cached) {
    const rawMetaUrl = import.meta.url;
    const metaUrl = typeof rawMetaUrl === 'string' && rawMetaUrl ? rawMetaUrl : '';
    const root = metaUrl ? fileURLToPath(new URL('../..', metaUrl)) : process.env.LAMBDA_TASK_ROOT || process.cwd();
    cached = resolve(root, 'public');
  }
  return cached;
}
