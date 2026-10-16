// Minimal Express-compatible application used only by the EdgeOne Makers
// entry (cloud-functions/[[default]].js).
//
// Why this exists: the Makers builder classifies function files via AST
// analysis and only treats a file as a framework entry when it can see an
// app created from an actual `import ... from "express"` (or koa/hono). Its
// runtime then invokes that app with Node's real (req, res) — exactly what
// QuoteMint's handleRequest expects. Pulling in real Express for four stubs
// would drag ~60 transitive packages into a zero-dependency project, so this
// shim implements just the surface the runtime and entry actually use:
// app.use() and calling app(req, res). It is intentionally not a general
// Express implementation.
export default function express() {
  const stack = [];

  function app(req, res) {
    let index = 0;

    async function dispatch(err) {
      while (index < stack.length) {
        const fn = stack[index++];
        try {
          if (err) {
            if (fn.length === 4) return await fn(err, req, res, dispatch);
          } else if (fn.length < 4) {
            return await fn(req, res, dispatch);
          }
        } catch (e) {
          err = e;
        }
      }
      if (err) throw err;
    }

    return dispatch();
  }

  app.use = function use(fn) {
    stack.push(fn);
    return app;
  };
  app.set = function set() { return app; };
  app.get = function get() { return app; };
  app.post = function post() { return app; };
  app.listen = function listen() { return app; };
  app.callback = function callback() { return app; };
  app.handle = app;
  app.locals = {};
  app.settings = {};
  app.stack = stack;

  return app;
}
