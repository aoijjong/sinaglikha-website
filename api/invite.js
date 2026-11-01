/*
  POST /api/invite   { "email": "person@example.com", "name": "Optional name" }

  Sends an invitation email. Only a signed-in, active admin may call it.
  The Supabase service key stays on the server (Vercel environment variables);
  it is never sent to the browser. No npm packages are needed.

  Environment variables (set in Vercel -> Project -> Settings -> Environment Variables):
    SUPABASE_URL                e.g. https://abcdxyz.supabase.co
    SUPABASE_ANON_KEY           the public anon key
    SUPABASE_SERVICE_ROLE_KEY   the secret service_role key (server only)
    SITE_URL                    e.g. https://your-site.vercel.app   (optional)
*/

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function send(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST.' });
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 500, { error: 'Invites are not set up on the server yet.' });
  }

  // 1. Who is calling?
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return send(res, 401, { error: 'Please sign in again.' });

  let userId;
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!who.ok) return send(res, 401, { error: 'Please sign in again.' });
    userId = (await who.json()).id;
  } catch {
    return send(res, 502, { error: 'Could not reach the login service.' });
  }
  if (!userId) return send(res, 401, { error: 'Please sign in again.' });

  // 2. Are they an active admin? (checked with the service key, not trusted from the browser)
  try {
    const prof = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,active`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const rows = prof.ok ? await prof.json() : [];
    const me = rows[0];
    if (!me || me.role !== 'admin' || me.active !== true) {
      return send(res, 403, { error: 'Only administrators can send invitations.' });
    }
  } catch {
    return send(res, 502, { error: 'Could not check your permissions.' });
  }

  // 3. Validate the request
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return send(res, 400, { error: 'Enter a valid email address.' });
  }

  // 4. Send the invitation
  const site = (SITE_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
  const redirectTo = `${site}/members/`;
  try {
    const invite = await fetch(
      `${SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, data: { full_name: name } })
      }
    );
    if (!invite.ok) {
      const detail = await invite.json().catch(() => ({}));
      const message = detail.msg || detail.message || detail.error_description || 'Could not send the invitation.';
      return send(res, invite.status === 422 ? 409 : 400, { error: message });
    }
  } catch {
    return send(res, 502, { error: 'Could not reach the login service.' });
  }

  return send(res, 200, { ok: true });
};
