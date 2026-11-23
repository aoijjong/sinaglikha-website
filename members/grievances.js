/*
  SINAGLIKHA Grievances: the inbox and case screen, for Legal Compliance Senior Managers and the Administrator.
  Employees raise grievances in the Employee Portal (through /api/employee-evaluate?gr=1). Here a handler reads them,
  takes a case, replies to the employee, keeps private notes, changes the status and closes it with an outcome.
  Everything goes through the database functions in supabase/grievances.sql, which check who may do what, hide who raised
  a confidential grievance until "Reveal" (each reveal is logged), and write the trail. This screen only shows what they allow.
  An anonymous grievance has no name to reveal, and its times are rounded to the day, so only the day is shown for it.
  Opened from the Grievances card on the Legal Compliance page of the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp, M = window.SngGrievance;
  if (!app || !M) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask;
  var I = window.SngIcon, IB = window.SngIconButton;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var G = { box: null, ctx: null, view: 'list', filter: 'attention', rows: [], cur: null, who: null, error: '', token: 0 };

  function canHandle() { return state.isAdmin || (state.profile && state.profile.department === 'legal'); }
  function chip(status) { return '<span class="gv-chip gv-' + M.statusTone(status) + '">' + esc(M.statusLabel(status)) + '</span>'; }
  function soft(text, title) { return '<span class="gv-chip gv-soft"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>'; }
  function empty(icon, title, text) { return '<div class="es"><span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p></div>'; }
  function day(iso) {
    var t = new Date(iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' });
  }
  /* exact time, except for the employee's side of an anonymous case, which is only known to the day */
  function when(iso, dayOnly) {
    if (dayOnly) return day(iso);
    return window.SngCommentTime ? window.SngCommentTime.stamp(iso) : app.fmtDate(iso);
  }
  function busy(on) { var b = $('#gv-busy', G.box); if (b) b.hidden = !on; }
  function problem(r) {
    var m = (r.error && r.error.message) || '';
    return /Could not find|schema cache|does not exist/i.test(m) ? 'notset' : m || "That didn't work. Try again.";
  }

  /* ---------- the inbox ---------- */
  function needs(g) { return g.status !== 'closed' && (g.status === 'submitted' || g.last_from === 'employee'); }
  var FILTERS = [
    ['attention', 'Needs attention', needs],
    ['open', 'Open', function (g) { return g.status !== 'closed'; }],
    ['closed', 'Closed', function (g) { return g.status === 'closed'; }],
    ['all', 'All', function () { return true; }]
  ];
  function filtered() { var f = FILTERS.filter(function (x) { return x[0] === G.filter; })[0]; return G.rows.filter(f[2]); }

  async function loadList() {
    var token = ++G.token;
    var r = await sb.rpc('grievance_list');
    if (token !== G.token) return;
    if (r.error) { G.rows = []; G.error = problem(r); }
    else { G.rows = Array.isArray(r.data) ? r.data : []; G.error = ''; }
    renderList();
  }

  function header(title, sub, backAct, backLabel) {
    return '<div class="ph">' + IB('back', backLabel, { 'data-a': backAct }, 'line') + '<div class="ph-main"><h2>' + esc(title) + '</h2>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div></div>';
  }
  function renderList() {
    G.view = 'list';
    var head = header('Grievances', 'Legal Compliance', 'back', 'Back to the deliverables');
    if (G.error) {
      G.box.innerHTML = head + '<div class="list-card">' + (G.error === 'notset'
        ? empty('scale', 'Not set up yet', 'Run supabase/grievances.sql in the Supabase SQL editor, then reload this page.')
        : empty('lock', 'Cannot open grievances', esc(G.error))) + '</div>';
      return;
    }
    var pills = FILTERS.map(function (f) {
      var n = G.rows.filter(f[2]).length;
      return '<button class="pill" type="button" data-filter="' + f[0] + '" aria-pressed="' + (G.filter === f[0]) + '">' + esc(f[1]) + (f[0] !== 'all' && n ? ' ' + n : '') + '</button>';
    }).join('');
    var rows = filtered();
    G.box.innerHTML = head + '<div class="pills" role="group" aria-label="Show">' + pills + '</div><div class="list-card">' + (rows.length ? '<ul class="rows">' + rows.map(function (g) {
      var meta = [M.categoryLabel(g.category), g.confidentiality === 'anonymous' ? 'Anonymous' : 'Confidential', 'Sent ' + when(g.created_at, g.confidentiality === 'anonymous'),
        g.assigned_name ? 'With ' + g.assigned_name : 'Unassigned'].join(' · ');
      return '<li class="lrow" data-id="' + esc(g.id) + '"><button class="lmain" type="button" data-a="view"><span class="lico">' + I('scale') + '</span>' +
        '<span class="ltext"><span class="lname">' + esc(g.ticket_no) + ' · ' + esc(g.subject) + '</span><span class="lmeta">' + esc(meta) + '</span></span></button>' +
        '<div class="lside">' + (g.last_from === 'employee' && g.status !== 'closed' ? soft('Awaiting reply') : '') + chip(g.status) + '</div></li>';
    }).join('') + '</ul>' : empty('inbox', G.filter === 'attention' ? 'Nothing needs attention' : 'No grievances here', G.filter === 'attention' ? 'New grievances and replies from employees will appear here.' : 'Nothing matches this view.')) + '</div>';
  }

  /* ---------- one case ---------- */
  async function openCase(id) {
    busy(true);
    var r = await sb.rpc('grievance_open', { p_id: id });
    busy(false);
    if (r.error || !r.data) { toast(problem(r) === 'notset' ? 'Grievances are not set up yet.' : problem(r), 'bad'); return; }
    G.cur = r.data; G.who = null; G.view = 'case';
    renderCase();
  }
  async function refreshCase() {
    var r = await sb.rpc('grievance_open', { p_id: G.cur.grievance.id });
    if (!r.error && r.data) { G.cur = r.data; renderCase(); }
  }
  function renderCase() {
    var c = G.cur, g = c.grievance, anon = g.confidentiality === 'anonymous', closed = g.status === 'closed';
    var mine = state.profile && g.assigned_to && state.profile.id === g.assigned_to;
    var facts = [['Topic', M.categoryLabel(g.category)], ['Privacy', anon ? 'Anonymous. No name was recorded.' : 'Confidential'], ['Sent', when(g.created_at, anon)],
      ['When it happened', g.incident_date ? day(g.incident_date + 'T00:00:00+08:00') : ''], ['Where', g.location], ['Involved', g.involved],
      ['Assigned to', g.assigned_name || 'Nobody yet']].filter(function (f) { return f[1]; });
    var who = anon ? '' : '<dt>Raised by</dt><dd>' + (G.who ? esc(G.who.full_name) + ' (' + esc(G.who.employee_no) + (G.who.job_title ? ', ' + esc(G.who.job_title) : '') + ')'
      : 'Hidden <button class="btn btn-ghost btn-sm" type="button" data-a="reveal" style="margin-left:6px">Reveal</button>') + '</dd>';
    var opts = M.STATUSES.map(function (s) { return '<option value="' + s.key + '"' + (s.key === g.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('');
    var opened = c.events.filter(function (e) { return e.kind === 'open'; }).length;
    var trail = c.events.filter(function (e) { return e.kind !== 'open'; }).map(function (e) {
      var d = e.detail || {}, what = e.kind === 'status' ? 'Status ' + M.statusLabel(d.from) + ' → ' + M.statusLabel(d.to) : e.kind === 'reply' ? 'Replied to the employee' : e.kind === 'note' ? 'Added a private note'
        : e.kind === 'assign' ? 'Took the case' : e.kind === 'reveal' ? 'Revealed who raised it' : e.kind;
      return '<span>' + esc(when(e.created_at) + ' · ' + (e.actor || 'Someone') + ' · ' + what) + '</span>';
    }).join('');
    G.box.innerHTML = header(g.ticket_no, g.subject, 'list-back', 'Back to the grievances') +
      '<div class="gvm-card"><div class="gvm-row"><h3>' + esc(g.subject) + '</h3>' + chip(g.status) + '</div>' +
      '<dl class="gvm-facts">' + facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + who + '</dl>' +
      '<p class="gvm-text">' + esc(g.body) + '</p>' + (g.outcome ? '<p class="gvm-text"><b>Outcome:</b> ' + esc(g.outcome) + '</p>' : '') + '</div>' +
      '<div class="gvm-card"><h3>Handling</h3><div class="gvm-ctl">' +
      (mine ? '' : '<div><button class="btn btn-ghost btn-sm" type="button" data-a="take">Assign to me</button></div>') +
      '<label class="fine" for="gv-st">Status</label><select id="gv-st">' + opts + '</select>' +
      '<label class="fine" for="gv-out">Outcome (shown to the employee; needed to resolve or close)</label><textarea id="gv-out" maxlength="' + M.LIMITS.outcome + '">' + esc(g.outcome) + '</textarea>' +
      '<div><button class="btn btn-primary btn-sm" type="button" data-a="status">Save status</button></div></div></div>' +
      '<div class="gvm-card"><h3>Messages</h3><div class="gvm-thread">' + (c.messages.length ? c.messages.map(function (m) {
        var label = m.kind === 'employee' ? (anon ? 'Anonymous employee' : 'Employee') : m.kind === 'note' ? 'Private note · ' + (m.author || 'Legal') + ' (the employee cannot see this)' : (m.author || 'Legal Compliance');
        return '<div class="gvm-msg ' + esc(m.kind) + '"><b class="k">' + esc(label) + '</b>' + esc(m.body) + '<small>' + esc(when(m.created_at, anon && m.kind === 'employee')) + '</small></div>';
      }).join('') : '<p class="fine">No messages yet.</p>') + '</div>' +
      (closed ? '<p class="fine">This grievance is closed. Reopen it by changing the status if you need to write again.</p>' : '') +
      '<div class="gvm-ctl"><label class="fine" for="gv-rb">Write to the employee, or keep a private note</label><textarea id="gv-rb" maxlength="' + M.LIMITS.message + '"></textarea>' +
      '<label class="gvm-priv"><input type="checkbox" id="gv-priv"> Private note (only Legal Compliance sees it)</label>' +
      '<div><button class="btn btn-primary btn-sm" type="button" data-a="reply">Send</button></div></div></div>' +
      '<div class="gvm-card"><h3>Case trail</h3><div class="gvm-events">' + (trail || '<span>Nothing yet.</span>') + '<span>Opened ' + opened + (opened === 1 ? ' time' : ' times') + ' by handlers.</span></div></div>' +
      '<div class="busy" id="gv-busy" hidden role="status">Working…</div>';
  }

  async function act(fn, done) {
    busy(true);
    var r = await fn();
    busy(false);
    if (r.error) { toast(problem(r) === 'notset' ? 'Grievances are not set up yet.' : problem(r), 'bad'); return false; }
    if (done) toast(done, 'ok');
    await refreshCase();
    return true;
  }
  async function reveal() {
    var ok = await ask({ title: 'Reveal who raised this?', text: 'You will see their name. This is recorded in the activity log with your name, and the employee was told only Legal Compliance would see it.', ok: 'Reveal' });
    if (!ok) return;
    busy(true);
    var r = await sb.rpc('grievance_reveal', { p_id: G.cur.grievance.id });
    busy(false);
    if (r.error) { toast(problem(r), 'bad'); return; }
    G.who = (Array.isArray(r.data) ? r.data[0] : r.data) || null;
    await refreshCase();
  }

  function onClick(e) {
    var f = e.target.closest('[data-filter]');
    if (f) { G.filter = f.dataset.filter; renderList(); return; }
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a, li = e.target.closest('li.lrow'), id = G.cur && G.cur.grievance.id;
    if (a === 'back') G.ctx.back();
    else if (a === 'list-back') { G.cur = null; G.who = null; loadList(); }
    else if (a === 'view' && li) openCase(li.dataset.id);
    else if (a === 'reveal') reveal();
    else if (a === 'take') act(function () { return sb.rpc('grievance_take', { p_id: id }); }, 'This case is now with you.');
    else if (a === 'status') {
      var st = $('#gv-st', G.box).value, out = $('#gv-out', G.box).value.trim();
      act(function () { return sb.rpc('grievance_set_status', { p_id: id, p_status: st, p_outcome: out || null }); }, 'Status saved.');
    } else if (a === 'reply') {
      var ta = $('#gv-rb', G.box), text = ta.value.trim(), priv = $('#gv-priv', G.box).checked;
      if (!text) { toast('Write a message first.', 'bad'); return; }
      act(function () { return sb.rpc('grievance_reply', { p_id: id, p_body: text, p_private: priv }); }, priv ? 'Private note saved.' : 'Sent to the employee.');
    }
  }

  window.MembersGrievances = {
    open: function (box, ctx) {
      G.box = box; G.ctx = ctx; G.cur = null; G.who = null; G.filter = 'attention';
      box.onclick = onClick;
      if (!canHandle()) {
        box.innerHTML = header('Grievances', '', 'back', 'Back to the deliverables') +
          '<div class="list-card"><div class="es"><span class="eic">' + I('lock') + '</span><b>Legal Compliance only</b><p>Grievances are handled by Legal Compliance and the Administrator.</p></div></div>';
        return;
      }
      box.innerHTML = '<p class="fine">Loading…</p>';
      return loadList();
    },
    /* on sign-out nothing about a case is left on the page */
    reset: function () { G.cur = null; G.who = null; G.rows = []; G.error = ''; if (G.box) G.box.innerHTML = ''; }
  };
})();
