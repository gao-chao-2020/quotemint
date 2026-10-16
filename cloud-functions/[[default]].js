// EdgeOne Makers entry (Node.js framework mode).
//
// The Makers builder detects Express apps by AST analysis (import of
// "express" + `express()` call + default export) and its runtime invokes the
// exported app with Node's real (req, res), catching framework errors into a
// 502. "express" resolves to the local shim in vendor/express — see that
// package for the rationale. Static files keep platform-level priority; every
// path not found on disk lands here and goes through the normal QuoteMint
// request pipeline untouched.
import express from 'express';
import { handleRequest } from '../src/server.js';

const app = express();
app.use((req, res) => handleRequest(req, res));

export default app;
