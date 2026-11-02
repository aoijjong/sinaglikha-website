/*
  POST /api/remove-user   { "id": "<account id>" }

  Permanently deletes a DEACTIVATED account so the email can be invited again.
  Only a signed-in, active Senior Manager or administrator may call it. Safety rules:
    - you can't delete yourself,
    - a Senior Manager can only delete Senior Managers; hidden accounts can't be deleted here,
    - the account must already be deactivated (deactivate first, then delete),
    - the account's profile row disappears with it automatically.

  Uses the same Vercel environment variables as /api/invite. The secret key stays on the server.
*/

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST.' });
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 500, { error: 'Account removal is not set up on the server yet.' });
  }

  // The legacy service_role key is a JWT and goes in both headers; the newer sb_secret_ key
  // is not a JWT and goes only in `apikey`.
  const svc = (extra) => Object.assign(
    { apikey: SUPABASE_SERVICE_ROLE_KEY },
    /^sb_secret_/.test(SUPABASE_SERVICE_ROLE_KEY) ? {} : { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    extra
  );

  // 1. Who is calling?
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return send(res, 401, { error: 'Please sign in again.' });

  let callerId;
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!who.ok) return send(res, 401, { error: 'Please sign in again.' });
    callerId = (await who.json()).id;
  } catch {
    return send(res, 502, { error: 'Could not reach the login service.' });
  }
  if (!callerId) return send(res, 401, { error: 'Please sign in again.' });

  const lookup = async (id) => {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=role,active,email,hidden`,
      { headers: svc() }
    );
    const rows = r.ok ? await r.json() : [];
    return rows[0] || null;
  };

  // 2. Are they an active administrator or Senior Manager? (checked with the secret key,
  //    not trusted from the browser)
  let me;
  try {
    me = await lookup(callerId);
    if (!me || me.active !== true || (me.role !== 'admin' && me.role !== 'senior_manager')) {
      return send(res, 403, { error: 'Only Senior Managers can remove accounts.' });
    }
  } catch {
    return send(res, 502, { error: 'Could not check your permissions.' });
  }

  // 3. Validate the request
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const id = String((body && body.id) || '').trim();
  if (!UUID_RE.test(id)) return send(res, 400, { error: 'That account id is not valid.' });
  if (id.toLowerCase() === String(callerId).toLowerCase()) {
    return send(res, 400, { error: "You can't delete your own account." });
  }

  // 4. The target must exist and already be deactivated
  try {
    const target = await lookup(id);
    // Hidden accounts, and (for a Senior Manager) anyone who isn't a Senior Manager, are
    // answered exactly like a missing account so their existence isn't revealed.
    if (!target || target.hidden === true || (me.role !== 'admin' && target.role !== 'senior_manager')) {
      return send(res, 404, { error: 'That account was not found.' });
    }
    if (target.active !== false) {
      return send(res, 409, { error: 'Deactivate this account first, then delete it.' });
    }
  } catch {
    return send(res, 502, { error: 'Could not check that account.' });
  }

  // 5. Delete it
  try {
    const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: svc()
    });
    if (!del.ok) {
      const detail = await del.json().catch(() => ({}));
      const message = detail.msg || detail.message || detail.error_description || '';
      if (del.status === 404) return send(res, 404, { error: 'That account was already removed.' });
      if (/database error/i.test(message) || del.status >= 500) {
        return send(res, 409, {
          error: "This account has uploaded files, so Supabase won't delete it. Keep it deactivated instead."
        });
      }
      return send(res, 400, { error: message || 'Could not delete the account.' });
    }
  } catch {
    return send(res, 502, { error: 'Could not reach the login service.' });
  }

  return send(res, 200, { ok: true });
};
