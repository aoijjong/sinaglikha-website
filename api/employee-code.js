/*
  POST /api/employee-code   { "employee_ids": ["<uuid>", ...] }      (up to 100 at a time)

  Issues a new one-time activation code for each employee. Only a signed-in, active
  Administrator or Senior Manager of Staffing and Recruitment may call it. The same call
  handles a lost or locked PIN: it removes the old PIN, clears any lock and signs the employee
  out everywhere, so they must activate again with the new code.

  The codes come back in this one answer and are never stored in readable form, so they cannot
  be shown again. Closing the "Print Activation Slips" page means issuing new ones.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return E.send(res, 405, { error: 'Use POST.' });
  }
  if (!E.configured() || !E.ANON) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });

  // 1. Who is calling?
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return E.send(res, 401, { error: 'Please sign in again.' });
  let userId;
  try {
    const who = await fetch(`${E.URL_BASE}/auth/v1/user`, { headers: { apikey: E.ANON, Authorization: `Bearer ${token}` } });
    if (!who.ok) return E.send(res, 401, { error: 'Please sign in again.' });
    userId = (await who.json()).id;
  } catch {
    return E.send(res, 502, { error: 'Could not reach the login service.' });
  }
  if (!userId) return E.send(res, 401, { error: 'Please sign in again.' });

  // 2. Are they allowed? (checked with the secret key, not trusted from the browser)
  const prof = await E.rest('GET', `profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,role,active,department`);
  const me = prof.ok && prof.data && prof.data[0];
  const allowed = me && me.active === true && (me.role === 'admin' || (me.role === 'senior_manager' && me.department === 'staffing'));
  if (!allowed) return E.send(res, 403, { error: 'Only Staffing and Recruitment can issue activation codes.' });

  // 3. Which employees?
  const body = await E.readJson(req);
  const ids = body && Array.isArray(body.employee_ids) ? body.employee_ids.filter((x) => UUID_RE.test(String(x))) : [];
  if (!ids.length || ids.length > 100) return E.send(res, 400, { error: 'Choose between 1 and 100 employees.' });
  const list = ids.join(',');
  const found = await E.rest('GET', `employees?id=in.(${list})&active=eq.true&select=id,employee_no,full_name`);
  if (!found.ok || !Array.isArray(found.data) || !found.data.length) return E.send(res, 404, { error: 'No active employees matched.' });

  // 4. New codes; the old PIN, any lock and every session go with them
  const prior = await E.rest('GET', `employee_secrets?employee_id=in.(${found.data.map((e) => e.id).join(',')})&select=employee_id,session_version`);
  const versions = {};
  ((prior.ok && prior.data) || []).forEach((r) => { versions[r.employee_id] = r.session_version || 1; });

  const expires = new Date(Date.now() + E.CODE_DAYS * 86400000).toISOString();
  const codes = found.data.map((e) => ({ id: e.id, employee_no: e.employee_no, full_name: e.full_name, code: E.makeCode() }));

  const saved = await E.rest('POST', 'employee_secrets', codes.map((c) => ({
    employee_id: c.id, code_hash: E.codeHash(c.code), pin_hash: null, failed_attempts: 0, session_version: (versions[c.id] || 1) + 1
  })), 'resolution=merge-duplicates,return=minimal');
  if (!saved.ok) return E.send(res, 500, { error: "Couldn't issue the codes. Nothing was changed." });
  await E.rest('PATCH', `employees?id=in.(${codes.map((c) => c.id).join(',')})`, {
    pin_set: false, code_expires_at: expires, locked_until: null
  }, 'return=minimal');

  await E.logAudit('employee.code', `${codes.length} employee${codes.length === 1 ? '' : 's'}`, { employees: codes.map((c) => c.employee_no) }, me);
  return E.send(res, 200, {
    expires_at: expires,
    codes: codes.map((c) => ({ id: c.id, employee_no: c.employee_no, full_name: c.full_name, code: E.showCode(c.code) }))
  });
};
