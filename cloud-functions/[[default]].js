// EdgeOne Makers Node.js function entry — framework-mode probe.
// Mirrors an Express app's callable shape (function + .handle) to verify the
// runtime dispatches real Node (req, res) objects before the app is mounted.
function app(req, res, next) {
  app.handle(req, res, next);
}

app.handle = function handle(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('set-cookie', ['eo_probe=a; Path=/', 'eo_probe2=b; Path=/']);
    res.end(JSON.stringify({
      ok: true,
      node: process.version,
      method: req.method,
      url: req.url,
      httpVersion: req.httpVersion || null,
      hasReqOn: typeof req.on,
      hasResWriteHead: typeof res.writeHead,
      hasResSetHeader: typeof res.setHeader,
      hasResEnd: typeof res.end,
      remoteAddress: req.socket ? req.socket.remoteAddress : null,
      xff: req.headers['x-forwarded-for'] || null,
      host: req.headers.host || null,
      envKeys: Object.keys(process.env).length,
      bodyEcho: body.slice(0, 120)
    }));
  });
};

app.use = function use() { return app; };
app.listen = function listen() { return app; };
app.set = function set() { return app; };
app.callback = function callback() { return app; };
app.stack = [];
app.settings = {};
app.locals = {};

export default app;
