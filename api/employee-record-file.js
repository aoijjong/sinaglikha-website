/*
  GET /api/employee-record-file?id=<record id>

  A short-lived link (5 minutes) to open one of the signed-in employee's OWN compensation
  records. Anything that is not theirs, or is not a compensation record, answers "not found".
  Every open is written to the activity log.
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

  const r = await E.rest('GET', `restricted_records?id=eq.${id}&employee_id=eq.${me.emp.id}&kind=eq.compensation&select=file_path,title`);
  const rec = r.ok && Array.isArray(r.data) && r.data[0];
  if (!rec || !rec.file_path) return E.send(res, 404, { error: "That record isn't available." });

  const path = rec.file_path.split('/').map(encodeURIComponent).join('/');
  let signed;
  try {
    const s = await fetch(`${E.URL_BASE}/storage/v1/object/sign/restricted/${path}`, {
      method: 'POST',
      headers: E.svc({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: 300 })
    });
    signed = s.ok ? await s.json() : null;
  } catch {
    signed = null;
  }
  if (!signed || !signed.signedURL) return E.send(res, 502, { error: "Couldn't open that file. Try again in a moment." });
  await E.logAudit('employee.record.open', me.emp.employee_no, { record: id, kind: 'compensation' });
  const rel = signed.signedURL.startsWith('/') ? signed.signedURL : '/' + signed.signedURL;
  return E.send(res, 200, { url: rel.startsWith('/storage/v1/') ? `${E.URL_BASE}${rel}` : `${E.URL_BASE}/storage/v1${rel}` });
};
