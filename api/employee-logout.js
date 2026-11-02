/*
  POST /api/employee-logout

  Ends the employee's session on this device by clearing the cookie.
*/

const E = require('./_employee');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return E.send(res, 405, { error: 'Use POST.' });
  }
  E.clearSession(res);
  return E.send(res, 200, { ok: true });
};
