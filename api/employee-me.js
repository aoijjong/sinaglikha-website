/*
  GET /api/employee-me

  Who is signed in on this device? Answers with the employee's name and ID, or 401.
*/

const E = require('./_employee');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return E.send(res, 405, { error: 'Use GET.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) {
    E.clearSession(res);
    return E.send(res, 401, { error: 'Please sign in.' });
  }
  return E.send(res, 200, {
    employee: { employee_no: me.emp.employee_no, full_name: me.emp.full_name, position: me.emp.position }
  });
};
