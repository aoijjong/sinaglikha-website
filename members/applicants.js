/*
  SINAGLIKHA Applicant Tracking System: where the recruitment team follows each applicant from the first
  application to placement. Applications are NOT made on this website: applicants use the QR code on the
  vacancy poster, which goes to the application form kept outside the site. Applicants reach this screen
  by CSV import (for example the responses exported from that form) or by being typed in. Nothing here is
  synchronised automatically.
  The summary numbers are counted from the stored applicants. A status changes only through the database
  function applicant_set_status(), which also writes the history entry; notes go through
  applicant_add_note(). The rules in supabase/recruitment.sql allow only the Administrator and the Staffing
  and Recruitment Senior Manager to read or change any of it; this screen only shows what those rules allow.
  Opened from the Applicant Tracking System row of the Staffing panel in the Content tab (the Recruitment card above it only shows the numbers).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var STATUSES = [['new', 'New'], ['screening', 'Screening'], ['shortlisted', 'Shortlisted'], ['interview', 'Interview'], ['work_sample', 'Work sample'],
    ['final_review', 'Final review'], ['selected', 'Selected'], ['not_selected', 'Not selected'], ['placed', 'Placed'], ['withdrawn', 'Withdrawn']];
  var LABEL = {}, KEYS = [];
  STATUSES.forEach(function (s) { LABEL[s[0]] = s[1]; KEYS.push(s[0]); });
  var CHIP = { new: 't-working', screening: 's-draft', shortlisted: 's-draft', interview: 's-draft', work_sample: 's-draft', final_review: 's-draft', selected: 's-published', not_selected: 'is-red', placed: 's-published', withdrawn: 's-archived' };
  // the summary groups the stages, so the screen stays calm; every single stage is still in the Stage filter
  var GROUPS = {
    new: ['new'],
    active: ['screening', 'shortlisted', 'interview', 'work_sample', 'final_review'],
    won: ['selected', 'placed'],
    closed: ['not_selected', 'withdrawn']
  };
  var GROUP_LABEL = { all: 'All stages', new: 'New', active: 'In progress (5 stages)', won: 'Selected or placed', closed: 'Not selected or withdrawn' };
  function inGroup(status, key) { return key === 'all' || (GROUPS[key] ? GROUPS[key].indexOf(status) !== -1 : status === key); }
  var PAGE = 100;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var A = { menuBtn: null, box: null, ctx: null, rows: [], vacancies: [], failed: false, q: '', status: 'all', pos: '', from: '', to: '', shown: PAGE, open: null, importing: null, fOpen: false };

  function canManage() { return state.isAdmin || (state.profile && state.profile.department === 'staffing'); }
  function busy(text) {
    var b = $('#at-busy', A.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function stamp(iso) {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  /* ---------- the screen ---------- */
  function shell() {
    A.box.style.position = 'relative';
    A.box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Applicant Tracking System</h2><p class="sub">Track each applicant from application to placement: their stage, notes and history</p></div>' +
      '<div class="ph-actions">' +
      IB('fileUp', 'Import applicants from a CSV file', { 'data-a': 'import' }) + IB('userPlus', 'Add an applicant', { 'data-a': 'add' }, 'solid') +
      '<input type="file" id="at-file" accept=".csv,text/csv" hidden></div></div>' +
      '<div class="at-sum" id="at-sum"></div>' +
      '<div class="at-mobile" id="at-mobile"></div>' +
      '<div class="fl-row" id="at-fl"><div class="sbox fl-search">' + I('search') + '<input id="at-q" type="search" placeholder="Search" aria-label="Search by name or reference" autocomplete="off"></div>' +
      '<button class="at-fbtn" type="button" id="at-fbtn" data-a="filters" aria-label="Filters" aria-expanded="false" aria-controls="at-sheet">' + I('sliders') + '</button>' +
      '<select id="at-status" class="fl-pill" aria-label="Filter by stage"></select>' +
      '<div class="fl-sheet" id="at-sheet" role="group" aria-label="Filters"><div class="fl-head"><span class="fl-grab" aria-hidden="true"></span><b>Filters</b></div>' +
      '<span class="fl-lab">Position</span><select id="at-pos" class="fl-pill" aria-label="Filter by position applied for"></select>' +
      '<span class="fl-lab">Date received</span><span class="fl-dates"><label class="fl-date"><span>From</span><input id="at-from" type="date" aria-label="Received from"></label>' +
      '<label class="fl-date"><span>To</span><input id="at-to" type="date" aria-label="Received to"></label></span>' +
      '<div class="fl-actions"><button class="fl-clear" type="button" id="at-clear" data-a="clear" hidden>Clear filters</button><button class="btn btn-primary fl-apply" type="button" id="at-apply" data-a="filters">Show results</button></div></div>' +
      '<div class="fl-back" data-a="filters"></div></div>' +
      '<div class="list-card" id="at-wrap"><div class="at-scroll"><table class="at-tbl"><thead><tr><th>Reference</th><th>Applicant</th><th>Position applied for</th><th>Date received</th><th>Status</th><th>Last updated</th><th class="at-ah">Actions</th></tr></thead><tbody id="at-rows"></tbody></table></div>' +
      '<div class="es" id="at-empty" hidden></div></div>' +
      '<button class="btn btn-ghost btn-sm" type="button" id="at-more" data-a="more" hidden style="margin-top:12px">Show more</button>' +
      '<div class="busy" id="at-busy" hidden role="status">Loading…</div>' +
      '<p class="fine">Only Staffing and Recruitment can see applicant details.</p>';
  }

  async function load() {
    busy('Loading…');
    var res = await Promise.all([
      sb.from('applicants').select('*').order('received_on', { ascending: false }).order('created_at', { ascending: false }).limit(5000),
      sb.from('vacancies').select('id,title').order('title', { ascending: true }).limit(500)
    ]);
    busy('');
    A.failed = !!res[0].error;
    A.rows = res[0].error ? [] : res[0].data || [];
    A.vacancies = res[1].error ? [] : res[1].data || [];
    render();
  }

  // the dashboard on this screen: five panels (total, status, applicants per month, per position, stage by stage); the status and stage panels filter the list
  var DONUT = ['#C8321A', '#E8833A', '#F2B66B', '#8A5A3C', '#D8C3A8'];
  function monthStats() {
    var t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7), out = [], by = {};
    A.rows.forEach(function (a) { var k = String(a.received_on || '').slice(0, 7); by[k] = (by[k] || 0) + 1; });
    for (var i = 5; i >= 0; i--) {
      var d = new Date(Date.UTC(y, m - 1 - i, 1)), k = d.toISOString().slice(0, 7), last = new Date(Date.UTC(y, m - i, 0)).toISOString().slice(0, 10);
      out.push({ label: d.toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' }), n: by[k] || 0, from: k + '-01', to: last });
    }
    return { rows: out, thisMonth: by[t.slice(0, 7)] || 0 };
  }
  function pipeline(counts, act, grp) {
    var total = counts.all, plural = function (n, a, c) { return n === 1 ? a : c; };
    var ms = monthStats(), mmax = 1;
    ms.rows.forEach(function (r) { if (r.n > mmax) mmax = r.n; });
    var p1 = '<section class="sp-p p-month"><h3>Applicants per month</h3><div class="sp-body sp-spread">' + ms.rows.map(function (r) {
      return '<button type="button" class="sp-ml" data-from="' + r.from + '" data-to="' + r.to + '" aria-pressed="' + (A.from === r.from && A.to === r.to) + '" aria-label="' + esc(r.label + ': ' + r.n + (r.n === 1 ? ' applicant' : ' applicants') + '. Show only these') + '"><span>' + esc(r.label) + '</span><span class="sp-t"><i style="width:' + Math.round(r.n / mmax * 100) + '%"></i></span><b>' + r.n + '</b></button>';
    }).join('') + '</div></section>';
    // a few facts that the other panels do not show
    var t0 = Date.parse(today() + 'T00:00:00Z'), dayN = function (s) { return Math.round((t0 - Date.parse(s + 'T00:00:00Z')) / 86400000); };
    var last7 = 0, latest = '', oldestNew = '';
    A.rows.forEach(function (a) {
      var d = String(a.received_on || '').slice(0, 10);
      if (!d) return;
      if (dayN(d) <= 6) last7++;
      if (!latest || d > latest) latest = d;
      if (a.status === 'new' && (!oldestNew || d < oldestNew)) oldestNew = d;
    });
    var wait = oldestNew ? dayN(oldestNew) : -1;
    var fact = function (dot, label, value) { return '<div class="sp-f"><span><i style="background:' + dot + '"></i>' + esc(label) + '</span><b>' + esc(value) + '</b></div>'; };
    var p2 = '<section class="sp-p p-total"><h3>Total</h3><div class="sp-body"><button type="button" class="sp-big" data-status="all" aria-pressed="' + (A.status === 'all') + '" aria-label="' + total + ' applicants in total. Show all"><b>' + total + '</b><span>' + plural(total, 'applicant', 'applicants') + ' in all</span></button>' +
      '<div class="sp-facts">' + fact('#C8321A', 'Received this month', String(ms.thisMonth)) + fact('#E8833A', 'Received in the last 7 days', String(last7)) +
      fact('#E0A21B', 'Longest wait in New', wait < 0 ? 'None waiting' : wait === 0 ? 'Today' : plural(wait, '1 day', wait + ' days')) +
      fact('#8A5A3C', 'Latest application', latest ? app.fmtDate(latest) : 'None yet') + '</div></div></section>';
    var tile = function (key, n, label, color, icon) {
      return '<button type="button" class="sp-k k-' + key + '" data-status="' + key + '" style="--c:' + color + '" aria-pressed="' + (A.status === key) + '" aria-label="' + esc(label + ': ' + n + '. Show only these') + '">' +
        '<span class="sp-kic" aria-hidden="true">' + I(icon) + '</span><b>' + n + '</b><span>' + esc(label) + '</span><small class="sp-pc">' + (total ? Math.round(n / total * 100) : 0) + '% of all</small></button>';
    };
    var p3 = '<section class="sp-p p-status"><h3>Application status <small>Select one to filter</small></h3><div class="sp-body sp-mid"><div class="sp-ks">' +
      tile('new', grp.new, 'New', '#E0A21B', 'inbox') + tile('active', grp.active, 'In progress', '#378ADD', 'clock') + tile('won', grp.won, 'Selected or placed', '#3E9A4D', 'checkCircle') + tile('closed', grp.closed, 'Closed', '#8F7F73', 'archive') + '</div></div></section>';
    var byPos = {};
    A.rows.forEach(function (a) { var k = a.position_title || 'Not stated'; byPos[k] = (byPos[k] || 0) + 1; });
    var pos = Object.keys(byPos).sort(function (x, y) { return byPos[y] - byPos[x] || x.localeCompare(y); });
    var shown = pos.length <= 5 ? pos : pos.slice(0, 4), rest = pos.length <= 5 ? 0 : pos.slice(4).reduce(function (n, k) { return n + byPos[k]; }, 0);
    var items = shown.map(function (k, i) { return { name: k, n: byPos[k], color: DONUT[i], pick: k }; });
    if (rest) items.push({ name: 'Other positions', n: rest, color: DONUT[4], pick: '' });
    var acc = 0, stops = items.map(function (it) { var from = acc / (total || 1) * 100; acc += it.n; return it.color + ' ' + from + '% ' + acc / (total || 1) * 100 + '%'; }).join(',');
    var p4 = '<section class="sp-p p-pos"><h3>Applicants per position</h3><div class="sp-body sp-mid">' + (total ? '<div class="sp-dn"><div class="sp-ring" style="background:conic-gradient(' + stops + ')" role="img" aria-label="Applicants per position"><span>' + total + '</span></div><ul class="sp-lg">' +
      items.map(function (it) {
        var inner = '<i style="background:' + it.color + '"></i><span class="sp-ln2">' + esc(it.name) + '</span><b>' + it.n + '</b>';
        return '<li>' + (it.pick ? '<button type="button" data-pos="' + esc(it.pick) + '" aria-pressed="' + (A.pos === it.pick) + '">' + inner + '</button>' : '<span class="sp-nb">' + inner + '</span>') + '</li>';
      }).join('') + '</ul></div>' : '<p class="sp-sm">No applicants yet.</p>') + '</div></section>';
    var smax = 1;
    SngStageChart.stages.forEach(function (s) { if ((counts[s[0]] || 0) > smax) smax = counts[s[0]]; });
    var p5 = '<section class="sp-p p-stage"><h3>Stage by stage</h3><div class="sp-body sp-spread">' + SngStageChart.stages.map(function (s) {
      var n = counts[s[0]] || 0;
      return '<button type="button" class="sp-st" data-status="' + s[0] + '" style="--c:' + s[2] + '" aria-pressed="' + (act.indexOf(s[0]) !== -1) + '" aria-label="' + esc(s[1] + ': ' + n + '. Show only these') + '"><span>' + esc(s[1]) + '</span><span class="sp-t"><i style="width:' + (n ? Math.max(4, Math.round(n / smax * 100)) : 0) + '%;background:' + s[2] + '"></i></span><b>' + n + '</b></button>';
    }).join('') + '</div></section>';
    return '<div class="sp' + (A.moreOpen ? ' sp-open' : '') + '">' + p2 + p3 + p1 + p4 + p5 +
      '<button type="button" class="sp-moreb" data-a="morecharts" aria-expanded="' + !!A.moreOpen + '">' + (A.moreOpen ? 'Show fewer charts' : 'Show more charts') + '</button></div>';
  }

  // on a phone the list is far below the dashboard, so choosing a filter there brings the list into view
  function toList() {
    if (!window.matchMedia || !window.matchMedia('(max-width:640px)').matches) return;
    var w = $('#at-wrap', A.box);
    if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render() {
    var counts = { all: A.rows.length };
    KEYS.forEach(function (k) { counts[k] = 0; });
    A.rows.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    var grp = {};
    Object.keys(GROUPS).forEach(function (g) { grp[g] = GROUPS[g].reduce(function (n, k) { return n + (counts[k] || 0); }, 0); });
    var act = A.status === 'all' ? [] : (GROUPS[A.status] || [A.status]);
    $('#at-sum', A.box).innerHTML = pipeline(counts, act, grp);
    // phones: one sliding row of stage pills and a Filters button; the summary above is hidden there
    var pill = function (key, label) { return '<button class="pill" type="button" data-status="' + key + '" aria-pressed="' + (A.status === key) + '">' + label + ' <small>' + (key === 'all' ? counts.all : grp[key]) + '</small></button>'; };
    var extra = A.status !== 'all' && ['new', 'active', 'won', 'closed'].indexOf(A.status) === -1;     // one single stage is chosen
    var activeFilters = !!(A.pos || A.from || A.to || extra);
    var fb = $('#at-fbtn', A.box);
    fb.classList.toggle('has', activeFilters);
    fb.setAttribute('aria-expanded', String(A.fOpen));
    $('#at-mobile', A.box).innerHTML = pill('all', 'All') + pill('new', 'New') + pill('active', 'In progress') + pill('won', 'Selected or placed') + pill('closed', 'Closed');
    closeMenu(false);
    $('#at-fl', A.box).classList.toggle('open', A.fOpen);
    var positions = {};
    A.rows.forEach(function (a) { if (a.position_title) positions[a.position_title] = true; });
    $('#at-pos', A.box).innerHTML = '<option value="">Any position</option>' + Object.keys(positions).sort().map(function (p) { return '<option value="' + esc(p) + '"' + (A.pos === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('');
    // the same ten stages, with the same names, as the status in each row; a summary group (In progress and so on) shows up only while one is chosen
    var groupOn = ['active', 'won', 'closed'].indexOf(A.status) !== -1;
    $('#at-status', A.box).innerHTML = '<option value="all"' + (A.status === 'all' ? ' selected' : '') + '>All stages</option>' +
      (groupOn ? '<option value="' + A.status + '" selected>' + esc(GROUP_LABEL[A.status]) + '</option>' : '') +
      STATUSES.map(function (s) { return '<option value="' + s[0] + '"' + (A.status === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('');
    $('#at-clear', A.box).hidden = !(A.status !== 'all' || A.pos || A.from || A.to);
    $('#at-from', A.box).value = A.from;
    $('#at-to', A.box).value = A.to;
    var q = A.q.trim().toLowerCase();
    var list = A.rows.filter(function (a) {
      if (!inGroup(a.status, A.status)) return false;
      if (A.pos && a.position_title !== A.pos) return false;
      if (A.from && a.received_on < A.from) return false;
      if (A.to && a.received_on > A.to) return false;
      return !q || (a.full_name + ' ' + a.reference + ' ' + a.position_title).toLowerCase().indexOf(q) !== -1;
    });
    var show = list.slice(0, A.shown);
    $('#at-apply', A.box).textContent = list.length === 1 ? 'Show 1 result' : 'Show ' + list.length + ' results';
    $('#at-rows', A.box).innerHTML = show.map(function (a) {
      return '<tr data-id="' + esc(a.id) + '"><td data-l="Reference">' + esc(a.reference || '') + '</td>' +
        '<td data-l="Applicant"><button class="at-name" type="button" data-a="open" title="Open the record">' + esc(a.full_name) + '</button></td>' +
        '<td data-l="Position">' + esc(a.position_title || 'Not stated') + '</td>' +
        '<td data-l="Received">' + esc(app.fmtDate(a.received_on)) + '</td>' +
        '<td data-l="Status"><button type="button" class="at-sttag chip ' + (CHIP[a.status] || '') + '" data-stfor="' + esc(a.id) + '" aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(a.full_name) + ': ' + esc(LABEL[a.status] || a.status) + '. Change status">' +
        '<span class="at-sttx">' + esc(LABEL[a.status] || a.status) + '</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></td>' +
        '<td data-l="Updated">' + esc(app.fmtDate(a.updated_at)) + '</td>' +
        '<td data-l="Actions" class="at-acts">' + IB('more', 'Actions for ' + a.full_name, { 'data-a': 'amenu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }) + '</td></tr>';
    }).join('');
    $('#at-more', A.box).hidden = list.length <= A.shown;
    $('#at-more', A.box).textContent = 'Show more (' + (list.length - A.shown) + ' left)';
    $('.at-scroll', A.box).hidden = !show.length;
    var empty = $('#at-empty', A.box);
    if (A.failed) {
      empty.innerHTML = '<span class="eic">' + I('lock') + '</span><b>Not set up yet</b><p>Run supabase/recruitment.sql in the Supabase SQL editor, then reload this page.</p>';
      empty.hidden = false;
    } else if (!A.rows.length) {
      empty.innerHTML = '<span class="eic">' + I('inbox') + '</span><b>No applicants yet</b><p>Tap ' + I('fileUp', 'inline') + ' to import a CSV file of applicants, or ' + I('userPlus', 'inline') + ' to add one by hand. Applicants are never made up.</p>';
      empty.hidden = false;
    } else if (!list.length) {
      empty.innerHTML = '<span class="eic">' + I('search') + '</span><b>No matches</b><p>Clear a filter or the search to see everyone.</p>';
      empty.hidden = false;
    } else empty.hidden = true;
  }

  /* ---------- one applicant ---------- */
  function options(selected) {
    return STATUSES.map(function (s) { return '<option value="' + s[0] + '"' + (selected === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('');
  }
  function positionList() {
    var names = {};
    A.vacancies.forEach(function (v) { names[v.title] = true; });
    A.rows.forEach(function (a) { if (a.position_title) names[a.position_title] = true; });
    return '<datalist id="at-positions">' + Object.keys(names).sort().map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>';
  }
  function vacancyFor(title) {
    var t = norm(title);
    var v = t && A.vacancies.filter(function (x) { return norm(x.title) === t; })[0];
    return v ? v.id : null;
  }

  async function openDetail(id) {
    var a = A.rows.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    A.open = a;
    var dlg = $('#ap-dlg');
    $('#ap-body').innerHTML = '<p class="fine" style="padding:24px">Loading…</p>';
    if (!dlg.open) dlg.showModal();
    var res = await sb.from('applicant_events').select('*').eq('applicant_id', id).order('created_at', { ascending: false }).limit(300);
    if (A.open !== a) return;
    var events = res.error ? [] : res.data || [];
    $('#ap-body').innerHTML =
      '<div class="ap-head"><div><h2>' + esc(a.full_name) + '</h2><p>' + esc([a.reference, a.position_title || 'Position not stated', 'Received ' + app.fmtDate(a.received_on)].filter(Boolean).join(' · ')) + '</p></div>' +
      '<span class="chip ' + (CHIP[a.status] || '') + '">' + esc(LABEL[a.status] || a.status) + '</span></div>' +
      '<div class="ap-sec"><h3>Recruitment status</h3><div class="ap-row"><select id="ap-status" aria-label="New status">' + options(a.status) + '</select>' +
      '<button class="btn btn-primary btn-sm" type="button" data-ap="status">Update status</button></div>' +
      '<input id="ap-snote" type="text" maxlength="300" placeholder="Remark with this change (optional)" autocomplete="off"></div>' +
      '<div class="ap-sec"><h3>Details</h3><div class="ap-grid"><label>Name<input id="ap-name" type="text" maxlength="120" value="' + esc(a.full_name) + '" autocomplete="off"></label>' +
      '<label>Position applied for<input id="ap-pos" type="text" maxlength="120" list="at-positions" required value="' + esc(a.position_title) + '" autocomplete="off"></label>' +
      '<label>Date received<input id="ap-date" type="date" value="' + esc(a.received_on) + '"></label></div>' + positionList() +
      '<button class="btn btn-ghost btn-sm" type="button" data-ap="save">Save details</button></div>' +
      '<div class="ap-sec"><h3>Internal notes</h3><textarea id="ap-note" maxlength="2000" rows="3" placeholder="Visible only to Staffing and Recruitment"></textarea>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-ap="note">Add note</button></div>' +
      '<div class="ap-sec"><h3>History</h3><ul class="ap-hist">' + (events.length ? events.map(function (ev) {
        var who = ev.by_name ? ' · ' + esc(ev.by_name) : '';
        var head = ev.kind === 'status' ? 'Status changed: ' + esc(LABEL[ev.from_status] || ev.from_status) + ' to ' + esc(LABEL[ev.to_status] || ev.to_status)
          : ev.kind === 'note' ? 'Note' : 'Added as ' + esc(LABEL[ev.to_status] || ev.to_status);
        return '<li class="ap-' + ev.kind + '"><b>' + head + '</b><small>' + esc(stamp(ev.created_at)) + who + '</small>' + (ev.note ? '<p>' + esc(ev.note) + '</p>' : '') + '</li>';
      }).join('') : '<li><small>No history yet.</small></li>') + '</ul></div>' +
      '<p class="msg bad" id="ap-err" role="alert" hidden></p>' +
      '<div class="actions" style="justify-content:space-between"><button class="btn btn-ghost btn-sm btn-warn" type="button" data-ap="del">Delete applicant</button>' +
      '<button class="btn btn-primary btn-sm" type="button" data-ap="close">Close</button></div>';
  }

  async function rowDelete(id) {
    var a = A.rows.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var ok = await ask({ title: 'Delete This Applicant?', text: a.full_name + ' (' + a.reference + ') and their history and notes will be permanently deleted.', ok: 'Delete', danger: true });
    if (!ok) return;
    var d = await sb.from('applicants').delete().eq('id', a.id).select('id');
    if (d.error || !(d.data || []).length) { toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    logAction('applicant.delete', a.reference, { id: a.id });
    toast('Deleted.', 'ok');
    await load();
  }

  function fail(text) { var e = $('#ap-err'); if (e) { e.textContent = text; e.hidden = false; } }

  async function detailAction(kind) {
    var a = A.open;
    if (!a) return;
    if (kind === 'close') { $('#ap-dlg').close(); return; }
    var err = $('#ap-err');
    err.hidden = true;
    if (kind === 'status') {
      var to = $('#ap-status').value, note = $('#ap-snote').value.trim();
      if (to === a.status) { fail('That is already the current status.'); return; }
      var r = await sb.rpc('applicant_set_status', { p_id: a.id, p_status: to, p_note: note });
      if (r.error) { fail("Couldn't change the status. You may not have permission."); return; }
      logAction('applicant.status', a.reference + ' ' + a.status + ' to ' + to, { id: a.id });
      toast('Status updated.', 'ok');
    } else if (kind === 'note') {
      var text = $('#ap-note').value.trim();
      if (!text) { fail('Write a note first.'); return; }
      var n = await sb.rpc('applicant_add_note', { p_id: a.id, p_note: text });
      if (n.error) { fail("Couldn't save the note. You may not have permission."); return; }
      logAction('applicant.note', a.reference, { id: a.id });
      toast('Note added.', 'ok');
    } else if (kind === 'save') {
      var name = $('#ap-name').value.trim(), pos = $('#ap-pos').value.trim(), date = $('#ap-date').value;
      if (!name) { fail('Enter the applicant\'s name.'); return; }
      if (!pos) { fail('Enter the position applied for.'); return; }
      if (!date) { fail('Enter the date received.'); return; }
      var u = await sb.from('applicants').update({ full_name: name, position_title: pos, vacancy_id: vacancyFor(pos), received_on: date }).eq('id', a.id).select('id').maybeSingle();
      if (u.error || !u.data) { fail("Couldn't save that. You may not have permission."); return; }
      logAction('applicant.edit', a.reference, { id: a.id });
      toast('Saved.', 'ok');
    } else if (kind === 'del') {
      var ok = await ask({ title: 'Delete This Applicant?', text: a.full_name + ' (' + a.reference + ') and their history and notes will be permanently deleted.', ok: 'Delete', danger: true });
      if (!ok) return;
      var d = await sb.from('applicants').delete().eq('id', a.id).select('id');
      if (d.error || !(d.data || []).length) { fail("Couldn't delete that. You may not have permission."); return; }
      logAction('applicant.delete', a.reference, { id: a.id });
      $('#ap-dlg').close();
      toast('Deleted.', 'ok');
      A.open = null;
      await load();
      return;
    }
    await load();
    openDetail(a.id);
  }

  /* ---------- changing a status straight from the table ---------- */
  // the dotted menu on each row: view, add a note, delete (opens downward, like every other menu)
  function closeAMenu(focusBack) {
    var m = A.box && $('#at-amenu', A.box);
    if (!m || m.hidden) return;
    m.hidden = true;
    var bt = A.amBtn;
    A.amBtn = null;
    if (bt) { bt.setAttribute('aria-expanded', 'false'); if (focusBack && document.body.contains(bt)) bt.focus(); }
  }
  function openAMenu(btn) {
    var tr = btn.closest('tr'), a = tr && A.rows.filter(function (x) { return x.id === tr.dataset.id; })[0];
    if (!a) return;
    var m = $('#at-amenu', A.box);
    if (!m) {
      m = document.createElement('ul');
      m.id = 'at-amenu';
      m.className = 'at-menu am';
      m.setAttribute('role', 'menu');
      m.hidden = true;
      A.box.appendChild(m);
    }
    if (!m.hidden && A.amBtn === btn) { closeAMenu(true); return; }
    closeAMenu(false);
    closeMenu(false);
    m.setAttribute('aria-label', 'Actions for ' + a.full_name);
    m.innerHTML = [['view', 'eye', 'View record'], ['note', 'chat', 'Add a note'], ['del', 'trash', 'Delete applicant']].map(function (x) {
      return '<li role="menuitem" tabindex="-1" data-am="' + x[0] + '"' + (x[0] === 'del' ? ' class="danger"' : '') + '>' + I(x[1]) + '<span>' + x[2] + '</span></li>';
    }).join('');
    m.dataset.for = a.id;
    m.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    A.amBtn = btn;
    m.style.maxHeight = '';
    var r = btn.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
    var need = mh + 20;
    if (window.innerHeight - r.bottom < need) { window.scrollBy({ top: need - (window.innerHeight - r.bottom), behavior: 'instant' }); r = btn.getBoundingClientRect(); }
    var below = window.innerHeight - r.bottom - 14;
    if (mh > below) m.style.maxHeight = Math.max(140, below) + 'px';
    m.style.top = Math.max(8, r.bottom + 6) + 'px';
    m.style.left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8) + 'px';
    m.firstChild.focus();
  }
  function chooseAction(kind) {
    var m = $('#at-amenu', A.box), id = m && m.dataset.for;
    closeAMenu(false);
    if (!id) return;
    if (kind === 'view') openDetail(id);
    else if (kind === 'note') openDetail(id).then(function () { var n = $('#ap-note'); if (n) n.focus(); });
    else if (kind === 'del') rowDelete(id);
  }
  function closeMenu(focusBack) {
    var m = A.box && $('#at-menu', A.box);
    if (!m || m.hidden) return;
    m.hidden = true;
    var b = A.menuBtn;
    A.menuBtn = null;
    if (b) { b.setAttribute('aria-expanded', 'false'); if (focusBack && document.body.contains(b)) b.focus(); }
  }
  function openMenu(btn) {
    var a = A.rows.filter(function (x) { return x.id === btn.dataset.stfor; })[0];
    if (!a) return;
    var m = $('#at-menu', A.box);
    if (!m) {
      m = document.createElement('ul');
      m.id = 'at-menu';
      m.className = 'at-menu';
      m.setAttribute('role', 'listbox');
      m.setAttribute('aria-label', 'Choose a status');
      m.hidden = true;
      A.box.appendChild(m);
    }
    if (!m.hidden && A.menuBtn === btn) { closeMenu(true); return; }
    closeAMenu(false);
    closeMenu(false);
    m.innerHTML = STATUSES.map(function (s) {
      var on = a.status === s[0];
      return '<li role="option" tabindex="-1" data-v="' + s[0] + '" aria-selected="' + on + '"><span class="chip ' + (CHIP[s[0]] || '') + '">' + esc(s[1]) + '</span>' +
        (on ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>' : '') + '</li>';
    }).join('');
    m.dataset.for = a.id;
    m.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    A.menuBtn = btn;
    m.style.maxHeight = '';
    var r = btn.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
    // always opens downward: if there is not enough room underneath, the page scrolls a little first
    var need = Math.min(mh, 320) + 20;
    if (window.innerHeight - r.bottom < need) { window.scrollBy({ top: need - (window.innerHeight - r.bottom), behavior: 'instant' }); r = btn.getBoundingClientRect(); }
    var below = window.innerHeight - r.bottom - 14, top = r.bottom + 6;
    if (mh > below) m.style.maxHeight = Math.max(140, below) + 'px';
    m.style.top = Math.max(8, top) + 'px';
    m.style.left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8) + 'px';
    (m.querySelector('[aria-selected="true"]') || m.firstChild).focus();
  }
  function menuKey(e) {
    var am = $('#at-amenu', A.box);
    if (am && !am.hidden && e.target.closest('#at-amenu')) {
      var its = [].slice.call(am.querySelectorAll('li')), k = its.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); its[(k + 1) % its.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); its[(k - 1 + its.length) % its.length].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (its[k]) chooseAction(its[k].dataset.am); }
      else if (e.key === 'Escape') { e.preventDefault(); closeAMenu(true); }
      else if (e.key === 'Tab') closeAMenu(false);
      return;
    }
    var m = $('#at-menu', A.box);
    if (!m || m.hidden || !e.target.closest('#at-menu')) return;
    var items = [].slice.call(m.querySelectorAll('li')), i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (items[i]) chooseStatus(items[i].dataset.v); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(false);
  }
  function chooseStatus(to) {
    var m = $('#at-menu', A.box), id = m && m.dataset.for;
    closeMenu(true);
    if (id) quickStatus(id, to);
  }
  async function quickStatus(id, to) {
    var a = A.rows.filter(function (x) { return x.id === id; })[0];
    if (!a || to === a.status) return;
    var btn = A.box.querySelector('.at-sttag[data-stfor="' + id + '"]'), tx = btn && btn.querySelector('.at-sttx');
    if (btn) btn.disabled = true;
    if (tx) tx.textContent = LABEL[to];
    var r = await sb.rpc('applicant_set_status', { p_id: a.id, p_status: to, p_note: '' });
    if (r.error) {
      if (btn) btn.disabled = false;
      if (tx) tx.textContent = LABEL[a.status];
      toast("Couldn't change the status. You may not have permission.", 'bad');
      return;
    }
    logAction('applicant.status', a.reference + ' ' + a.status + ' to ' + to, { id: a.id });
    await load();
    var now = A.rows.filter(function (x) { return x.id === id; })[0];
    // the database said yes; make sure it really changed (an old database rule once undid every change)
    if (now && now.status !== to) toast("The status didn't save. The database fix for statuses (supabase/recruitment_status_fix.sql) may not have been run yet.", 'bad');
    else toast(a.full_name + ' is now ' + LABEL[to] + '.', 'ok');
  }


  function openNew() {
    var dlg = $('#an2-dlg'), form = $('#an2-form'), err = $('#an2-err');
    $('#an2-name').value = '';
    $('#an2-pos').value = '';
    $('#an2-date').value = today();
    $('#an2-status').innerHTML = options('new');
    $('#an2-list').innerHTML = positionList().replace('id="at-positions"', 'id="an2-positions"');
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var name = $('#an2-name').value.trim(), pos = $('#an2-pos').value.trim(), date = $('#an2-date').value;
      if (!name) { err.textContent = "Enter the applicant's name."; err.hidden = false; return; }
      if (!pos) { err.textContent = 'Enter the position applied for.'; err.hidden = false; return; }
      if (!date) { err.textContent = 'Enter the date received.'; err.hidden = false; return; }
      err.hidden = true;
      $('#an2-ok').disabled = true;
      var res = await sb.from('applicants').insert({ full_name: name, position_title: pos, vacancy_id: vacancyFor(pos), received_on: date, status: $('#an2-status').value, source: 'manual' }).select('id,reference').maybeSingle();
      $('#an2-ok').disabled = false;
      if (res.error || !res.data) { err.textContent = "Couldn't add that. You may not have permission."; err.hidden = false; return; }
      dlg.close();
      logAction('applicant.add', res.data.reference, { id: res.data.id });
      toast('Added as ' + res.data.reference + '.', 'ok');
      load();
    };
    $('#an2-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#an2-name').focus();
  }

  /* ---------- CSV import ---------- */
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false, i = 0;
    text = text.replace(/^﻿/, '');
    var delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    for (; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function parseDate(s) {
    s = String(s || '').trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (m) {
      var a = Number(m[1]), b = Number(m[2]);
      var mo = a > 12 ? b : a, d = a > 12 ? a : b;           // month/day/year, or day/month/year when the first number can't be a month
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return m[3] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
    }
    return '';
  }
  var COLS = {
    reference: ['reference', 'referenceno', 'referencenumber', 'applicationreference', 'applicationreferencenumber', 'refno'],
    name: ['name', 'fullname', 'applicantname', 'applicant', 'nameofapplicant'],
    position: ['position', 'positionappliedfor', 'positionapplied', 'jobtitle', 'job', 'appliedfor', 'positionapplyingfor'],
    date: ['date', 'datereceived', 'received', 'applicationdate', 'dateapplied', 'timestamp'],
    status: ['status', 'recruitmentstatus', 'currentrecruitmentstatus', 'currentstatus']
  };

  function prepareImport(text, fileName) {
    var table = parseCsv(text);
    if (table.length < 2) return { error: 'That file has no rows to import.' };
    var head = table[0].map(norm), at = {};
    Object.keys(COLS).forEach(function (k) { at[k] = head.findIndex(function (h) { return COLS[k].indexOf(h) !== -1; }); });
    if (at.name < 0) return { error: 'The file needs a Name column (also accepted: Full name, Applicant name).' };
    var statusKey = {};
    STATUSES.forEach(function (s) { statusKey[norm(s[0])] = s[0]; statusKey[norm(s[1])] = s[0]; });
    ['newapplication:new', 'forinitialscreening:screening', 'initialscreening:screening', 'forinterview:interview', 'forworksample:work_sample', 'forfinalreview:final_review'].forEach(function (p) { statusKey[p.split(':')[0]] = p.split(':')[1]; });
    var known = {};
    A.rows.forEach(function (a) { if (a.reference) known[a.reference.toLowerCase()] = true; });
    var seen = {}, out = [], sum = { skipped: 0, duplicates: 0, badStatus: 0, noDate: 0 };
    table.slice(1).forEach(function (r) {
      var name = String(r[at.name] || '').trim();
      if (!name) { sum.skipped++; return; }
      var ref = at.reference >= 0 ? String(r[at.reference] || '').trim() : '';
      if (ref && (known[ref.toLowerCase()] || seen[ref.toLowerCase()])) { sum.duplicates++; return; }
      if (ref) seen[ref.toLowerCase()] = true;
      var pos = at.position >= 0 ? String(r[at.position] || '').trim().slice(0, 120) : '';
      var date = at.date >= 0 ? parseDate(r[at.date]) : '';
      if (!date) { sum.noDate++; date = today(); }
      var st = 'new';
      if (at.status >= 0 && String(r[at.status] || '').trim()) {
        st = statusKey[norm(r[at.status])] || '';
        if (!st) { sum.badStatus++; st = 'new'; }
      }
      var row = { full_name: name.slice(0, 120), position_title: pos, vacancy_id: vacancyFor(pos), received_on: date, status: st, source: 'import' };
      if (ref) row.reference = ref.slice(0, 40);
      out.push(row);
    });
    return { rows: out, sum: sum, fileName: fileName, hasRef: at.reference >= 0 };
  }

  function showImport(p) {
    A.importing = p;
    var s = p.sum, dlg = $('#imp-dlg');
    var lines = ['<li><b>' + p.rows.length + '</b> ' + (p.rows.length === 1 ? 'applicant is' : 'applicants are') + ' ready to import.</li>'];
    if (s.skipped) lines.push('<li>' + s.skipped + ' ' + (s.skipped === 1 ? 'row has' : 'rows have') + ' no name and will be skipped.</li>');
    if (s.duplicates) lines.push('<li>' + s.duplicates + ' ' + (s.duplicates === 1 ? 'row repeats' : 'rows repeat') + ' a reference that already exists and will be skipped.</li>');
    if (s.badStatus) lines.push('<li>' + s.badStatus + ' ' + (s.badStatus === 1 ? 'row has' : 'rows have') + ' a status that is not recognised and will start as New Application.</li>');
    if (s.noDate) lines.push('<li>' + s.noDate + ' ' + (s.noDate === 1 ? 'row has' : 'rows have') + ' no usable date, so today\'s date is used.</li>');
    if (!p.hasRef) lines.push('<li>There is no Reference column, so new references are created. Importing the same file twice would add everyone twice.</li>');
    $('#imp-body').innerHTML = '<ul class="imp-sum">' + lines.join('') + '</ul>' +
      (p.rows.length ? '<div class="imp-sample"><table class="at-tbl"><thead><tr><th>Name</th><th>Position</th><th>Received</th><th>Status</th></tr></thead><tbody>' +
        p.rows.slice(0, 5).map(function (r) { return '<tr><td>' + esc(r.full_name) + '</td><td>' + esc(r.position_title || '—') + '</td><td>' + esc(app.fmtDate(r.received_on)) + '</td><td>' + esc(LABEL[r.status]) + '</td></tr>'; }).join('') +
        '</tbody></table>' + (p.rows.length > 5 ? '<p class="fine">…and ' + (p.rows.length - 5) + ' more.</p>' : '') + '</div>' : '') +
      '<p class="msg bad" id="imp-err" role="alert" hidden></p>';
    $('#imp-ok').disabled = !p.rows.length;
    $('#imp-ok').onclick = runImport;
    $('#imp-cancel').onclick = function () { dlg.close(); A.importing = null; };
    dlg.showModal();
  }

  async function runImport() {
    var p = A.importing;
    if (!p || !p.rows.length) return;
    var err = $('#imp-err');
    err.hidden = true;
    $('#imp-ok').disabled = true;
    var done = 0;
    for (var i = 0; i < p.rows.length; i += 200) {
      $('#imp-ok').textContent = 'Importing ' + Math.min(i + 200, p.rows.length) + ' of ' + p.rows.length + '…';
      var res = await sb.from('applicants').insert(p.rows.slice(i, i + 200)).select('id');
      if (res.error) {
        err.textContent = (done ? done + ' applicants were imported before this stopped. ' : '') + "Couldn't import the rest. You may not have permission, or a reference is already in use.";
        err.hidden = false;
        $('#imp-ok').textContent = 'Try again';
        $('#imp-ok').disabled = false;
        if (done) load();
        return;
      }
      done += (res.data || []).length;
    }
    $('#imp-ok').textContent = 'Import';
    $('#imp-dlg').close();
    A.importing = null;
    logAction('applicants.import', done + ' applicants', { file: p.fileName, count: done });
    toast(done + (done === 1 ? ' applicant imported.' : ' applicants imported.'), 'ok');
    A.status = 'all';
    load();
  }

  function onClick(e) {
    var ai = e.target.closest('#at-amenu li');
    if (ai) { chooseAction(ai.dataset.am); return; }
    var ab = e.target.closest('[data-a="amenu"]');
    if (ab) { openAMenu(ab); return; }
    var item = e.target.closest('#at-menu li');
    if (item) { chooseStatus(item.dataset.v); return; }
    var tag = e.target.closest('.at-sttag');
    if (tag) { openMenu(tag); return; }
    var row = e.target.closest('#at-rows tr');
    if (row && !e.target.closest('select, button, a')) { openDetail(row.dataset.id); return; }
    var pm = e.target.closest('[data-from]');
    if (pm) { var same = A.from === pm.dataset.from && A.to === pm.dataset.to; A.from = same ? '' : pm.dataset.from; A.to = same ? '' : pm.dataset.to; A.shown = PAGE; render(); toList(); return; }
    var pp = e.target.closest('[data-pos]');
    if (pp) { A.pos = A.pos === pp.dataset.pos ? '' : pp.dataset.pos; A.shown = PAGE; render(); toList(); return; }
    var card = e.target.closest('[data-status]');
    if (card) { var fromDash = !!card.closest('#at-sum'); A.status = card.dataset.status === A.status ? 'all' : card.dataset.status; A.shown = PAGE; render(); if (fromDash) toList(); return; }
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'back') { A.ctx.back(); return; }
    if (a === 'add') { openNew(); return; }
    if (a === 'import') { $('#at-file', A.box).click(); return; }
    if (a === 'morecharts') { A.moreOpen = !A.moreOpen; render(); return; }
    if (a === 'more') { A.shown += PAGE; render(); return; }
    if (a === 'clear') { A.status = 'all'; A.pos = ''; A.from = ''; A.to = ''; A.q = ''; A.fOpen = false; var qi = $('#at-q', A.box); if (qi) qi.value = ''; A.shown = PAGE; render(); return; }
    if (a === 'filters') { A.fOpen = !A.fOpen; render(); return; }
    if (a === 'rnote') { var tn = e.target.closest('tr'); if (tn) { openDetail(tn.dataset.id).then(function () { var n = $('#ap-note'); if (n) n.focus(); }); } return; }
    if (a === 'rdel') { var td = e.target.closest('tr'); if (td) rowDelete(td.dataset.id); return; }
    if (a === 'open') { var tr = e.target.closest('tr'); if (tr) openDetail(tr.dataset.id); }
  }

  window.MembersApplicants = {
    open: function (box, ctx) {
      A.box = box;
      A.ctx = ctx;
      A.q = ''; A.pos = ''; A.from = ''; A.to = ''; A.shown = PAGE; A.fOpen = false;
      // the Recruitment card on the Staffing page can open this screen on one status
      A.status = ctx && ctx.tab && (ctx.tab === 'all' || LABEL[ctx.tab] || GROUPS[ctx.tab]) ? ctx.tab : 'all';
      if (!canManage()) {
        box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') + '<div class="ph-main"><h2>Applicant Tracking System</h2></div></div>' +
          '<div class="list-card"><div class="es"><span class="eic">' + I('lock') + '</span><b>Staffing and Recruitment only</b><p>Applicant records can be opened by Staffing and Recruitment.</p></div></div>';
        box.onclick = onClick;
        return;
      }
      shell();
      box.onclick = onClick;
      box.onkeydown = menuKey;
      box.oninput = function (e) {
        if (e.target.id === 'at-q') { A.q = e.target.value; A.shown = PAGE; render(); }
        else if (e.target.id === 'at-from') { A.from = e.target.value; A.shown = PAGE; render(); }
        else if (e.target.id === 'at-to') { A.to = e.target.value; A.shown = PAGE; render(); }
      };
      box.onchange = function (e) {
        if (e.target.id === 'at-pos') { A.pos = e.target.value; A.shown = PAGE; render(); }
        else if (e.target.id === 'at-status') { A.status = e.target.value; A.shown = PAGE; render(); }
        else if (e.target.id === 'at-file') {
          var f = e.target.files[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > 5 * 1048576) { toast('That file is over 5 MB.', 'bad'); return; }
          var rd = new FileReader();
          rd.onload = function () {
            var p = prepareImport(String(rd.result || ''), f.name);
            if (p.error) toast(p.error, 'bad'); else showImport(p);
          };
          rd.onerror = function () { toast("Couldn't read that file.", 'bad'); };
          rd.readAsText(f);
        }
      };
      return load();
    }
  };

  // the status menu closes on an outside click, on scrolling and on resizing; wired once
  document.addEventListener('click', function (e) { if (!e.target.closest('#at-menu, .at-sttag')) closeMenu(false); if (!e.target.closest('#at-amenu, [data-a="amenu"]')) closeAMenu(false); });
  window.addEventListener('scroll', function () { closeMenu(false); closeAMenu(false); }, true);
  window.addEventListener('resize', function () { closeMenu(false); closeAMenu(false); });

  // the dialogs belong to the page, so they are wired once
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#ap-dlg [data-ap]');
    if (b) detailAction(b.dataset.ap);
  });
})();
