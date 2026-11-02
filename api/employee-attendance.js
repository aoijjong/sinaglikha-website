/*
  GET  /api/employee-attendance                   today's date (Philippine time) and the employee's own
                                                  records for the last 31 days
  POST /api/employee-attendance  { "action": "in" }    record the time in for today
  POST /api/employee-attendance  { "action": "out" }   record the time out for today

  The employee comes from the sign-in cookie, never from the request, so nobody can record or read
  another person's attendance. The server clock decides the time and the day (Philippine time,
  UTC+8); the page can't choose either. One time in and one time out per day: a second try is
  refused with a plain message. Each action is written to the activity log.
  Needs supabase/phase2.sql.
*/

const E = require('./_employee');

const FIELDS = 'id,work_date,time_in,time_out,note';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return E.send(res, 405, { error: 'Use GET or POST.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });

  const today = E.manilaDate();
  const id = me.emp.id;

  if (req.method === 'GET') {
    const since = E.manilaDate(Date.now() - 31 * 86400000);
    const r = await E.rest('GET', `attendance_records?employee_id=eq.${id}&work_date=gte.${since}&select=${FIELDS}&order=work_date.desc&limit=40`);
    // Before supabase/phase2.sql has been run the table doesn't exist yet.
    if (!r.ok || !Array.isArray(r.data)) return E.send(res, 200, { today, records: [], unavailable: true });
    return E.send(res, 200, { today, records: r.data });
  }

  const body = await E.readJson(req);
  const action = body && body.action;
  if (action !== 'in' && action !== 'out') return E.send(res, 400, { error: 'Bad request.' });

  const cur = await E.rest('GET', `attendance_records?employee_id=eq.${id}&work_date=eq.${today}&select=${FIELDS}`);
  if (!cur.ok || !Array.isArray(cur.data)) return E.send(res, 503, { error: "Attendance isn't set up yet. Ask your administrator to finish the setup." });
  const rec = cur.data[0] || null;
  const now = new Date().toISOString();

  if (action === 'in') {
    if (rec && rec.time_in) return E.send(res, 409, { error: 'You already timed in today.', record: rec });
    const saved = rec
      ? await E.rest('PATCH', `attendance_records?id=eq.${rec.id}`, { time_in: now }, 'return=representation')
      : await E.rest('POST', 'attendance_records', { employee_id: id, work_date: today, time_in: now }, 'return=representation');
    if (!saved.ok || !Array.isArray(saved.data) || !saved.data[0]) {
      // two taps at the same moment: the database allows only one record per day
      return E.send(res, 409, { error: 'You already timed in today.' });
    }
    await E.logAudit('attendance.in', me.emp.employee_no, { date: today });
    return E.send(res, 200, { ok: true, record: saved.data[0] });
  }

  if (!rec || !rec.time_in) return E.send(res, 409, { error: 'Time in first, then time out at the end of your day.' });
  if (rec.time_out) return E.send(res, 409, { error: 'You already timed out today.', record: rec });
  const saved = await E.rest('PATCH', `attendance_records?id=eq.${rec.id}&time_out=is.null`, { time_out: now }, 'return=representation');
  if (!saved.ok || !Array.isArray(saved.data) || !saved.data[0]) return E.send(res, 409, { error: 'You already timed out today.' });
  await E.logAudit('attendance.out', me.emp.employee_no, { date: today });
  return E.send(res, 200, { ok: true, record: saved.data[0] });
};
