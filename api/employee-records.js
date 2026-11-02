/*
  GET /api/employee-records

  The signed-in employee's OWN compensation records (title, period, date), newest first. Evaluation
  results and disciplinary cases are never listed here. The employee is taken from the sign-in
  cookie, never from the request, so nobody can ask for someone else's records.
*/

const E = require('./_employee');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return E.send(res, 405, { error: 'Use GET.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });

  const r = await E.rest('GET',
    `restricted_records?employee_id=eq.${me.emp.id}&kind=eq.compensation&select=id,title,period,created_at&order=created_at.desc&limit=100`);
  // Before supabase/restricted_records.sql has been run the table does not exist yet: show nothing.
  if (!r.ok || !Array.isArray(r.data)) return E.send(res, 200, { records: [] });
  return E.send(res, 200, { records: r.data });
};
