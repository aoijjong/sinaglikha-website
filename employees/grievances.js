/*
  Grievances (Employee Portal, My Work). An employee raises a grievance with Legal Compliance, follows it, and replies.
  Everything is kept on the server (api/_grievance.js, reached through /api/employee-evaluate?gr=1). The panel stays
  hidden until supabase/grievances.sql has been run.
    Confidential  stored with the employee; only Legal Compliance can reveal who, and every reveal is logged.
    Anonymous     no employee is stored; the ticket number and the access code are the only way back in.
  Text is always shown as plain text, never as HTML.
*/
(function () {
  'use strict';
  var panel = document.getElementById('grv-panel'), body = document.getElementById('grv-body');
  var G = window.SngGrievance;
  if (!panel || !body || !G) return;

  var S = { available: false, mine: [], view: 'list', cur: null, access: null, done: null, error: '', loading: false };
  var toastTimer;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function icon(name) { return window.SngIcon ? window.SngIcon(name) : ''; }
  function when(iso) { return window.SngCommentTime ? window.SngCommentTime.stamp(iso) : ''; }
  function dateOnly(d) {
    if (!d) return '';
    var t = new Date(d + 'T00:00:00Z');
    return isNaN(t) ? '' : t.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  }
  function today() {   // the Philippine date, for the "not in the future" limit on the date field
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 4200);
  }
  async function api(method, query, data) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (data) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(data); }
    var r;
    try { r = await fetch('/api/employee-evaluate?gr=1' + (query || ''), opts); }
    catch (e) { return { ok: false, status: 0, data: { error: "Couldn't reach the server. Check your connection and try again." } }; }
    var json = {};
    try { json = await r.json(); } catch (e) { json = {}; }
    return { ok: r.ok, status: r.status, data: json };
  }
  function chip(status) { return '<span class="gv-chip gv-' + G.statusTone(status) + '">' + esc(G.statusLabel(status)) + '</span>'; }
  function err() { return S.error ? '<p class="msg bad" role="alert">' + esc(S.error) + '</p>' : ''; }

  /* ---------- the screens ---------- */
  function listView() {
    var rows = S.mine.length ? '<ul class="gv-list">' + S.mine.map(function (g) {
      return '<li><button class="gv-row" type="button" data-gv-open="' + esc(g.id) + '"><span class="gv-t"><b>' + esc(g.ticket_no) + '</b> &middot; ' + esc(g.subject) + '</span>' +
        '<span class="gv-m">' + esc(G.categoryLabel(g.category)) + ' &middot; ' + esc(when(g.created_at)) + '</span>' + chip(g.status) + '</button></li>';
    }).join('') + '</ul>' : '<div class="gv-none">You have not raised a grievance.</div>';
    return '<p class="gv-lead">Raise a concern with Legal Compliance, in confidence. Each one gets a ticket number so you can follow it.</p>' +
      '<div class="gv-actions"><button class="btn btn-primary btn-sm" type="button" data-gv="new">' + icon('plus') + 'Raise a grievance</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-gv="find">Check an anonymous grievance</button></div>' + rows;
  }

  function newView() {
    var cats = G.CATEGORIES.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>'; }).join('');
    return '<button class="gv-back" type="button" data-gv="list">' + icon('back') + 'Back</button>' + err() +
      '<form class="gv-form" id="gv-form" novalidate>' +
      '<label class="gv-l" for="gv-cat">What is it about?</label><select id="gv-cat"><option value="">Choose one</option>' + cats + '</select>' +
      '<label class="gv-l" for="gv-sub">Short title</label><input id="gv-sub" type="text" maxlength="' + G.LIMITS.subject + '" autocomplete="off">' +
      '<label class="gv-l" for="gv-body">What happened?</label><textarea id="gv-body" maxlength="' + G.LIMITS.body + '" placeholder="Describe what happened, as clearly as you can."></textarea>' +
      '<label class="gv-l" for="gv-date">When did it happen? <span class="gv-opt">(optional)</span></label><input id="gv-date" type="date" max="' + today() + '">' +
      '<label class="gv-l" for="gv-loc">Where? <span class="gv-opt">(optional)</span></label><input id="gv-loc" type="text" maxlength="' + G.LIMITS.location + '" autocomplete="off">' +
      '<label class="gv-l" for="gv-inv">Who was involved? <span class="gv-opt">(optional)</span></label><input id="gv-inv" type="text" maxlength="' + G.LIMITS.involved + '" autocomplete="off">' +
      '<div class="gv-l" id="gv-who-l">Who can see your name?</div><div class="gv-choices" role="radiogroup" aria-labelledby="gv-who-l">' +
      '<label class="gv-choice"><input type="radio" name="gv-who" value="confidential" checked><b>Keep my name confidential</b><span>Only Legal Compliance can see who you are, and only if they need to. You can follow the case under My Work.</span></label>' +
      '<label class="gv-choice"><input type="radio" name="gv-who" value="anonymous"><b>Send it anonymously</b><span>We do not record who you are. You get a ticket number and an access code, the only way to see replies. Legal Compliance may find it harder to look into it.</span></label>' +
      '</div><div class="gv-foot"><button class="btn btn-primary" type="submit" id="gv-send">Send grievance</button><button class="btn btn-ghost" type="button" data-gv="list">Cancel</button></div></form>';
  }

  function doneView() {
    var d = S.done, anon = !!d.access_code;
    return '<div class="gv-done"><h3>Your grievance was sent</h3><p class="gv-lead">Legal Compliance will acknowledge it. Quote this ticket number if you contact them.</p>' +
      '<div class="gv-ticket"><span id="gv-tn">' + esc(d.ticket_no) + '</span><button class="gv-copy" type="button" data-copy="' + esc(d.ticket_no) + '">Copy</button></div>' +
      (anon ? '<div class="gv-ticket"><span id="gv-ac">' + esc(d.access_code) + '</span><button class="gv-copy" type="button" data-copy="' + esc(d.access_code) + '">Copy</button></div>' +
        '<p class="gv-warn"><b>Save both now.</b> You need the ticket number and this access code to see replies. Because it is anonymous, we cannot recover them for you.</p>'
        : '<p class="gv-lead">You can follow it from this page under My Work.</p>') +
      '<div class="gv-foot" style="justify-content:center"><button class="btn btn-primary btn-sm" type="button" data-gv="' + (anon ? 'find' : 'list') + '">' + (anon ? 'Check an anonymous grievance' : 'Back to my grievances') + '</button>' +
      (anon ? '<button class="btn btn-ghost btn-sm" type="button" data-gv="list">Done</button>' : '') + '</div></div>';
  }

  function findView() {
    return '<button class="gv-back" type="button" data-gv="list">' + icon('back') + 'Back</button>' + err() +
      '<p class="gv-lead">Enter the ticket number and the access code you were given when you sent it anonymously.</p>' +
      '<form class="gv-find" id="gv-find" novalidate><input id="gv-ft" type="text" placeholder="Ticket number, e.g. GRV-2026-0001" autocomplete="off" aria-label="Ticket number">' +
      '<input id="gv-fc" type="text" placeholder="Access code, e.g. ABCD-2345" autocomplete="off" aria-label="Access code">' +
      '<div class="gv-foot" style="margin-top:4px"><button class="btn btn-primary btn-sm" type="submit" id="gv-fgo">Open</button></div></form>';
  }

  function caseView() {
    var c = S.cur.case, m = S.cur.messages, closed = c.status === 'closed';
    var facts = [['Topic', G.categoryLabel(c.category)], ['Sent', when(c.created_at)], ['When it happened', dateOnly(c.incident_date)], ['Where', c.location], ['Involved', c.involved],
      ['Privacy', c.confidentiality === 'anonymous' ? 'Anonymous' : 'Name kept confidential']].filter(function (f) { return f[1]; });
    return '<button class="gv-back" type="button" data-gv="list">' + icon('back') + 'Back</button>' + err() +
      '<div class="gv-head"><h3>' + esc(c.subject) + '</h3>' + chip(c.status) + '</div><div class="gv-tn">' + esc(c.ticket_no) + '</div>' +
      '<dl class="gv-facts">' + facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + '</dl>' +
      '<p class="gv-text">' + esc(c.body) + '</p>' +
      (c.outcome ? '<div class="gv-outcome"><b>Outcome</b>' + esc(c.outcome) + '</div>' : '') +
      '<div class="gv-thread" aria-live="polite">' + (m.length ? m.map(function (x) {
        return '<div class="gv-msg ' + (x.from === 'you' ? 'you' : 'legal') + '"><span class="gv-who">' + (x.from === 'you' ? 'You' : 'Legal Compliance') + '</span>' + esc(x.body) + '<small>' + esc(when(x.created_at)) + '</small></div>';
      }).join('') : '<p class="gv-lead">No replies yet. Legal Compliance will write here.</p>') + '</div>' +
      (closed ? '<p class="gv-lead">This grievance is closed.</p>'
        : '<form class="gv-reply" id="gv-reply" novalidate><label class="sr-only" for="gv-rb">Your message</label><textarea id="gv-rb" maxlength="' + G.LIMITS.message + '" rows="1" placeholder="Add a message…"></textarea>' +
          '<button class="btn btn-primary btn-sm" type="submit" id="gv-rs">Send</button></form>') +
      '<div class="gv-foot"><button class="btn btn-ghost btn-sm" type="button" data-gv="refresh">Refresh</button></div>';
  }

  function render() {
    var v = S.view;
    body.innerHTML = v === 'new' ? newView() : v === 'done' ? doneView() : v === 'find' ? findView() : v === 'case' ? caseView() : listView();
    var f;
    if (v === 'new' && (f = document.getElementById('gv-cat'))) f.focus();
    if (v === 'find' && (f = document.getElementById('gv-ft'))) f.focus();
  }
  function go(view, keepError) { S.view = view; if (!keepError) S.error = ''; render(); panel.scrollIntoView({ block: 'nearest' }); }

  /* ---------- actions ---------- */
  async function load() {
    if (S.loading) return;
    S.loading = true;
    var r = await api('GET', '');
    S.loading = false;
    if (!r.ok || !r.data || !r.data.available) { S.available = false; panel.hidden = true; return; }
    S.available = true;
    S.mine = r.data.mine || [];
    panel.hidden = false;
    if (S.view === 'list') render();
  }
  async function openCase(id) {
    var r = await api('GET', '&id=' + encodeURIComponent(id));
    if (!r.ok) { S.error = r.data.error || "Couldn't open that grievance."; return go('list', true); }
    S.cur = r.data; S.access = { id: id };
    go('case');
  }
  async function reloadCase() {
    var a = S.access || {};
    var r = await api('GET', a.id ? '&id=' + encodeURIComponent(a.id) : '&ticket=' + encodeURIComponent(a.ticket) + '&code=' + encodeURIComponent(a.code));
    if (!r.ok) { S.error = r.data.error || "Couldn't refresh."; return go('case', true); }
    S.cur = r.data; render();
  }
  async function submitNew(e) {
    e.preventDefault();
    var v = function (id) { return document.getElementById(id).value; };
    var who = document.querySelector('input[name="gv-who"]:checked');
    var form = { action: 'submit', category: v('gv-cat'), subject: v('gv-sub').trim(), body: v('gv-body').trim(), incident_date: v('gv-date'), location: v('gv-loc').trim(), involved: v('gv-inv').trim(), anonymous: !!(who && who.value === 'anonymous') };
    var bad = !G.validCategory(form.category) ? 'Choose what it is about.' : !form.subject ? 'Give your grievance a short title.' : !form.body ? 'Describe what happened.' : '';
    if (bad) { S.error = bad; return keepForm(form); }
    var btn = document.getElementById('gv-send');
    btn.disabled = true;
    var r = await api('POST', '', form);
    btn.disabled = false;
    if (!r.ok) { S.error = r.data.error || "Couldn't send that. Try again."; return keepForm(form); }
    S.done = r.data; S.error = '';
    if (!form.anonymous) { var l = await api('GET', ''); if (l.ok && l.data.available) S.mine = l.data.mine || []; }
    go('done');
  }
  function keepForm(f) {   // show the error and put back what was typed
    render();
    var set = function (id, val) { var el = document.getElementById(id); if (el) el.value = val; };
    set('gv-cat', f.category); set('gv-sub', f.subject); set('gv-body', f.body); set('gv-date', f.incident_date); set('gv-loc', f.location); set('gv-inv', f.involved);
    var r = document.querySelector('input[name="gv-who"][value="' + (f.anonymous ? 'anonymous' : 'confidential') + '"]');
    if (r) r.checked = true;
  }
  async function submitFind(e) {
    e.preventDefault();
    var ticket = G.normalizeTicket(document.getElementById('gv-ft').value), code = document.getElementById('gv-fc').value.trim();
    if (!ticket || !code) { S.error = 'Enter both the ticket number and the access code.'; return go('find', true); }
    var r = await api('GET', '&ticket=' + encodeURIComponent(ticket) + '&code=' + encodeURIComponent(code));
    if (!r.ok) { S.error = r.data.error || "Couldn't open that grievance."; return go('find', true); }
    S.cur = r.data; S.access = { ticket: ticket, code: code };
    go('case');
  }
  async function submitReply(e) {
    e.preventDefault();
    var ta = document.getElementById('gv-rb'), text = ta.value.trim();
    if (!text) return;
    var a = S.access || {}, btn = document.getElementById('gv-rs');
    btn.disabled = true;
    var r = await api('POST', '', Object.assign({ action: 'reply', body: text }, a.id ? { id: a.id } : { ticket: a.ticket, code: a.code }));
    btn.disabled = false;
    if (!r.ok) { S.error = r.data.error || "Couldn't send that."; return go('case', true); }
    toast('Message sent.');
    await reloadCase();
  }
  function copy(text, btn) {
    var done = function () { var old = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = old; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast('Press and hold to copy.'); });
    else toast('Press and hold to copy.');
  }

  body.addEventListener('click', function (e) {
    var t = e.target.closest('[data-gv],[data-gv-open],[data-copy]');
    if (!t) return;
    if (t.hasAttribute('data-copy')) return copy(t.getAttribute('data-copy'), t);
    if (t.hasAttribute('data-gv-open')) return openCase(t.getAttribute('data-gv-open'));
    var a = t.getAttribute('data-gv');
    if (a === 'refresh') return reloadCase();
    if (a === 'list') { load(); return go('list'); }
    go(a);
  });
  body.addEventListener('submit', function (e) {
    if (e.target.id === 'gv-form') submitNew(e);
    else if (e.target.id === 'gv-find') submitFind(e);
    else if (e.target.id === 'gv-reply') submitReply(e);
  });

  /* The panel follows the sign-in: shown (once the SQL is in) when someone is signed in, emptied when they sign out. */
  var top = document.getElementById('top-right');
  function sync() {
    if (top && !top.hidden) load();
    else { S = { available: false, mine: [], view: 'list', cur: null, access: null, done: null, error: '', loading: false }; panel.hidden = true; body.innerHTML = ''; }
  }
  if (top && window.MutationObserver) new MutationObserver(sync).observe(top, { attributes: true, attributeFilter: ['hidden'] });
  sync();
})();
