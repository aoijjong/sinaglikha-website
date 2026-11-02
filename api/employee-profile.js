/*
  GET  /api/employee-profile                       the signed-in employee's profile photo
  POST /api/employee-profile  { "avatar": "data:image/jpeg;base64,..." | null }   set or remove it

  The photo is a small square picture kept with the employee's directory row. Name and position
  are set by Staffing and Recruitment and can't be changed here. The photo column comes from
  supabase/employees_avatar.sql; until it has been run, saving a photo says so.
*/

const E = require('./_employee');

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return E.send(res, 405, { error: 'Use GET or POST.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });

  if (req.method === 'GET') {
    const r = await E.rest('GET', `employees?id=eq.${me.emp.id}&select=avatar`);
    const row = r.ok && Array.isArray(r.data) && r.data[0];
    const a = row && typeof row.avatar === 'string' && AVATAR_RE.test(row.avatar) ? row.avatar : null;
    return E.send(res, 200, { avatar: a });
  }

  const body = await E.readJson(req);
  if (!body || !('avatar' in body)) return E.send(res, 400, { error: 'Bad request.' });
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
