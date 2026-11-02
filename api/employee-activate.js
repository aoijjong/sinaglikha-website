/*
  POST /api/employee-activate   { "employee_no": "SNG-0001", "code": "K7M2-9QXA", "pin": "482913" }

  First sign-in: the employee uses the one-time activation code from Staffing and Recruitment
  and chooses their own 6-digit PIN. The code works once and expires after 7 days. This only
  sets the PIN; the employee then signs in with it on the sign-in page.
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
  const code = E.normalizeCode(body.code);
  const pin = String(body.pin || '');
  const generic = "That Employee ID and code didn't work. The code may have expired or been used already. Ask Staffing and Recruitment for a new one.";

  if (!E.ID_RE.test(no) || code.length !== 8) return E.send(res, 400, { error: generic });
  const weak = E.pinProblem(pin, no);
  if (weak) return E.send(res, 400, { error: weak });

  const ip = E.ipHash(req);
  if (await E.deviceBlocked(ip)) {
    return E.send(res, 429, { error: 'Too many wrong tries from this device. Try again in 15 minutes.' });
  }

  const found = await E.loadEmployee(no);
  if (!found || !found.emp.active || !found.sec.code_hash || !found.emp.code_expires_at ||
      new Date(found.emp.code_expires_at).getTime() < Date.now()) {
    await E.noteAttempt(ip, no, false);
    return E.send(res, 401, { error: generic });
  }
  if (E.isLocked(found.emp)) {
    await E.noteAttempt(ip, no, false);
    return E.send(res, 429, { error: 'Too many wrong tries. Try again in 15 minutes, or ask Staffing and Recruitment for a new code.' });
  }
  if (!E.sameText(E.codeHash(code), found.sec.code_hash)) {
    await E.noteFailure(found.emp, found.sec);
    await E.noteAttempt(ip, no, false);
    return E.send(res, 401, { error: generic });
  }

  const version = (found.sec.session_version || 1) + 1;
  const saved = await E.rest('PATCH', `employee_secrets?employee_id=eq.${found.emp.id}`, {
    pin_hash: await E.hashPin(pin), code_hash: null, failed_attempts: 0, session_version: version
  }, 'return=minimal');
  if (!saved.ok) return E.send(res, 500, { error: "Couldn't save your PIN. Try again." });
  await E.rest('PATCH', `employees?id=eq.${found.emp.id}`, {
    pin_set: true, code_expires_at: null, locked_until: null, last_login_at: new Date().toISOString()
  }, 'return=minimal');
  await E.noteAttempt(ip, no, true);
  await E.logAudit('employee.activate', no);
  return E.send(res, 200, { ok: true });
};
