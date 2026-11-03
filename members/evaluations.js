/*
  SINAGLIKHA Performance Management System: evaluation forms and employee evaluations.
  Total Rewards (and the Administrator) create the evaluation forms on a page in the style of Google Forms.
  Each form is for one category:
    Self      every employee fills it in about themselves, on their dashboard
    Peer      any employee may fill it in about a colleague whose name they type
    Manager   any Senior Manager fills it in about an employee, here
  Every Senior Manager can evaluate an employee and can read manager evaluations; each edits only their
  own. Self and peer answers are read by Total Rewards and the Administrator only. A form is copied into
  an evaluation when it starts, so editing a form later never changes an evaluation already written.
  A spreadsheet (CSV) of the evaluations can be downloaded and one evaluation can be printed or saved as a
  PDF; both are written to the activity log. The database rules in supabase/phase5.sql and phase6.sql
  decide who can do what; this screen only shows it. Opened from the Performance Management System card
  in the Content tab (see content.js). That screen lists only manager evaluations of employees. Every
  evaluation, by category (manager, self, peer), is also listed in the Records tab under Evaluation Results,
  which opens this module in its results mode (openResults).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton, F = window.SngEvalForm;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var CATS = {
    self: { name: 'Self', long: 'Self-assessment', who: 'Every employee, about themselves. Shown on their dashboard.' },
    peer: { name: 'Peer', long: 'Peer evaluation', who: 'Any employee, about a colleague they name. Optional.' },
    manager: { name: 'Manager', long: 'Manager evaluation', who: 'Any Senior Manager, about an employee.' }
  };
  var COLS = 'id,employee_id,scorecard_id,scorecard_title,period,scale_max,criteria,overall_comment,status,category,evaluator_id,evaluator_employee_id,evaluator_name,finalized_at,created_at,updated_at';
  var ev = { box: null, ctx: null, mode: 'pms', view: 'list', tab: 'evals', cat: 'manager', cards: [], rows: [], people: [], failed: false, q: '', cur: null, card: null };
  var bd = null;   // the form being built

  function canBuild() { return !!(state.isAdmin || (state.profile && state.profile.department === 'rewards')); }
  function myId() { return state.session && state.session.user ? state.session.user.id : null; }
  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function person(id) { return ev.people.filter(function (p) { return p.id === id; })[0] || null; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function fmtDay(iso) {
    return iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  }
  function fmtDate(d) { return d ? fmtDay(d + 'T00:00:00+08:00') : ''; }
  function busy(text) {
    var b = $('#ev-busy', ev.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function isOpen(c) { var t = today(); return c.active && (!c.opens_on || c.opens_on <= t) && (!c.closes_on || c.closes_on >= t); }
  function labelFor(card, n) {
    var l = card && Array.isArray(card.labels) ? card.labels[n - 1] : '';
    return l ? String(l) : '';
  }

  /* ---------- data ---------- */
  async function load() {
    busy('Loading…');
    var r = await Promise.all([
      sb.from('scorecards').select('*').order('created_at', { ascending: false }).limit(200),
      sb.from('evaluations').select(COLS).order('updated_at', { ascending: false }).limit(1000),
      sb.rpc('employee_options')
    ]);
    busy('');
    ev.failed = !!(r[0].error || r[1].error);
    ev.cards = r[0].error ? [] : r[0].data || [];
    ev.rows = r[1].error ? [] : r[1].data || [];
    ev.people = r[2].error || !Array.isArray(r[2].data) ? [] : r[2].data;
  }
  async function reloadAndDraw() { await load(); drawList(); }

  function emptyHtml(icon, title, text) { return '<span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p>'; }

  /* ---------- the list page ---------- */
  function shellList() {
    var build = canBuild();
    ev.box.innerHTML =
      '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Performance Management System</h2><p class="sub">Evaluation forms and manager evaluations</p></div></div>' +
      '<p class="sp-note" id="ev-note"></p>' +
      '<div class="ev-bar"><div class="pills" id="ev-tabs" role="group" aria-label="Show">' +
      '<button class="pill" type="button" data-tab="evals" aria-pressed="true">Manager evaluations</button>' +
      (build ? '<button class="pill" type="button" data-tab="forms" aria-pressed="false">Evaluation forms</button>' : '') + '</div>' +
      '<div class="ph-actions" id="ev-actions"></div></div>' +
      '<div class="list-card" id="ev-wrap" style="position:relative"><ul class="rows" id="ev-rows"></ul><div class="es" id="ev-empty" hidden></div>' +
      '<div class="busy" id="ev-busy" hidden role="status">Loading…</div></div>';
  }

  /* the same list, opened from the Records tab: the results of one category */
  function shellResults() {
    ev.box.innerHTML =
      '<div class="ev-bar"><p class="fine" id="ev-note" style="margin:0;flex:1 1 260px"></p><div class="ph-actions" id="ev-actions"></div></div>' +
      '<div class="list-card" id="ev-wrap" style="position:relative"><ul class="rows" id="ev-rows"></ul><div class="es" id="ev-empty" hidden></div>' +
      '<div class="busy" id="ev-busy" hidden role="status">Loading…</div></div>';
  }

  function drawActions() {
    var a = $('#ev-actions', ev.box);
    if (ev.tab === 'forms') {
      a.innerHTML = '<button class="btn btn-primary btn-sm" type="button" data-a="new-form">Create new form</button>';
      return;
    }
    a.innerHTML = '<div class="sbox">' + I('search') + '<input id="ev-search" type="search" placeholder="Search" aria-label="Search by employee, form or period" autocomplete="off" value="' + esc(ev.q) + '"></div>' +
      IB('download', 'Download these evaluations as a spreadsheet', { 'data-a': 'export' }) +
      (ev.mode === 'pms' ? '<button class="btn btn-primary btn-sm" type="button" data-a="new-eval">Evaluate an employee</button>' : '');
    var s = $('#ev-search', ev.box);
    s.addEventListener('input', function () { ev.q = s.value; drawRows(); });
  }

  function drawList() {
    if (ev.mode === 'results') {
      if (!$('#ev-rows', ev.box)) shellResults();
      var c = CATS[ev.cat] || CATS.manager;
      $('#ev-note', ev.box).textContent = ev.cat === 'manager'
        ? 'Manager evaluations of employees, written by the Senior Managers.'
        : ev.cat === 'self' ? 'Employees' self-assessments.' : 'Peer evaluations. The colleague never sees who wrote them.';
      drawActions();
      drawRows();
      return;
    }
    if (!$('#ev-tabs', ev.box)) shellList();
    Array.prototype.forEach.call(ev.box.querySelectorAll('[data-tab]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.tab === ev.tab)); });
    $('#ev-note', ev.box).textContent = ev.tab === 'forms'
      ? 'Total Rewards builds the forms. Self and peer answers are in Records.'
      : 'Any Senior Manager can evaluate; you edit only your own. Employees never see these.';
    drawActions();
    drawRows();
  }

  function visibleRows() {
    var q = ev.q.trim().toLowerCase();
    return ev.rows.filter(function (r) {
      if (ev.cat !== 'all' && r.category !== ev.cat) return false;
      var p = person(r.employee_id);
      return !q || (p && (p.full_name.toLowerCase().indexOf(q) !== -1 || p.employee_no.toLowerCase().indexOf(q) !== -1)) ||
        r.scorecard_title.toLowerCase().indexOf(q) !== -1 || r.period.toLowerCase().indexOf(q) !== -1 || (r.evaluator_name || '').toLowerCase().indexOf(q) !== -1;
    });
  }
  function editable(r) {
    return r.category === 'manager' && r.status === 'draft' && (r.evaluator_id === myId() || canBuild());
  }
  function deletable(r) {
    if (r.category === 'manager') return r.evaluator_id === myId() || canBuild();
    return canBuild();
  }

  function drawRows() {
    var rows = $('#ev-rows', ev.box), empty = $('#ev-empty', ev.box);
    if (ev.failed) {
      rows.innerHTML = '';
      empty.innerHTML = emptyHtml('clipboard', 'Not set up yet', 'Run supabase/phase5.sql and supabase/phase6.sql in the Supabase SQL editor, then reload this page.');
      empty.hidden = false;
      return;
    }
    if (ev.tab === 'forms') {
      rows.innerHTML = ev.cards.map(function (c) {
        var n = Array.isArray(c.criteria) ? c.criteria.length : 0;
        var dates = c.opens_on || c.closes_on ? [c.opens_on ? 'Opens ' + fmtDate(c.opens_on) : '', c.closes_on ? 'Closes ' + fmtDate(c.closes_on) : ''].filter(Boolean).join(', ') : '';
        var meta = [(CATS[c.category] || CATS.manager).long, n + (n === 1 ? ' question' : ' questions'), c.period, dates].filter(Boolean).join(' · ');
        var chip = !c.active ? ['s-archived', 'Hidden'] : isOpen(c) ? ['s-published', 'Open'] : ['s-draft', 'Not open now'];
        return '<li class="lrow" data-id="' + esc(c.id) + '"><button class="lmain" type="button" data-a="edit-form"><span class="lico">' + I('clipboard') + '</span><span class="ltext"><span class="lname">' +
          esc(c.title) + '</span><span class="lmeta">' + esc(meta) + '</span></span></button>' +
          '<div class="lside"><span class="chip ' + chip[0] + '">' + chip[1] + '</span><div class="lacts">' +
          IB('pencil', 'Edit this form', { 'data-a': 'edit-form' }) +
          (c.active ? IB('eyeOff', 'Hide: stop using it', { 'data-a': 'toggle-form' }) : IB('eye', 'Use it again', { 'data-a': 'toggle-form' }, 'good')) +
          IB('trash', 'Delete this form', { 'data-a': 'del-form' }, 'danger') + '</div></div></li>';
      }).join('');
      if (!ev.cards.length) {
        empty.innerHTML = emptyHtml('clipboard', 'No forms yet', 'Press Create new form to build a Self, Peer or Manager evaluation form.');
        empty.hidden = false;
      } else empty.hidden = true;
      return;
    }
    var list = visibleRows();
    rows.innerHTML = list.map(function (r) {
      var p = person(r.employee_id), cat = CATS[r.category] || CATS.manager;
      var by = r.category === 'self' ? '' : r.evaluator_name ? 'by ' + r.evaluator_name : '';
      var meta = [r.scorecard_title, r.period, by].filter(Boolean).join(' · ');
      return '<li class="lrow" data-id="' + esc(r.id) + '"><button class="lmain" type="button" data-a="open-eval"><span class="lico">' + I('clipboard') + '</span><span class="ltext"><span class="lname">' +
        esc(p ? p.full_name : 'Unknown employee') + (p ? ' (' + esc(p.employee_no) + ')' : '') + '</span><span class="lmeta">' + esc(meta) + '</span></span></button>' +
        '<div class="lside"><span class="chip plain">' + esc(cat.name) + '</span><span class="chip ' + (r.status === 'final' ? 's-published' : 's-draft') + '">' + (r.status === 'final' ? 'Final' : 'Draft') + '</span><div class="lacts">' +
        (deletable(r) ? IB('trash', 'Delete this evaluation', { 'data-a': 'del-eval' }, 'danger') : '') + '</div></div></li>';
    }).join('');
    if (!ev.rows.length) {
      empty.innerHTML = emptyHtml('clipboard', 'No evaluations yet', ev.mode === 'pms' ? 'Press Evaluate an employee to write the first one.' : 'None have been submitted yet.');
      empty.hidden = false;
    } else if (!list.length) {
      empty.innerHTML = emptyHtml('search', 'Nothing matches', 'Try another search or category.');
      empty.hidden = false;
    } else empty.hidden = true;
  }

  /* ---------- building a form: a page, in the style of Google Forms ---------- */
  function blankQuestion(type) {
    type = type || 'rating';
    return { id: newId(), type: type, title: '', description: '', required: F.isScored(type), options: F.hasOptions(type) ? ['Option 1'] : [], scale: 5, labels: [] };
  }

  function openBuilder(c) {
    bd = {
      id: c ? c.id : null,
      category: c ? c.category : '',
      title: c ? c.title : '',
      description: c ? c.description || '' : '',
      period: c ? c.period || '' : '',
      opens_on: c ? c.opens_on || '' : '',
      closes_on: c ? c.closes_on || '' : '',
      scale_max: c ? c.scale_max : 5,
      labels: c ? (c.labels || []).slice() : [],
      active: c ? c.active : true,
      sel: 0,
      questions: c ? c.criteria.map(function (x) {
        var t = F.qType(x);
        // a linear scale keeps its own length and names; older ones take the form's, so they become the question's own
        var sc = Number(x.scale) >= 3 && Number(x.scale) <= 10 ? Number(x.scale) : (c.scale_max || 5);
        var nm = Array.isArray(x.labels) ? x.labels.slice() : (c.labels || []).slice(0, sc);
        return { id: x.id || newId(), type: t, title: x.title || '', description: x.description || '', required: F.isRequired(x), options: F.hasOptions(t) && Array.isArray(x.options) ? x.options.slice() : [] , scale: sc, labels: nm };
      }) : [blankQuestion('rating')]
    };
    ev.view = 'builder';
    drawBuilder();
    window.scrollTo(0, 0);
  }

  function readBuilder() {
    var t = $('#bd-title', ev.box);
    if (!t) return;
    bd.title = t.value;
    bd.description = $('#bd-desc', ev.box).value;
    bd.period = $('#bd-period', ev.box).value;
    bd.opens_on = $('#bd-opens', ev.box).value;
    bd.closes_on = $('#bd-closes', ev.box).value;
    var q = bd.questions[bd.sel], card = $('.gf-card.on[data-i]', ev.box);
    if (q && card) {
      q.title = $('.gf-q-in', card).value;
      q.description = $('.q-desc', card).value;
      q.required = $('.q-req', card).checked;
      if (F.hasOptions(q.type)) q.options = Array.prototype.map.call(card.querySelectorAll('.q-opt'), function (inp) { return inp.value; });
      var sc = $('.q-scale', card);
      if (sc) {
        q.scale = Number(sc.value);
        q.labels = Array.prototype.map.call(card.querySelectorAll('.q-lab'), function (inp) { return inp.value; });
      }
    }
  }

  function formCtx() { return { scale_max: bd.scale_max, labels: bd.labels }; }
  function previewQ(q) {
    var inner = '<div class="gf-qt">' + esc(q.title || 'Untitled question') + (q.required ? '<span class="s">*</span>' : '') + '</div>' + (q.description ? '<div class="gf-qd">' + esc(q.description) + '</div>' : '');
    return inner + F.preview(q, formCtx());
  }

  function optionRows(q) {
    var sq = q.type === 'checkbox';
    return '<div class="gf-opts">' + q.options.map(function (o, k) {
      return '<div class="gf-optrow">' + (q.type === 'dropdown' ? '<span style="width:18px;color:var(--muted)">' + (k + 1) + '.</span>' : '<span class="mark' + (sq ? ' sq' : '') + '"></span>') +
        '<input class="gf-in q-opt" type="text" maxlength="100" value="' + esc(o) + '" placeholder="Option ' + (k + 1) + '" aria-label="Option ' + (k + 1) + '">' +
        (q.options.length > 1 ? IB('x', 'Remove this option', { 'data-q': 'rmopt', 'data-oi': k }) : '') + '</div>';
    }).join('') + '<button class="gf-addopt" type="button" data-q="addopt">Add option</button></div>';
  }

  /* a linear scale: how long it is, and optional names for its points */
  function scaleRows(q) {
    var sc = F.scaleOf(q, formCtx()), opts = [3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<option value="' + n + '"' + (sc === n ? ' selected' : '') + '>1 to ' + n + '</option>'; }).join('');
    var names = '';
    for (var n = 1; n <= sc; n++) {
      names += '<div class="gf-optrow"><span style="width:22px;font-weight:700;color:var(--brown);text-align:center">' + n + '</span><input class="gf-in q-lab" type="text" maxlength="40" value="' + esc(F.nameOf(q, formCtx(), n)) + '" placeholder="Name for ' + n + ' (optional)" aria-label="Name for rating ' + n + '"></div>';
    }
    return '<div class="gf-row" style="margin-top:12px;align-items:center"><label class="gf-lab" style="margin:0;flex:0 0 auto" for="qs-' + esc(q.id) + '">Scale</label><select class="gf-in q-scale" id="qs-' + esc(q.id) + '" style="flex:0 0 120px">' + opts + '</select></div>' +
      '<details style="margin-top:10px"' + (q.labels && q.labels.some(function (l) { return l; }) ? ' open' : '') + '><summary style="cursor:pointer;color:var(--brown);font-weight:600">Name the ratings (optional)</summary><div class="gf-opts">' + names + '</div></details>';
  }

  function editQ(q, i) {
    var scored = F.isScored(q.type);
    var typeOpts = F.TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (q.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('');
    return '<div class="gf-qtop"><input class="gf-in gf-q-in" type="text" maxlength="160" placeholder="Question" value="' + esc(q.title) + '" aria-label="Question ' + (i + 1) + '">' +
      '<select data-q="type" aria-label="Question type">' + typeOpts + '</select></div>' +
      '<input class="gf-in q-desc" type="text" maxlength="400" placeholder="Description (optional)" value="' + esc(q.description) + '" aria-label="Description for question ' + (i + 1) + '" style="margin-top:8px">' +
      (F.hasOptions(q.type) ? optionRows(q) : F.preview(q, formCtx())) + (q.type === 'rating' ? scaleRows(q) : '') +
      '<div class="gf-qfoot">' + IB('arrowUp', 'Move up', { 'data-q': 'up' }) + IB('arrowDown', 'Move down', { 'data-q': 'down' }) + IB('copy', 'Duplicate', { 'data-q': 'dup' }) + IB('trash', 'Delete question', { 'data-q': 'del' }, 'danger') +
      '<label class="gf-sw"><input class="q-req" type="checkbox"' + (q.required ? ' checked' : '') + '><i></i>Required</label></div>';
  }

  function drawBuilder() {
    var cats = ['self', 'peer', 'manager'].map(function (k) {
      return '<button class="gf-cat" type="button" data-cat-pick="' + k + '" aria-pressed="' + (bd.category === k) + '"' + (bd.id ? ' disabled' : '') + '><b>' + CATS[k].long + '</b><small>' + esc(CATS[k].who) + '</small></button>';
    }).join('');
    var qs = bd.questions.map(function (q, i) {
      var on = i === bd.sel;
      return '<div class="gf-card' + (on ? ' on' : '') + '" data-i="' + i + '">' + (on ? editQ(q, i) : previewQ(q)) + '</div>';
    }).join('');
    ev.box.innerHTML =
      '<div class="ph">' + IB('back', 'Back to the forms', { 'data-a': 'builder-back' }, 'line') +
      '<div class="ph-main"><h2>' + (bd.id ? 'Edit form' : 'Create new form') + '</h2><p class="sub">Questions are copied into each evaluation when it starts</p></div>' +
      '<div class="ph-actions"><button class="btn btn-ghost btn-sm" type="button" data-a="builder-back">Cancel</button><button class="btn btn-primary btn-sm" type="button" data-a="builder-save" id="bd-save">Save</button></div></div>' +
      '<div class="gf-wrap"><div class="gf">' +
      '<div class="gf-card head"><input class="gf-in gf-title" id="bd-title" type="text" maxlength="160" placeholder="Untitled form" value="' + esc(bd.title) + '" aria-label="Form title">' +
      '<textarea class="gf-in" id="bd-desc" rows="2" maxlength="1000" placeholder="Form description" aria-label="Form description" style="margin-top:6px">' + esc(bd.description) + '</textarea></div>' +
      '<div class="gf-card"><div class="gf-qt">Who fills in this form?' + (bd.id ? '' : '<span class="s">*</span>') + '</div><div class="gf-cats">' + cats + '</div>' + (bd.id ? '<div class="gf-qd" style="margin-top:8px">The category cannot be changed after the form is created.</div>' : '') +
      '<div class="gf-row" style="margin-top:14px"><div><label class="gf-lab" for="bd-period">Period (for example 2026 Q4)</label><input class="gf-in" id="bd-period" type="text" maxlength="60" value="' + esc(bd.period) + '"></div>' +
      '<div><label class="gf-lab" for="bd-opens">Opens on (optional)</label><input class="gf-in" id="bd-opens" type="date" value="' + esc(bd.opens_on) + '"></div>' +
      '<div><label class="gf-lab" for="bd-closes">Closes on (optional)</label><input class="gf-in" id="bd-closes" type="date" value="' + esc(bd.closes_on) + '"></div>' +
      '</div>' +
      '</div>' +
      qs + '<p class="gf-err" id="bd-err" role="alert" hidden></p></div>' +
      '<div class="gf-tool">' + IB('plus', 'Add a question', { 'data-a': 'add-q' }) + '</div></div>';
  }

  function builderClick(e) {
    var b = e.target.closest('[data-a],[data-q],[data-cat-pick]');
    var card = e.target.closest('.gf-card[data-i]');
    if (b && b.hasAttribute('data-cat-pick')) { if (!bd.id) { readBuilder(); bd.category = b.dataset.catPick; drawBuilder(); } return; }
    if (b && b.dataset.a === 'builder-back') { leaveBuilder(); return; }
    if (b && b.dataset.a === 'builder-save') { saveForm(); return; }
    if (b && b.dataset.a === 'add-q') {
      readBuilder();
      bd.questions.push(blankQuestion('rating'));
      bd.sel = bd.questions.length - 1;
      drawBuilder();
      var last = $('.gf-card.on', ev.box);
      if (last) { last.scrollIntoView({ block: 'center' }); $('.gf-q-in', last).focus(); }
      return;
    }
    if (b && b.dataset.q && card && b.tagName !== 'SELECT') {
      readBuilder();
      var i = Number(card.dataset.i), k = b.dataset.q;
      if (k === 'del') { if (bd.questions.length > 1) { bd.questions.splice(i, 1); bd.sel = Math.min(i, bd.questions.length - 1); } }
      else if (k === 'up' && i > 0) { bd.questions.splice(i - 1, 0, bd.questions.splice(i, 1)[0]); bd.sel = i - 1; }
      else if (k === 'down' && i < bd.questions.length - 1) { bd.questions.splice(i + 1, 0, bd.questions.splice(i, 1)[0]); bd.sel = i + 1; }
      else if (k === 'dup') { var cp = JSON.parse(JSON.stringify(bd.questions[i])); cp.id = newId(); bd.questions.splice(i + 1, 0, cp); bd.sel = i + 1; }
      else if (k === 'addopt') { var oq = bd.questions[i]; if (oq.options.length < 30) oq.options.push('Option ' + (oq.options.length + 1)); }
      else if (k === 'rmopt') { var rq = bd.questions[i]; if (rq.options.length > 1) rq.options.splice(Number(b.dataset.oi), 1); }
      drawBuilder();
      return;
    }
    if (card && !card.classList.contains('on') && !e.target.closest('input,textarea,select,button')) {
      readBuilder();
      bd.sel = Number(card.dataset.i);
      drawBuilder();
    }
  }

  function onChange(e) {
    if (ev.view !== 'builder') return;
    if (e.target.matches('select[data-q="type"]')) {
      readBuilder();
      var q = bd.questions[bd.sel];
      q.type = e.target.value;
      q.required = F.isScored(q.type);
      if (F.hasOptions(q.type) && !q.options.length) q.options = ['Option 1'];
      if (q.type === 'rating' && !(Number(q.scale) >= 3)) { q.scale = 5; q.labels = []; }
      drawBuilder();
    } else if (e.target.matches('.q-scale')) {
      readBuilder();
      drawBuilder();
    }
  }

  async function leaveBuilder() {
    ev.view = 'list';
    ev.tab = 'forms';
    shellList();
    await reloadAndDraw();
  }

  async function saveForm() {
    readBuilder();
    var err = $('#bd-err', ev.box), problem = '';
    var qs = bd.questions.map(function (q) {
      var o = { id: q.id, type: q.type, title: String(q.title).trim(), description: String(q.description).trim(), weight: F.isScored(q.type) ? 1 : 0, required: !!q.required };
      if (F.hasOptions(q.type)) o.options = q.options.map(function (x) { return String(x).trim(); }).filter(Boolean);
      if (q.type === 'rating') {
        o.scale = Number(q.scale) >= 3 && Number(q.scale) <= 10 ? Number(q.scale) : 5;
        var nm = (q.labels || []).slice(0, o.scale).map(function (x) { return String(x || '').trim(); });
        o.labels = nm.some(Boolean) ? nm : [];
      }
      return o;
    });
    if (!bd.title.trim()) problem = 'Give the form a title.';
    else if (!bd.category) problem = 'Choose who fills in this form.';
    else if ((bd.category === 'self' || bd.category === 'peer') && !bd.period.trim()) problem = 'Enter the period for this form, for example 2026 Q4.';
    else if (bd.opens_on && bd.closes_on && bd.closes_on < bd.opens_on) problem = 'The closing date is before the opening date.';
    else if (qs.some(function (q) { return !q.title; })) problem = 'Every question needs a title. Delete any empty ones.';
    else if (qs.some(function (q) { return F.hasOptions(q.type) && !q.options.length; })) problem = 'Add at least one option to every choice question.';
    if (problem) { err.textContent = problem; err.hidden = false; err.scrollIntoView({ block: 'center' }); return; }
    err.hidden = true;
    var fields = {
      title: bd.title.trim(), description: bd.description.trim(), scale_max: bd.scale_max,
      labels: bd.labels.slice(0, bd.scale_max).map(function (l) { return l || ''; }), criteria: qs,
      period: bd.period.trim(), opens_on: bd.opens_on || null, closes_on: bd.closes_on || null
    };
    var save = $('#bd-save', ev.box);
    save.disabled = true;
    var res = bd.id
      ? await sb.from('scorecards').update(fields).eq('id', bd.id).select('id').maybeSingle()
      : await sb.from('scorecards').insert(Object.assign({ active: true, category: bd.category }, fields)).select('id').maybeSingle();
    save.disabled = false;
    if (res.error || !res.data) { err.textContent = "Couldn't save that. " + (res.error && res.error.message ? res.error.message : 'You may not have permission.'); err.hidden = false; return; }
    logAction(bd.id ? 'evalform.edit' : 'evalform.add', fields.title, { id: res.data.id, category: bd.category });
    toast(bd.id ? 'Saved. Evaluations already written keep their own copy.' : 'Form created.', 'ok');
    await leaveBuilder();
  }

  async function toggleForm(c) {
    busy('Saving…');
    var res = await sb.from('scorecards').update({ active: !c.active }).eq('id', c.id).select('id').maybeSingle();
    busy('');
    if (res.error || !res.data) { toast("Couldn't save that. You may not have permission.", 'bad'); return; }
    logAction(c.active ? 'evalform.hide' : 'evalform.show', c.title, { id: c.id });
    await reloadAndDraw();
  }
  async function removeForm(c) {
    var ok = await ask({ title: 'Delete This Form?', text: '"' + c.title + '" will be deleted. Evaluations already written with it are kept in full.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('scorecards').delete().eq('id', c.id).select('id');
    busy('');
    if (res.error || !(res.data || []).length) { toast("Couldn't delete that form. " + (res.error && res.error.message ? res.error.message : 'You may not have permission.'), 'bad'); return; }
    logAction('evalform.delete', c.title, { id: c.id });
    toast('Deleted.', 'ok');
    await reloadAndDraw();
  }

  /* ---------- starting a manager evaluation: a page ---------- */
  function openStart() {
    ev.view = 'start';
    var people = ev.people.filter(function (p) { return p.active; });
    var forms = ev.cards.filter(function (c) { return c.category === 'manager' && isOpen(c); });
    ev.box.innerHTML =
      '<div class="ph">' + IB('back', 'Back to the evaluations', { 'data-a': 'start-back' }, 'line') + '<div class="ph-main"><h2>Evaluate an employee</h2><p class="sub">Manager evaluation</p></div></div>' +
      '<div class="gf"><div class="gf-card head"><h1 class="gf-h1">Evaluate an employee</h1><div class="gf-desc">Choose the employee and the form to use. You can save a draft and finish later.</div></div>' +
      (forms.length
        ? '<div class="gf-card"><label class="gf-lab" for="st-emp-q" style="margin-top:0">Employee</label>' +
          '<div class="cbx" id="st-cbx"><input class="gf-in" id="st-emp-q" type="text" role="combobox" aria-expanded="false" aria-controls="st-list" aria-autocomplete="list" autocomplete="off" placeholder="Search by name or employee ID">' +
          '<button class="cbx-btn" type="button" tabindex="-1" aria-label="Show the list of employees" id="st-cbx-btn">' + I('chevron') + '</button><ul class="cbx-list" id="st-list" role="listbox" hidden></ul><input type="hidden" id="st-emp"></div>' +
          '<label class="gf-lab" for="st-form">Form</label><select class="gf-in" id="st-form">' + forms.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.title) + '</option>'; }).join('') + '</select>' +
          '<label class="gf-lab" for="st-period">Period</label><input class="gf-in" id="st-period" type="text" maxlength="60" placeholder="For example 2026 Q4">' +
          '<p class="gf-err" id="st-err" role="alert" hidden></p>' +
          '<div class="gf-bar" style="margin-top:16px"><span></span><div class="r"><button class="btn btn-ghost btn-sm" type="button" data-a="start-back">Cancel</button><button class="btn btn-primary btn-sm" type="button" data-a="start-go" id="st-go">Start</button></div></div></div>'
        : '<div class="gf-card"><div class="gf-qt">There is no open Manager form yet.</div><div class="gf-qd">' + (canBuild() ? 'Create one in the Evaluation forms tab.' : 'Ask Total Rewards to create one.') + '</div></div>') +
      '</div>';
    if ($('#st-cbx', ev.box)) employeePicker(people);
    var fsel = $('#st-form', ev.box);
    if (fsel) {
      var prefill = function () { var c = ev.cards.filter(function (x) { return x.id === fsel.value; })[0]; $('#st-period', ev.box).value = c ? c.period || '' : ''; };
      fsel.addEventListener('change', prefill);
      prefill();
    }
    window.scrollTo(0, 0);
  }

  /* A search box with a dropdown: type part of a name or an employee ID, then pick from the list. */
  function employeePicker(people) {
    var input = $('#st-emp-q', ev.box), list = $('#st-list', ev.box), hidden = $('#st-emp', ev.box), btn = $('#st-cbx-btn', ev.box);
    var shown = [], active = -1;
    function label(p) { return p.full_name + ' (' + p.employee_no + ')'; }
    function mark(text, q) {
      var i = q ? text.toLowerCase().indexOf(q) : -1;
      return i === -1 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
    }
    function draw() {
      var q = input.value.trim().toLowerCase();
      shown = people.filter(function (p) { return !q || p.full_name.toLowerCase().indexOf(q) !== -1 || p.employee_no.toLowerCase().indexOf(q) !== -1; }).slice(0, 60);
      if (active >= shown.length) active = shown.length ? 0 : -1;
      list.innerHTML = shown.length ? shown.map(function (p, i) {
        return '<li role="option" id="st-opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === active) + '"><span>' + mark(p.full_name, q) + '</span><small>' + mark(p.employee_no, q) + '</small></li>';
      }).join('') : '<li class="none">No employee matches that.</li>';
    }
    function open() { draw(); list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
    function choose(i) {
      var p = shown[i];
      if (!p) return;
      hidden.value = p.id;
      input.value = label(p);
      close();
    }
    function move(d) {
      if (list.hidden) open();
      if (!shown.length) return;
      active = (active + d + shown.length) % shown.length;
      draw();
      var el = $('#st-opt-' + active, ev.box);
      if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    }
    input.addEventListener('input', function () { hidden.value = ''; active = input.value.trim() ? 0 : -1; open(); });
    input.addEventListener('focus', function () { input.select(); open(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { if (!list.hidden && active >= 0) { e.preventDefault(); choose(active); } }
      else if (e.key === 'Escape') { close(); }
    });
    list.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var li = e.target.closest('li[data-i]');
      if (li) choose(Number(li.dataset.i));
    });
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); if (list.hidden) { input.focus(); open(); } else close(); });
    input.addEventListener('blur', function () {
      close();
      // text that is not a pick does not count as one
      if (!hidden.value) input.value = input.value.trim() ? input.value : '';
    });
  }

  async function startEval() {
    var err = $('#st-err', ev.box), emp = $('#st-emp', ev.box).value, cid = $('#st-form', ev.box).value, period = $('#st-period', ev.box).value.trim();
    var card = ev.cards.filter(function (c) { return c.id === cid; })[0];
    if (!emp) { err.textContent = 'Pick an employee from the list.'; err.hidden = false; return; }
    if (!period) { err.textContent = 'Enter the period, for example 2026 Q4.'; err.hidden = false; return; }
    err.hidden = true;
    var go = $('#st-go', ev.box);
    go.disabled = true;
    var crit = card.criteria.map(function (c) {
      var t = F.qType(c);
      var sc = Number(c.scale) >= 3 && Number(c.scale) <= 10 ? Number(c.scale) : card.scale_max;
      var q = { id: c.id, type: t, title: c.title, description: c.description || '', weight: F.isScored(t) ? 1 : 0, required: F.isRequired(c), options: F.hasOptions(t) && Array.isArray(c.options) ? c.options : [], rating: null, comment: '', picked: [] };
      if (t === 'rating') { q.scale = sc; q.labels = Array.isArray(c.labels) ? c.labels : (card.labels || []).slice(0, sc); }
      return q;
    });
    var res = await sb.from('evaluations').insert({ employee_id: emp, scorecard_id: card.id, scorecard_title: card.title, period: period, scale_max: card.scale_max, criteria: crit, overall_comment: '', status: 'draft' }).select(COLS).maybeSingle();
    go.disabled = false;
    if (res.error || !res.data) {
      err.textContent = res.error && /duplicate|unique|23505/i.test(res.error.code + ' ' + res.error.message)
        ? 'You already started an evaluation of this employee with this form for this period. Open it from the list.' : "Couldn't start that. You may not have permission.";
      err.hidden = false;
      return;
    }
    var p = person(emp);
    logAction('evaluation.start', (p ? p.employee_no : emp) + ' / ' + period, { id: res.data.id });
    ev.rows.unshift(res.data);
    openEval(res.data);
  }

  /* ---------- filling in or reading one evaluation: a page ---------- */
  function openEval(row) {
    ev.cur = row;
    ev.card = ev.cards.filter(function (c) { return c.id === row.scorecard_id; })[0] || null;
    ev.view = 'eval';
    drawEval();
    window.scrollTo(0, 0);
  }

  function evalCtx() { return { scale_max: ev.cur.scale_max, labels: ev.card && Array.isArray(ev.card.labels) ? ev.card.labels : [] }; }

  function drawEval() {
    var r = ev.cur, p = person(r.employee_id), cat = CATS[r.category] || CATS.manager;
    var ro = !editable(r);
    var by = r.category === 'self' ? 'Self-assessment by the employee' : cat.long + (r.evaluator_name ? ' by ' + r.evaluator_name : '');
    var meta = [p ? p.employee_no : '', r.scorecard_title, r.period, by].filter(Boolean);
    ev.box.innerHTML =
      '<div class="ph">' + IB('back', 'Back to the evaluations', { 'data-a': 'eval-back' }, 'line') + '<div class="ph-main"><h2>' + esc(p ? p.full_name : 'Employee') + '</h2><p class="sub">' + esc(cat.long) + '</p></div></div>' +
      '<div class="gf"><div class="gf-card head"><h1 class="gf-h1">' + esc(r.scorecard_title) + '</h1><div class="gf-meta"><b>' + esc(p ? p.full_name : '') + '</b></div><div class="gf-meta">' + meta.map(esc).join(' · ') + '</div>' +
      '<div class="gf-meta"><span class="gf-chip">' + (r.status === 'final' ? 'Final' : 'Draft') + '</span>' + (r.status === 'final' && r.finalized_at ? '<span>Finalised ' + esc(fmtDay(r.finalized_at)) + '</span>' : '') + '</div></div>' +
      (r.criteria || []).map(function (c, i) { return F.card(c, evalCtx(), ro, i); }).join('') +
      '<div class="gf-card"><div class="gf-qt">Overall comments</div><div class="gf-ans"><textarea id="ee-over" maxlength="3000" rows="3"' + (ro ? ' disabled' : '') + '>' + esc(r.overall_comment || '') + '</textarea></div></div>' +
      '<p class="gf-err" id="ee-err" role="alert" hidden></p>' +
      '<div class="gf-bar"><div class="l"><button class="btn btn-ghost btn-sm" type="button" data-a="eval-back">Close</button><button class="btn btn-ghost btn-sm" type="button" data-a="print">Print or PDF</button>' + (deletable(r) ? '<button class="btn btn-ghost btn-sm" type="button" data-a="del-this">Delete</button>' : '') + '</div><div class="r">' +
      (ro ? (r.status === 'final' && r.category === 'manager' && (r.evaluator_id === myId() || canBuild()) ? '<button class="btn btn-ghost btn-sm" type="button" data-a="reopen">Reopen</button>' : '')
        : '<button class="btn btn-ghost btn-sm" type="button" data-a="save-draft" id="ee-save">Save draft</button><button class="btn btn-primary btn-sm" type="button" data-a="finalise" id="ee-final">Finalise</button>') + '</div></div></div>';
  }

  function readEval() {
    var over = $('#ee-over', ev.box);
    if (over) ev.cur.overall_comment = over.value.trim();
  }

  async function saveEval(finalise) {
    var r = ev.cur, err = $('#ee-err', ev.box);
    readEval();
    if (finalise) {
      var ids = F.missing(r.criteria);
      if (ids.length) { F.markMissing(ev.box, ids); err.textContent = 'Answer every required question before you finalise.'; err.hidden = false; return; }
    }
    err.hidden = true;
    var btns = [$('#ee-save', ev.box), $('#ee-final', ev.box)];
    btns.forEach(function (b) { if (b) b.disabled = true; });
    var res = await sb.from('evaluations').update({ criteria: r.criteria, overall_comment: r.overall_comment, status: finalise ? 'final' : 'draft' }).eq('id', r.id).select(COLS).maybeSingle();
    btns.forEach(function (b) { if (b) b.disabled = false; });
    if (res.error || !res.data) { err.textContent = "Couldn't save that. " + (res.error && res.error.message ? res.error.message : 'You may not have permission.'); err.hidden = false; return; }
    var p = person(r.employee_id);
    logAction(finalise ? 'evaluation.finalise' : 'evaluation.save', (p ? p.employee_no : r.employee_id) + ' / ' + r.period, { id: r.id });
    toast(finalise ? 'Evaluation finalised.' : 'Draft saved.', 'ok');
    await backToEvals();
  }

  async function reopen() {
    var r = ev.cur;
    var ok = await ask({ title: 'Reopen This Evaluation?', text: 'It goes back to a draft so you can change it. This is written to the activity log.', ok: 'Reopen' });
    if (!ok) return;
    var res = await sb.from('evaluations').update({ status: 'draft' }).eq('id', r.id).select(COLS).maybeSingle();
    if (res.error || !res.data) { toast("Couldn't reopen that. You may not have permission.", 'bad'); return; }
    var p = person(r.employee_id);
    logAction('evaluation.reopen', (p ? p.employee_no : r.employee_id) + ' / ' + r.period, { id: r.id });
    toast('Reopened as a draft.', 'ok');
    ev.rows = ev.rows.map(function (x) { return x.id === r.id ? res.data : x; });
    openEval(res.data);
  }

  async function removeEval(r) {
    var p = person(r.employee_id);
    var ok = await ask({ title: 'Delete This Evaluation?', text: 'The ' + (CATS[r.category] || CATS.manager).long.toLowerCase() + (p ? ' of ' + p.full_name : '') + (r.status === 'final' ? ' is finalised. It' : '') + ' will be permanently deleted. This is written to the activity log.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('evaluations').delete().eq('id', r.id).select('id');
    busy('');
    if (res.error || !(res.data || []).length) { toast("Couldn't delete that. " + (res.error && res.error.message ? res.error.message : 'You may not have permission.'), 'bad'); return false; }
    logAction('evaluation.delete', (p ? p.employee_no : r.employee_id) + ' / ' + r.period, { id: r.id });
    toast('Deleted.', 'ok');
    ev.rows = ev.rows.filter(function (x) { return x.id !== r.id; });
    if (ev.view === 'list') await reloadAndDraw();
    return true;
  }

  async function backToEvals() {
    ev.view = 'list';
    ev.tab = 'evals';
    if (ev.mode === 'results') shellResults(); else shellList();
    await reloadAndDraw();
  }

  /* ---------- copies: a spreadsheet of the evaluations, and a printable page for one ---------- */
  function csvCell(v) {
    var t = String(v === null || v === undefined ? '' : v).replace(/\r\n?/g, '\n');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;                 // keep a spreadsheet from running typed text as a formula
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function exportCsv() {
    var list = visibleRows();
    if (!list.length) { toast('Nothing to export.', 'bad'); return; }
    var titles = [];
    list.forEach(function (r) { (r.criteria || []).forEach(function (c) { if (titles.indexOf(c.title) === -1) titles.push(c.title); }); });
    var head = ['Category', 'Employee ID', 'Employee', 'Form', 'Period', 'Status', 'Rating scale (max)', 'Evaluated by', 'Finalised on', 'Overall comments'];
    titles.forEach(function (t) { head.push(t + ' - rating', t + ' - comment'); });
    var lines = [head.map(csvCell).join(',')];
    list.forEach(function (r) {
      var p = person(r.employee_id);
      var row = [(CATS[r.category] || CATS.manager).name, p ? p.employee_no : '', p ? p.full_name : '', r.scorecard_title, r.period, r.status === 'final' ? 'Final' : 'Draft',
        r.scale_max, r.evaluator_name, fmtDay(r.finalized_at), r.overall_comment];
      titles.forEach(function (t) {
        var c = (r.criteria || []).filter(function (x) { return x.title === t; })[0];
        row.push(c && c.rating ? c.rating : '', c ? (F.isScored(F.qType(c)) ? c.comment || '' : F.text(c)) : '');
      });
      lines.push(row.map(csvCell).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sinaglikha-evaluations-' + today() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    logAction('evaluation.export', list.length + (list.length === 1 ? ' evaluation' : ' evaluations'), { rows: list.length });
    toast('Downloaded ' + list.length + (list.length === 1 ? ' evaluation.' : ' evaluations.'), 'ok');
  }

  function printEval(r) {
    var p = person(r.employee_id), card = ev.cards.filter(function (c) { return c.id === r.scorecard_id; })[0] || null, cat = CATS[r.category] || CATS.manager;
    var w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print or save a PDF.', 'bad'); return; }
    var rows = (r.criteria || []).map(function (c) {
      var qt = F.qType(c);
      if (!F.isScored(qt)) return '<tr><td><b>' + esc(c.title) + '</b>' + (c.description ? '<div class="m">' + esc(c.description) + '</div>' : '') + '</td><td colspan="2">' + esc(F.text(c)) + '</td></tr>';
      var mx = F.maxOf(c, { scale_max: r.scale_max }), lab = c.rating && qt === 'rating' ? F.nameOf(c, card || { labels: [] }, Number(c.rating)) : '';
      return '<tr><td><b>' + esc(c.title) + '</b>' + (c.description ? '<div class="m">' + esc(c.description) + '</div>' : '') + '</td>' +
        '<td class="c"><b>' + (c.rating ? esc(c.rating) + ' / ' + esc(mx) : 'Not rated') + '</b>' + (lab ? '<div class="m">' + esc(lab) + '</div>' : '') + '</td><td>' + esc(c.comment || '') + '</td></tr>';
    }).join('');
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Evaluation - ' + esc(p ? p.full_name : '') + ' - ' + esc(r.period) + '</title><style>' +
      'body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#2B1D16;margin:28px}h1{font-size:22px;margin:0 0 2px;color:#4A2E22}h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B3361A;margin:0 0 14px}' +
      '.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 24px;margin:12px 0 16px}.meta span{color:#6B5648;font-size:12px}' +
      'table{width:100%;border-collapse:collapse}th,td{border:1px solid #E6D9C4;padding:7px 9px;vertical-align:top;text-align:left}th{background:#FBF3CB;font-size:12px}.c{text-align:center;white-space:nowrap}.m{color:#6B5648;font-size:12px}' +
      '.over{border:1px solid #E6D9C4;border-radius:8px;padding:10px 12px;margin-top:14px;white-space:pre-wrap}.foot{margin-top:22px;color:#6B5648;font-size:11px}@media print{body{margin:14mm}}</style></head><body>' +
      '<h2>SINAGLIKHA &middot; ' + esc(cat.long) + '</h2><h1>' + esc(p ? p.full_name : 'Employee') + '</h1>' +
      '<div class="meta"><div><span>Employee ID</span><br>' + esc(p ? p.employee_no : '') + '</div><div><span>Period</span><br>' + esc(r.period) + '</div>' +
      '<div><span>Form</span><br>' + esc(r.scorecard_title) + '</div><div><span>' + (r.category === 'self' ? 'Written by' : 'Evaluated by') + '</span><br>' + esc(r.category === 'self' ? 'The employee' : r.evaluator_name || '') + '</div>' +
      '<div><span>Status</span><br>' + (r.status === 'final' ? 'Final' : 'Draft') + '</div><div><span>' + (r.status === 'final' ? 'Finalised on' : 'Last saved') + '</span><br>' + esc(fmtDay(r.status === 'final' ? r.finalized_at : r.updated_at)) + '</div></div>' +
      '<table><thead><tr><th>Question</th><th class="c">Rating</th><th>Comment</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (r.overall_comment ? '<div class="over"><b>Overall comments</b><br>' + esc(r.overall_comment) + '</div>' : '') +
      '<div class="foot">Confidential. Printed ' + esc(fmtDay(new Date().toISOString())) + '.</div></body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 250);
    logAction('evaluation.print', (p ? p.employee_no : r.employee_id) + ' / ' + r.period, { id: r.id });
  }

  /* ---------- clicks ---------- */
  function onClick(e) {
    if (ev.view === 'builder') { builderClick(e); return; }
    var t = e.target.closest('[data-tab]');
    if (t && ev.view === 'list') { ev.tab = t.dataset.tab; drawList(); return; }
    var cat = e.target.closest('[data-cat]');
    if (cat && ev.view === 'list') { ev.cat = cat.dataset.cat; drawList(); return; }
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'back') { ev.ctx.back(); return; }
    if (a === 'new-form') { openBuilder(null); return; }
    if (a === 'new-eval') { openStart(); return; }
    if (a === 'export') { exportCsv(); return; }
    if (a === 'start-back' || a === 'eval-back') { backToEvals(); return; }
    if (a === 'start-go') { startEval(); return; }
    if (a === 'print') { readEval(); printEval(ev.cur); return; }
    if (a === 'save-draft') { saveEval(false); return; }
    if (a === 'finalise') { saveEval(true); return; }
    if (a === 'reopen') { reopen(); return; }
    if (a === 'del-this') { removeEval(ev.cur).then(function (ok) { if (ok) backToEvals(); }); return; }
    var li = e.target.closest('li.lrow'), id = li && li.dataset.id;
    if (!id) return;
    if (ev.tab === 'forms') {
      var c = ev.cards.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      if (a === 'edit-form') openBuilder(c);
      else if (a === 'toggle-form') toggleForm(c);
      else if (a === 'del-form') removeForm(c);
    } else {
      var r = ev.rows.filter(function (x) { return x.id === id; })[0];
      if (!r) return;
      if (a === 'open-eval') openEval(r);
      else if (a === 'del-eval') removeEval(r);
    }
  }

  window.MembersEvaluations = {
    open: async function (box, ctx) {
      ev.box = box;
      ev.ctx = ctx;
      ev.mode = 'pms';
      ev.view = 'list';
      ev.tab = 'evals';
      ev.cat = 'manager';
      ev.q = '';
      shellList();
      box.onclick = onClick;
      box.onchange = onChange;
      bindAnswers(box);
      await load();
      drawList();
    },
    /* Records tab, Evaluation Results: the evaluations of one category (manager, self or peer) */
    openResults: async function (box, category) {
      ev.box = box;
      ev.ctx = null;
      ev.mode = 'results';
      ev.view = 'list';
      ev.tab = 'evals';
      ev.cat = category;
      ev.q = '';
      shellResults();
      box.onclick = onClick;
      box.onchange = onChange;
      bindAnswers(box);
      await load();
      drawList();
    }
  };

  /* the answering controls on an evaluation page: bound once per box, whichever screen hosts it */
  function bindAnswers(box) {
    if (box._efBound) return;
    box._efBound = true;
    F.bind(box, function () { return ev.view === 'eval' && ev.cur ? ev.cur.criteria : []; }, function () { return ev.view === 'eval' && ev.cur ? evalCtx() : { scale_max: 5, labels: [] }; }, function () {});
  }
})();
