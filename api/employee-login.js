/*
  POST /api/employee-login   { "employee_no": "SNG-0001", "pin": "482913" }

  Signs an employee in with their Employee ID and PIN. On success it sets a signed HttpOnly
  cookie. Every refusal looks the same, so the page never says which half was wrong.
*/

const E = require('./_employee');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return E.send(res, 405, { error: 'Use POST.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });

  const body = await E.readJson(req);
  if (!body) return E.send(res, 400, { error: 'Bad request.' });
  const no = E.normalizeId(body.employee_no);
  const pin = String(body.pin || '');
  const generic = 'Check your Employee ID and PIN.';
  if (!E.ID_RE.test(no) || !/^\d{6}$/.test(pin)) return E.send(res, 400, { error: generic });

  const ip = E.ipHash(req);
  // Both reads start at once (they do not depend on each other), which saves a database round trip.
  const [blocked, found] = await Promise.all([E.deviceBlocked(ip), E.loadEmployee(no)]);
  if (blocked) {
    return E.send(res, 429, { error: 'Too many wrong tries from this device. Try again in 15 minutes.' });
  }

  if (!found || !found.emp.active || !found.emp.pin_set || !found.sec.pin_hash) {
    await E.burnTime(pin);
    await E.noteAttempt(ip, no, false);
    return E.send(res, 401, { error: generic });
  }
  if (E.isLocked(found.emp)) {
    await E.burnTime(pin);
    await E.noteAttempt(ip, no, false);
    return E.send(res, 429, { error: 'Too many wrong tries. Try again in 15 minutes, or ask Staffing and Recruitment for a new code.' });
  }

  const ok = await E.checkPin(pin, found.sec.pin_hash);
  if (!ok) {
    await E.noteFailure(found.emp, found.sec);
    await E.noteAttempt(ip, no, false);
    return E.send(res, 401, { error: generic });
  }

  // The PIN was right, so these four writes are independent: send them together instead of one after another.
  // (The wrong-PIN and unknown-ID paths above stay as they were: their timing is part of the guessing protection.)
  E.setSession(res, found.emp, found.sec.session_version);
  await Promise.all([
    E.rest('PATCH', `employee_secrets?employee_id=eq.${found.emp.id}`, { failed_attempts: 0 }, 'return=minimal'),
    E.rest('PATCH', `employees?id=eq.${found.emp.id}`, { last_login_at: new Date().toISOString(), locked_until: null }, 'return=minimal'),
    E.noteAttempt(ip, no, true),
    E.logAudit('employee.login', no)
  ]);
  return E.send(res, 200, {
    ok: true,
    employee: { employee_no: found.emp.employee_no, full_name: found.emp.full_name, position: found.emp.position }
  });
};
