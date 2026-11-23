/*
  Email alerts for Legal Compliance (used by api/_grievance.js). Off until RESEND_API_KEY and GRIEVANCE_MAIL_FROM are set in
  Vercel (Project, Settings, Environment Variables); until then every call quietly does nothing, and a failed send never
  stops an employee's grievance from being saved.
    RESEND_API_KEY        an API key from resend.com (server only)
    GRIEVANCE_MAIL_FROM   a sender on a domain you verified there, e.g. SINAGLIKHA <alerts@yourdomain.com>
    SITE_URL              optional, the address of the site, for the link in the email (default: the address being visited)
  An email carries a ticket number at most. Never a name, a category, or any of the text. Anonymous grievances never cause an
  immediate email (the minute it arrives could be matched with someone's sign-in time); they only count in the daily summary.
*/

const E = require('./_employee');

const SEND_TIMEOUT_MS = 4000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function configured() { return !!(process.env.RESEND_API_KEY && process.env.GRIEVANCE_MAIL_FROM); }

async function send(to, subject, text) {
  const list = Array.from(new Set((to || []).filter((e) => EMAIL_RE.test(String(e || '')))));
  if (!configured() || !list.length) return { sent: false, skipped: true };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.GRIEVANCE_MAIL_FROM, to: list, subject, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    return { sent: r.ok, skipped: false };
  } catch {
    return { sent: false, skipped: false };
  }
}

/* Who gets told about a grievance, by who may handle it: Legal Compliance and the Administrator (legal), the Administrator
   only (the case involves Legal Compliance), or Legal Compliance only (the case involves the Administrator). */
async function handlers(routing) {
  const r = await E.rest('GET', 'profiles?active=eq.true&select=email,role,department&limit=300');
  const rows = Array.isArray(r.data) ? r.data : [];
  const isAdmin = (p) => p.role === 'admin';
  const isLegal = (p) => p.role === 'senior_manager' && p.department === 'legal';
  const pick = routing === 'admin_only' ? isAdmin : routing === 'legal_only' ? isLegal : (p) => isAdmin(p) || isLegal(p);
  return rows.filter(pick).map((p) => p.email).filter(Boolean);
}

function siteUrl(req) {
  const own = process.env.SITE_URL || (req && req.headers && req.headers.host ? 'https://' + req.headers.host : '');
  return String(own).replace(/\/+$/, '');
}
const where = (req) => 'Open the Senior Manager portal (' + siteUrl(req) + '/members/), then Content, Legal Compliance, Grievances.';

/* a new CONFIDENTIAL grievance */
async function newGrievance(req, ticket, routing) {
  return send(await handlers(routing), 'New grievance ' + ticket,
    'A new grievance was submitted. Ticket: ' + ticket + '.\n\n' + where(req) + '\n\nThis email deliberately says nothing else about it.');
}
/* the employee wrote on a CONFIDENTIAL grievance */
async function newReply(req, ticket, routing) {
  return send(await handlers(routing), 'New message on grievance ' + ticket,
    'The employee added a message to ticket ' + ticket + '.\n\n' + where(req) + '\n\nThis email deliberately says nothing else about it.');
}
/* the daily summary: counts only */
async function digest(req, group, c) {
  const to = await handlers(group === 'admin' ? 'admin_only' : 'legal_only');
  const parts = [];
  if (c.unacknowledged) parts.push(c.unacknowledged + ' not yet acknowledged');
  if (c.awaiting_reply) parts.push(c.awaiting_reply + ' waiting for a reply');
  if (c.overdue) parts.push(c.overdue + ' overdue');
  if (!parts.length) return { sent: false, skipped: true };
  return send(to, 'Grievances need attention: ' + parts.join(', '),
    'Grievances that need attention: ' + parts.join(', ') + '.\n\n' + where(req) + '\n\nThis is the daily summary. It contains only counts.');
}

module.exports = { configured, send, handlers, newGrievance, newReply, digest };
