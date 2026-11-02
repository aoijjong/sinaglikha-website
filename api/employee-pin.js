/*
  POST /api/employee-pin   { "current": "482913", "next": "905317" }

  An employee changes their own PIN. Every other signed-in device is signed out.
*/

const E = require('./_employee');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return E.send(res, 405, { error: 'Use POST.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });

  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });

  const body = await E.readJson(req);
  if (!body) return E.send(res, 400, { error: 'Bad request.' });
  const current = String(body.current || '');
  const next = String(body.next || '');
  if (!/^\d{6}$/.test(current)) return E.send(res, 400, { error: 'Enter your current 6-digit PIN.' });
  const weak = E.pinProblem(next, me.emp.employee_no);
  if (weak) return E.send(res, 400, { error: weak });
  if (next === current) return E.send(res, 400, { error: 'Choose a PIN different from your current one.' });

  const ip = E.ipHash(req);
  if (await E.deviceBlocked(ip)) {
    return E.send(res, 429, { error: 'Too many wrong tries from this device. Try again in 15 minutes.' });
  }
  const found = await E.loadEmployee(me.emp.employee_no);
  if (!found || !found.sec.pin_hash) return E.send(res, 401, { error: 'Please sign in.' });
  if (E.isLocked(found.emp)) {
    return E.send(res, 429, { error: 'Too many wrong tries. Try again in 15 minutes, or ask Staffing and Recruitment for a new code.' });
  }
  if (!(await E.checkPin(current, found.sec.pin_hash))) {
    await E.noteFailure(found.emp, found.sec);
    await E.noteAttempt(ip, me.emp.employee_no, false);
    return E.send(res, 401, { error: "That isn't your current PIN." });
  }

  const version = (found.sec.session_version || 1) + 1;
  const saved = await E.rest('PATCH', `employee_secrets?employee_id=eq.${found.emp.id}`, {
    pin_hash: await E.hashPin(next), failed_attempts: 0, session_version: version
  }, 'return=minimal');
  if (!saved.ok) return E.send(res, 500, { error: "Couldn't save your new PIN. Try again." });
  E.setSession(res, found.emp, version);
  await E.logAudit('employee.pin.change', me.emp.employee_no);
  return E.send(res, 200, { ok: true });
};
