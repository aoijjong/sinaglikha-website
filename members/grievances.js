/*
  SINAGLIKHA Grievances: the inbox, case screen, statistics and settings, for Legal Compliance Senior Managers and the Administrator.
  Employees raise grievances in the Employee Portal (through /api/employee-evaluate?gr=1). Here a handler reads them, takes a case,
  replies to the employee, keeps private notes, changes the status and closes it with an outcome, opens attached files, or steps away
  from a case they have a conflict of interest in. The Administrator also sets the time limits and the retention period.
  Everything goes through the database functions in supabase/grievances.sql, which check who may do what, hide who raised a
  confidential grievance until "Reveal" (each reveal is logged), respect who a case is routed to, and write the trail.
  This screen only shows what they allow. An anonymous grievance has no name to reveal, and its times are rounded to the day,
  so only the day is shown for it.
  Opened from the Grievances card on the Legal Compliance page of the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp, M = window.SngGrievance;
  if (!app || !M) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask;
  var I = window.SngIcon, IB = window.SngIconButton;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var G = { box: null, ctx: null, view: 'list', filter: 'attention', rows: [], cur: null, who: null, error: '', token: 0, stats: null, settings: null, preview: null };

  function canHandle() { return state.isAdmin || (state.profile && state.profile.department === 'legal'); }
  function chip(status) { return '<span class="gv-chip gv-' + M.statusTone(status) + '">' + esc(M.statusLabel(status)) + '</span>'; }
  function soft(text, title) { return '<span class="gv-chip gv-soft"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>'; }
  function alert(text, title) { return '<span class="gv-chip gv-alert"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>'; }
  function empty(icon, title, text) { return '<div class="es"><span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p></div>'; }
  function day(iso) {
    var t = new Date(iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' });
  }
  function isoDay(iso) {
    var t = new Date(iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
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
  function fail(r) { toast(problem(r) === 'notset' ? 'Grievances are not set up yet.' : problem(r), 'bad'); }
  var ROUTE = { admin_only: ['Administrator only', 'This case involves someone in Legal Compliance, so only the Administrator can see it.'],
                legal_only: ['Legal Compliance only', 'This case involves the Administrator, so only Legal Compliance can see it.'] };

  /* ---------- the inbox ---------- */
  function needs(g) { return g.status !== 'closed' && (g.status === 'submitted' || g.last_from === 'employee'); }
  var FILTERS = [
    ['attention', 'Needs attention', needs],
    ['overdue', 'Overdue', function (g) { return !!g.overdue; }],
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
    G.view = 'list';
    renderList();
  }

  function header(title, sub, backAct, backLabel, actions) {
    return '<div class="ph">' + IB('back', backLabel, { 'data-a': backAct }, 'line') + '<div class="ph-main"><h2>' + esc(title) + '</h2>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>' +
      (actions ? '<div class="ph-actions">' + actions + '</div>' : '') + '</div>';
  }
  function views() {
    var v = [['list', 'Inbox'], ['stats', 'Statistics']];
    if (state.isAdmin) v.push(['settings', 'Settings']);
    return '<div class="pills" role="group" aria-label="Section">' + v.map(function (x) {
      return '<button class="pill" type="button" data-view="' + x[0] + '" aria-pressed="' + (G.view === x[0]) + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
  }
  function notSet() {
    return '<div class="list-card">' + (G.error === 'notset'
      ? empty('scale', 'Not set up yet', 'Run supabase/grievances.sql in the Supabase SQL editor, then reload this page.')
      : empty('lock', 'Cannot open grievances', esc(G.error))) + '</div>';
  }

  function renderList() {
    var head = header('Grievances', 'Legal Compliance', 'back', 'Back to the deliverables', G.error ? '' : IB('download', 'Export this list as a CSV file (no names, no text)', { 'data-a': 'csv' }, 'line'));
    if (G.error) { G.box.innerHTML = head + notSet(); return; }
    var pills = FILTERS.map(function (f) {
      var n = G.rows.filter(f[2]).length;
      return '<button class="pill" type="button" data-filter="' + f[0] + '" aria-pressed="' + (G.filter === f[0]) + '">' + esc(f[1]) + (f[0] !== 'all' && n ? ' ' + n : '') + '</button>';
    }).join('');
    var rows = filtered();
    G.box.innerHTML = head + views() + '<div class="pills" role="group" aria-label="Show">' + pills + '</div><div class="list-card">' + (rows.length ? '<ul class="rows">' + rows.map(function (g) {
      var anon = g.confidentiality === 'anonymous';
      var meta = [M.categoryLabel(g.category), anon ? 'Anonymous' : 'Confidential', 'Sent ' + when(g.created_at, anon), g.assigned_name ? 'With ' + g.assigned_name : 'Unassigned'].join(' · ');
      return '<li class="lrow" data-id="' + esc(g.id) + '"><button class="lmain" type="button" data-a="view"><span class="lico">' + I('scale') + '</span>' +
        '<span class="ltext"><span class="lname">' + esc(g.ticket_no) + ' · ' + esc(g.subject) + '</span><span class="lmeta">' + esc(meta) + '</span></span></button>' +
        '<div class="lside">' + (g.overdue ? alert('Overdue', g.overdue) : '') + (ROUTE[g.routing] ? soft(ROUTE[g.routing][0], ROUTE[g.routing][1]) : '') +
        (g.file_count ? soft(g.file_count + (g.file_count === 1 ? ' file' : ' files')) : '') +
        (g.last_from === 'employee' && g.status !== 'closed' ? soft('Awaiting reply') : '') + chip(g.status) + '</div></li>';
    }).join('') + '</ul>' : empty('inbox', G.filter === 'attention' ? 'Nothing needs attention' : 'No grievances here', G.filter === 'attention' ? 'New grievances and replies from employees will appear here.' : 'Nothing matches this view.')) + '</div>';
  }

  /* A spreadsheet of the list: tickets and dates only. Never a name, a subject or any text, so it is safe to share. */
  function csvCell(v) {
    var s = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // a spreadsheet must not treat text as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv(rows) {
    var head = ['Ticket', 'Topic', 'Privacy', 'Status', 'Who can see it', 'Assigned to', 'Sent', 'Last activity', 'Overdue', 'Files'];
    var lines = [head].concat(rows.map(function (g) {
      return [g.ticket_no, M.categoryLabel(g.category), g.confidentiality === 'anonymous' ? 'Anonymous' : 'Confidential', M.statusLabel(g.status),
        ROUTE[g.routing] ? ROUTE[g.routing][0] : 'Legal Compliance and the Administrator', g.assigned_name || '', isoDay(g.created_at), isoDay(g.updated_at), g.overdue || '', g.file_count || 0];
    }));
    return lines.map(function (l) { return l.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function downloadCsv() {
    var rows = filtered();
    if (!rows.length) { toast('Nothing to export in this view.', 'bad'); return; }
    var blob = new Blob(['﻿' + buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'grievances-' + isoDay(new Date().toISOString()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Exported ' + rows.length + (rows.length === 1 ? ' case' : ' cases') + '. No names or text are in the file.', 'ok');
  }

  /* ---------- statistics ---------- */
  async function openStats() {
    G.view = 'stats';
    G.box.innerHTML = header('Grievances', 'Statistics', 'list-back', 'Back to the grievances') + views() + '<p class="fine">Loading…</p>';
    var s = await sb.rpc('grievance_stats'), t = await sb.rpc('grievance_get_settings');
    if (G.view !== 'stats') return;
    if (s.error) { G.error = problem(s); G.box.innerHTML = header('Grievances', 'Statistics', 'list-back', 'Back to the grievances') + notSet(); return; }
    G.stats = s.data; G.settings = t.error ? null : t.data;
    renderStats();
  }
  function bars(title, pairs, label) {
    var max = Math.max.apply(null, pairs.map(function (p) { return p[1]; }).concat([1]));
    return '<div class="gvm-card"><h3>' + esc(title) + '</h3>' + (pairs.length ? pairs.map(function (p) {
      return '<div class="gvm-barrow"><span class="gvm-bl">' + esc(label ? label(p[0]) : p[0]) + '</span><span class="gvm-bar" aria-hidden="true"><span style="width:' + Math.round(100 * Number(p[1]) / max) + '%"></span></span><b>' + Number(p[1]) + '</b></div>';
    }).join('') : '<p class="fine">Nothing yet.</p>') + '</div>';
  }
  function renderStats() {
    var s = G.stats, st = G.settings;
    var num = function (label, v) { return '<div class="gvm-num"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>'; };
    var pairs = function (o) { return Object.keys(o || {}).map(function (k) { return [k, Number(o[k])]; }).sort(function (a, b) { return b[1] - a[1]; }); };
    G.box.innerHTML = header('Grievances', 'Statistics', 'list-back', 'Back to the grievances') + views() +
      '<div class="gvm-nums">' + num('Total', s.total) + num('Open', s.open) + num('Overdue', s.overdue) + num('Anonymous', s.anonymous) +
      num('Average days to acknowledge (working days)', s.avg_ack_workdays === null ? '–' : s.avg_ack_workdays) + num('Average days to close', s.avg_days_to_close === null ? '–' : s.avg_days_to_close) + '</div>' +
      bars('By status', M.STATUSES.map(function (x) { return [x.key, Number((s.by_status || {})[x.key] || 0)]; }), M.statusLabel) +
      bars('By topic', pairs(s.by_category), M.categoryLabel) +
      bars('Sent each month (last 12 months)', (s.by_month || []).map(function (m) { return [m.month, m.n]; })) +
      (st ? '<p class="fine">Time limits: acknowledge within ' + esc(st.ack_days) + ' working days, update at least every ' + esc(st.update_days) + ' working days, resolve within ' + esc(st.resolve_days) +
        ' days. ' + (st.retention_months ? 'Closed cases are kept ' + esc(st.retention_months) + ' months.' : 'Closed cases are kept until the Administrator sets a retention period.') +
        ' Public holidays count as working days. These numbers contain no names or text.</p>' : '');
  }

  /* ---------- settings (the Administrator only) ---------- */
  async function openSettings() {
    if (!state.isAdmin) return;
    G.view = 'settings';
    G.box.innerHTML = header('Grievances', 'Settings', 'list-back', 'Back to the grievances') + views() + '<p class="fine">Loading…</p>';
    var t = await sb.rpc('grievance_get_settings'), p = await sb.rpc('grievance_purge_preview');
    if (G.view !== 'settings') return;
    if (t.error) { G.error = problem(t); G.box.innerHTML = header('Grievances', 'Settings', 'list-back', 'Back to the grievances') + notSet(); return; }
    G.settings = t.data; G.preview = p.error ? null : p.data;
    renderSettings();
  }
  function renderSettings() {
    var s = G.settings, p = G.preview, n = p ? Number(p.eligible) : 0;
    var field = function (id, label, val, min, max, hint) {
      return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" type="number" inputmode="numeric" min="' + min + '" max="' + max + '" value="' + esc(val === null || val === undefined ? '' : val) + '"><p class="fine">' + esc(hint) + '</p></div>';
    };
    G.box.innerHTML = header('Grievances', 'Settings', 'list-back', 'Back to the grievances') + views() +
      '<div class="gvm-card"><h3>Time limits</h3><p class="fine">A case is flagged Overdue when one of these is passed. Weekends do not count; public holidays do.</p><form id="gv-set" novalidate>' +
      field('gv-s-ack', 'Acknowledge within (working days)', s.ack_days, 1, 30, 'From when it was sent, until Legal Compliance acknowledges it.') +
      field('gv-s-upd', 'Update at least every (working days)', s.update_days, 1, 60, 'While it is being handled, a reply or status change within this time.') +
      field('gv-s-res', 'Resolution target (days)', s.resolve_days, 1, 365, 'Calendar days from when it was sent.') +
      field('gv-s-ret', 'Keep closed cases for (months)', s.retention_months, 1, 240, 'Leave empty to keep them for ever. Nothing is deleted until you set this AND press "Delete expired cases" below. Ask your counsel or Data Privacy Officer what period is right.') +
      '<p class="msg bad" id="gv-s-err" role="alert" hidden></p><button class="btn btn-primary btn-sm" type="submit">Save settings</button></form></div>' +
      '<div class="gvm-card"><h3>Delete expired cases</h3>' + (s.retention_months
        ? '<p>' + esc(n) + (n === 1 ? ' closed case is' : ' closed cases are') + ' older than ' + esc(s.retention_months) + ' months.</p>' +
          '<p class="fine">Deleting removes the case, its messages and its files for good. It is written to the activity log as a count, with no names.</p>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-a="purge"' + (n ? '' : ' disabled') + '>Delete expired cases</button>'
        : '<p class="fine">No retention period is set, so nothing can be deleted.</p>') + '</div>' +
      '<div class="busy" id="gv-busy" hidden role="status">Working…</div>';
  }
  async function saveSettings(e) {
    e.preventDefault();
    var v = function (id) { return $(id, G.box).value.trim(); }, err = $('#gv-s-err', G.box);
    var ack = Number(v('#gv-s-ack')), upd = Number(v('#gv-s-upd')), res = Number(v('#gv-s-res')), ret = v('#gv-s-ret') === '' ? null : Number(v('#gv-s-ret'));
    var ok = Number.isInteger(ack) && ack >= 1 && ack <= 30 && Number.isInteger(upd) && upd >= 1 && upd <= 60 && Number.isInteger(res) && res >= 1 && res <= 365 &&
      (ret === null || (Number.isInteger(ret) && ret >= 1 && ret <= 240));
    if (!ok) { err.textContent = 'Use whole numbers: acknowledge 1–30, update 1–60, resolution 1–365, retention 1–240 (or leave retention empty).'; err.hidden = false; return; }
    err.hidden = true;
    busy(true);
    var r = await sb.rpc('grievance_set_settings', { p_ack: ack, p_update: upd, p_resolve: res, p_retention: ret });
    busy(false);
    if (r.error) { fail(r); return; }
    toast('Settings saved.', 'ok');
    openSettings();
  }
  async function purge() {
    var s = G.settings, n = G.preview ? Number(G.preview.eligible) : 0;
    var ok = await ask({ title: 'Delete expired cases?', text: n + (n === 1 ? ' closed case' : ' closed cases') + ' older than ' + s.retention_months + ' months will be deleted for good, with their messages and files. This cannot be undone.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy(true);
    var r = await sb.rpc('grievance_purge');
    if (r.error) { busy(false); fail(r); return; }
    var paths = (r.data && r.data.paths) || [], left = 0;
    for (var i = 0; i < paths.length; i += 100) {
      var rm = await sb.storage.from('grievances').remove(paths.slice(i, i + 100));
      if (rm.error) left += Math.min(100, paths.length - i);
    }
    busy(false);
    toast(left ? 'Deleted ' + r.data.deleted + ' cases, but ' + left + ' files could not be removed from storage. Run this again.' : 'Deleted ' + (r.data.deleted || 0) + (r.data.deleted === 1 ? ' case.' : ' cases.'), left ? 'bad' : 'ok');
    openSettings();
  }

  /* ---------- one case ---------- */
  async function openCase(id) {
    busy(true);
    var r = await sb.rpc('grievance_open', { p_id: id });
    busy(false);
    if (r.error || !r.data) { fail(r); return; }
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
      ['Assigned to', g.assigned_name || 'Nobody yet'], ['Who can see it', ROUTE[g.routing] ? ROUTE[g.routing][0] : '']].filter(function (f) { return f[1]; });
    var who = anon ? '' : '<dt>Raised by</dt><dd>' + (G.who ? esc(G.who.full_name) + ' (' + esc(G.who.employee_no) + (G.who.job_title ? ', ' + esc(G.who.job_title) : '') + ')'
      : 'Hidden <button class="btn btn-ghost btn-sm" type="button" data-a="reveal" style="margin-left:6px">Reveal</button>') + '</dd>';
    var opts = M.STATUSES.map(function (s) { return '<option value="' + s.key + '"' + (s.key === g.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('');
    var opened = c.events.filter(function (e) { return e.kind === 'open'; }).length;
    var trail = c.events.filter(function (e) { return e.kind !== 'open'; }).map(function (e) {
      var d = e.detail || {}, what = e.kind === 'status' ? 'Status ' + M.statusLabel(d.from) + ' → ' + M.statusLabel(d.to) : e.kind === 'reply' ? 'Replied to the employee' : e.kind === 'note' ? 'Added a private note'
        : e.kind === 'assign' ? 'Took the case' : e.kind === 'reveal' ? 'Revealed who raised it' : e.kind === 'recuse' ? 'Stepped away from the case' : e.kind;
      return '<span>' + esc(when(e.created_at) + ' · ' + (e.actor || 'Someone') + ' · ' + what) + '</span>';
    }).join('');
    var files = c.files || [];
    G.box.innerHTML = header(g.ticket_no, g.subject, 'list-back', 'Back to the grievances') +
      '<div class="gvm-card"><div class="gvm-row"><h3>' + esc(g.subject) + '</h3><span>' + (g.overdue ? alert('Overdue', g.overdue) + ' ' : '') + chip(g.status) + '</span></div>' +
      (g.overdue ? '<p class="fine"><b>' + esc(g.overdue) + '.</b></p>' : '') +
      '<dl class="gvm-facts">' + facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + who + '</dl>' +
      '<p class="gvm-text">' + esc(g.body) + '</p>' + (g.outcome ? '<p class="gvm-text"><b>Outcome:</b> ' + esc(g.outcome) + '</p>' : '') + '</div>' +
      (files.length ? '<div class="gvm-card"><h3>Files from the employee</h3><ul class="gv-files">' + files.map(function (f) {
        return '<li><span class="gv-fn">' + I('file') + esc(f.name) + '</span><span class="gv-fs">' + esc(M.fileSize(f.size)) + '</span><button class="btn btn-ghost btn-sm" type="button" data-a="download" data-file="' + esc(f.id) + '">Download</button></li>';
      }).join('') + '</ul><p class="fine">Files are not scanned. Open them with care.' + (anon ? ' On an anonymous case a file can still carry its author\'s details inside it.' : '') + '</p></div>' : '') +
      '<div class="gvm-card"><h3>Handling</h3><div class="gvm-ctl">' +
      (mine ? '' : '<div><button class="btn btn-ghost btn-sm" type="button" data-a="take">Assign to me</button></div>') +
      '<label class="fine" for="gv-st">Status</label><select id="gv-st">' + opts + '</select>' +
      '<label class="fine" for="gv-out">Outcome (shown to the employee; needed to resolve or close)</label><textarea id="gv-out" maxlength="' + M.LIMITS.outcome + '">' + esc(g.outcome) + '</textarea>' +
      '<div><button class="btn btn-primary btn-sm" type="button" data-a="status">Save status</button></div>' +
      '<div class="gvm-conflict"><button class="btn btn-ghost btn-sm" type="button" data-a="recuse">I have a conflict of interest</button><p class="fine">Use this if the case is about you or someone close to you. You will stop seeing it, and another handler can take it.</p></div></div></div>' +
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
    if (r.error) { fail(r); return false; }
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
    if (r.error) { fail(r); return; }
    G.who = (Array.isArray(r.data) ? r.data[0] : r.data) || null;
    await refreshCase();
  }
  async function recuse() {
    var ok = await ask({ title: 'Step away from this case?', text: 'You will no longer see it, and it will be unassigned from you. Another handler can still take it. This is recorded in the case trail and the activity log.', ok: 'Step away' });
    if (!ok) return;
    busy(true);
    var r = await sb.rpc('grievance_recuse', { p_id: G.cur.grievance.id });
    busy(false);
    if (r.error) { fail(r); return; }
    toast('You stepped away from this case.', 'ok');
    G.cur = null; G.who = null;
    loadList();
  }
  async function download(id) {
    var f = (G.cur.files || []).filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    var r = await sb.storage.from('grievances').createSignedUrl(f.path, 120, { download: f.name });
    if (r.error || !r.data || !r.data.signedUrl) { toast("Couldn't open that file. Try again.", 'bad'); return; }
    var a = document.createElement('a');
    a.href = r.data.signedUrl; a.download = f.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function onClick(e) {
    var v = e.target.closest('[data-view]');
    if (v) { if (v.dataset.view === 'stats') openStats(); else if (v.dataset.view === 'settings') openSettings(); else loadList(); return; }
    var f = e.target.closest('[data-filter]');
    if (f) { G.filter = f.dataset.filter; renderList(); return; }
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a, li = e.target.closest('li.lrow'), id = G.cur && G.cur.grievance.id;
    if (a === 'back') G.ctx.back();
    else if (a === 'list-back') { G.cur = null; G.who = null; loadList(); }
    else if (a === 'csv') downloadCsv();
    else if (a === 'purge') purge();
    else if (a === 'view' && li) openCase(li.dataset.id);
    else if (a === 'reveal') reveal();
    else if (a === 'recuse') recuse();
    else if (a === 'download') download(b.dataset.file);
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
      G.box = box; G.ctx = ctx; G.cur = null; G.who = null; G.filter = 'attention'; G.view = 'list';
      box.onclick = onClick;
      box.onsubmit = function (e) { if (e.target.id === 'gv-set') saveSettings(e); };
      if (!canHandle()) {
        box.innerHTML = header('Grievances', '', 'back', 'Back to the deliverables') +
          '<div class="list-card"><div class="es"><span class="eic">' + I('lock') + '</span><b>Legal Compliance only</b><p>Grievances are handled by Legal Compliance and the Administrator.</p></div></div>';
        return;
      }
      box.innerHTML = '<p class="fine">Loading…</p>';
      return loadList();
    },
    csv: buildCsv,
    /* on sign-out nothing about a case is left on the page */
    reset: function () { G.cur = null; G.who = null; G.rows = []; G.stats = null; G.settings = null; G.preview = null; G.error = ''; if (G.box) G.box.innerHTML = ''; }
  };
})();
