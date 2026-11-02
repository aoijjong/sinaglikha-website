/*
  GET /api/employee-file?id=<item id>

  Gives a signed-in employee a short-lived link (5 minutes) to open one Published item that is
  meant for Employees or the Public. Links go straight to their web address. Anything else, such
  as a draft, an archived item or a managers-only file, answers "not found".
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return E.send(res, 405, { error: 'Use GET.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });

  const id = String((req.query && req.query.id) || '');
  if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });

  const r = await E.rest('GET', `content_items?id=eq.${id}&status=eq.published&audience=in.(employees,public)&select=kind,file_path,external_url`);
  const item = r.ok && Array.isArray(r.data) && r.data[0];
  if (!item) return E.send(res, 404, { error: "That item isn't available any more." });

  if (item.kind === 'link') {
    if (!/^https?:\/\//i.test(item.external_url || '')) return E.send(res, 404, { error: "That item isn't available any more." });
    return E.send(res, 200, { url: item.external_url });
  }
  if (!item.file_path) return E.send(res, 404, { error: "That item isn't available any more." });

  const path = item.file_path.split('/').map(encodeURIComponent).join('/');
  let signed;
  try {
    const s = await fetch(`${E.URL_BASE}/storage/v1/object/sign/content/${path}`, {
      method: 'POST',
      headers: E.svc({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: 300 })
    });
    signed = s.ok ? await s.json() : null;
  } catch {
    signed = null;
  }
  if (!signed || !signed.signedURL) return E.send(res, 502, { error: "Couldn't open that file. Try again in a moment." });
  const rel = signed.signedURL.startsWith('/') ? signed.signedURL : '/' + signed.signedURL;
  return E.send(res, 200, { url: rel.startsWith('/storage/v1/') ? `${E.URL_BASE}${rel}` : `${E.URL_BASE}/storage/v1${rel}` });
};
