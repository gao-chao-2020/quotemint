// EdgeOne Makers Node.js function entry (req/res probe).
// Validates the runtime dispatch convention before the app is mounted.
export default function handler(req, res) {
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
      hasReqOn: typeof req.on,
      hasResWriteHead: typeof res.writeHead,
      hasResSetHeader: typeof res.setHeader,
      headerKeys: req.headers ? Object.keys(req.headers).length : -1,
      bodyEcho: body.slice(0, 200)
    }));
  });
}
