import { adapt } from '../../src/lib/serverless-adapter.js';

export async function handler(event, context) {
  return adapt(event, context);
}
