/*
  Everything about the signed-in employee themselves, in one function (Vercel's free plan allows 12).

  GET  /api/employee-me                                    who is signed in, with their profile photo
  POST /api/employee-me  { "avatar": "data:image/jpeg;base64,..." | null }   set or remove the photo
  POST /api/employee-me  { "action": "pin", "current": "482913", "next": "905317" }   change the PIN
  POST /api/employee-me  { "action": "logout" }            end the session on this device

  Changing the PIN signs every other device out. Name and position are set by Staffing and
  Recruitment and can't be changed here. The photo column comes from supabase/employees_avatar.sql.
*/

const E = require('./_employee');

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

async function changePin(req, res, me, body) {
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
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return E.send(res, 405, { error: 'Use GET or POST.' });
  }

  // Signing out needs no session: it just clears the cookie.
  const body = req.method === 'POST' ? await E.readJson(req) : null;
  if (body && body.action === 'logout') {
    E.clearSession(res);
    return E.send(res, 200, { ok: true });
  }

  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) {
    E.clearSession(res);
    return E.send(res, 401, { error: 'Please sign in.' });
  }

  if (req.method === 'GET') {
    // Read on its own so a missing photo column never stops someone from signing in.
    const r = await E.rest('GET', `employees?id=eq.${me.emp.id}&select=avatar`);
    const row = r.ok && Array.isArray(r.data) && r.data[0];
    const avatar = row && typeof row.avatar === 'string' && AVATAR_RE.test(row.avatar) ? row.avatar : null;
    return E.send(res, 200, {
      employee: { employee_no: me.emp.employee_no, full_name: me.emp.full_name, position: me.emp.position, avatar }
    });
  }

  if (!body) return E.send(res, 400, { error: 'Bad request.' });
  if (body.action === 'pin') return changePin(req, res, me, body);
  if (!('avatar' in body)) return E.send(res, 400, { error: 'Bad request.' });
  let avatar = body.avatar;
  if (avatar === null || avatar === '') avatar = null;
  else if (typeof avatar !== 'string' || avatar.length > 120000 || !AVATAR_RE.test(avatar)) {
    return E.send(res, 400, { error: 'That picture is not allowed. Use a small JPEG, PNG or WebP picture.' });
  }
  const saved = await E.rest('PATCH', `employees?id=eq.${me.emp.id}`, { avatar }, 'return=minimal');
  if (!saved.ok) {
    return E.send(res, 501, { error: "Photos aren't set up yet. Ask your administrator to finish the setup." });
  }
  return E.send(res, 200, { ok: true });
};
