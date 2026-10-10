// PLACEHOLDER - owned by frontend, will be replaced with the full design system.
// Contract: must keep exporting esc() (HTML-escape) and layout().

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function layout({ title = 'QuoteMint', description = '', body = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
${body}
</body>
</html>`;
}
