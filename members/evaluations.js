/*
  SINAGLIKHA Performance Management System: scorecards and employee evaluations.
  Total Rewards (and the Administrator) build their own scorecards, each a list of weighted criteria
  rated on a scale such as 1 to 5, then evaluate an employee against a scorecard for a period. An
  evaluation starts as a draft, and is final once every criterion is rated and it is finalised. The
  scorecard is copied into the evaluation when it starts, so editing a scorecard later never changes
  an evaluation already written. Evaluations are private: no other Senior Manager and no employee can
  open them. The database rules in supabase/phase5.sql decide who can do what; this screen only shows
  it. A spreadsheet (CSV) of the evaluations can be downloaded, and one evaluation can be printed or
  saved as a PDF. Both are written to the activity log.
  Opened from the Performance Management System card in the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var DEFAULT_LABELS = ['Needs improvement', 'Below expectations', 'Meets expectations', 'Exceeds expectations', 'Outstanding'];
  var ev = { box: null, ctx: null, tab: 'evals', cards: [], rows: [], people: [], failed: false, q: '' };

  function canEvaluate() { return !!(state.isAdmin || (state.profile && state.profile.department === 'rewards')); }
  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function person(id) { return ev.people.filter(function (p) { return p.id === id; })[0] || null; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function busy(text) {
    var b = $('#ev-busy', ev.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }

  /* The weighted score, as a percentage of the best possible. Same sum as the database; null until every criterion is rated. */
  function scoreOf(criteria, scaleMax) {
    var got = 0, tot = 0, missing = false;
    criteria.forEach(function (c) {
      var w = num(c.weight);
      tot += w;
      if (c.rating === null || c.rating === undefined || c.rating === '') missing = true;
      else got += (num(c.rating) / scaleMax) * w;
    });
    return missing || !tot ? null : Math.round((got / tot) * 1000) / 10;
  }
  function fmtScore(s) { return s === null || s === undefined ? 'Not scored' : String(Number(s)) + '%'; }
  function labelFor(card, n) {
    var l = card && Array.isArray(card.labels) ? card.labels[n - 1] : '';
    return l ? String(l) : '';
  }

  /* ---------- the screen ---------- */
  function shell() {
    ev.box.innerHTML =
      '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Performance Management System</h2><p class="sub">Scorecards and employee evaluations</p></div>' +
      '<div class="ph-actions" id="ev-actions"></div></div>' +
      '<p class="sp-note">Evaluations are private to Total Rewards and the Administrator. Employees and the other Senior Managers cannot open them.</p>' +
      '<div class="pills" id="ev-tabs" role="group" aria-label="Show">' +
      '<button class="pill" type="button" data-tab="evals" aria-pressed="true">Evaluations</button>' +
      '<button class="pill" type="button" data-tab="cards" aria-pressed="false">Scorecards</button></div>' +
      '<div class="list-card" id="ev-wrap" style="position:relative"><ul class="rows" id="ev-rows"></ul><div class="es" id="ev-empty" hidden></div>' +
      '<div class="busy" id="ev-busy" hidden role="status">Loading…</div></div>';
  }

  function drawActions() {
    var a = $('#ev-actions', ev.box);
    if (!canEvaluate()) { a.innerHTML = ''; return; }
    a.innerHTML = ev.tab === 'evals'
      ? '<div class="sbox">' + I('search') + '<input id="ev-search" type="search" placeholder="Search" aria-label="Search by employee, scorecard or period" autocomplete="off" value="' + esc(ev.q) + '"></div>' +
        IB('download', 'Download these evaluations as a spreadsheet', { 'data-a': 'export' }) +
        IB('plus', 'Evaluate an employee', { 'data-a': 'new-eval' }, 'solid')
      : IB('plus', 'Build a new scorecard', { 'data-a': 'new-card' }, 'solid');
    var s = $('#ev-search', ev.box);
    if (s) s.addEventListener('input', function () { ev.q = s.value; render(); });
  }

  async function load() {
    if (!canEvaluate()) { render(); return; }
    busy('Loading…');
    var r = await Promise.all([
      sb.from('scorecards').select('*').order('created_at', { ascending: false }).limit(200),
      sb.from('evaluations').select('id,employee_id,scorecard_id,scorecard_title,period,scale_max,criteria,overall_comment,score,status,evaluator_name,finalized_at,created_at,updated_at').order('updated_at', { ascending: false }).limit(500),
      sb.rpc('employee_options')
    ]);
    busy('');
    ev.failed = !!(r[0].error || r[1].error);
    ev.cards = r[0].error ? [] : r[0].data || [];
    ev.rows = r[1].error ? [] : r[1].data || [];
    ev.people = r[2].error || !Array.isArray(r[2].data) ? [] : r[2].data;
    render();
  }

  function emptyHtml(icon, title, text) { return '<span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p>'; }

  function render() {
    drawActions();
    var rows = $('#ev-rows', ev.box), empty = $('#ev-empty', ev.box);
    $$tabs();
    if (!canEvaluate()) {
      rows.innerHTML = '';
      empty.innerHTML = emptyHtml('lock', 'Total Rewards only', 'Scorecards and evaluations are kept by Total Rewards and the Administrator.');
      empty.hidden = false;
      return;
    }
    if (ev.failed) {
      rows.innerHTML = '';
      empty.innerHTML = emptyHtml('clipboard', 'Not set up yet', 'Run supabase/phase5.sql in the Supabase SQL editor, then reload this page.');
      empty.hidden = false;
      return;
    }
    if (ev.tab === 'cards') {
      rows.innerHTML = ev.cards.map(function (c) {
        var n = Array.isArray(c.criteria) ? c.criteria.length : 0;
        var meta = [n + (n === 1 ? ' criterion' : ' criteria'), 'Rated 1 to ' + c.scale_max, c.active ? '' : 'Hidden'].filter(Boolean).join(' · ');
        return '<li class="lrow" data-id="' + esc(c.id) + '"><div class="lmain" style="cursor:default"><span class="lico">' + I('clipboard') + '</span><span class="ltext"><span class="lname">' +
          esc(c.title) + '</span><span class="lmeta">' + esc(meta) + '</span>' + (c.description ? '<span class="lmeta" style="white-space:normal">' + esc(c.description) + '</span>' : '') + '</span></div>' +
          '<div class="lside"><span class="chip ' + (c.active ? 's-published' : 's-archived') + '">' + (c.active ? 'In use' : 'Hidden') + '</span><div class="lacts">' +
          IB('pencil', 'Edit this scorecard', { 'data-a': 'edit-card' }) +
          (c.active ? IB('eyeOff', 'Hide: stop using it for new evaluations', { 'data-a': 'toggle-card' }) : IB('eye', 'Use it for new evaluations again', { 'data-a': 'toggle-card' }, 'good')) +
          IB('trash', 'Delete this scorecard', { 'data-a': 'del-card' }, 'danger') + '</div></div></li>';
      }).join('');
      if (!ev.cards.length) {
        empty.innerHTML = emptyHtml('clipboard', 'No scorecards yet', 'Tap ' + I('plus', 'inline') + ' to build your first one: a list of criteria and a rating scale.');
        empty.hidden = false;
      } else empty.hidden = true;
      return;
    }
    var list = visibleRows();
    rows.innerHTML = list.map(function (r) {
      var p = person(r.employee_id);
      var meta = [r.scorecard_title, r.period, r.status === 'final' ? fmtScore(r.score) : 'Not finalised', r.evaluator_name ? 'by ' + r.evaluator_name : ''].filter(Boolean).join(' · ');
      return '<li class="lrow" data-id="' + esc(r.id) + '"><button class="lmain" type="button" data-a="open-eval"><span class="lico">' + I('clipboard') + '</span><span class="ltext"><span class="lname">' +
        esc(p ? p.full_name : 'Unknown employee') + (p ? ' (' + esc(p.employee_no) + ')' : '') + '</span><span class="lmeta">' + esc(meta) + '</span></span></button>' +
        '<div class="lside"><span class="chip ' + (r.status === 'final' ? 's-published' : 's-draft') + '">' + (r.status === 'final' ? 'Final' : 'Draft') + '</span><div class="lacts">' +
        (r.status === 'draft' ? IB('trash', 'Delete this draft', { 'data-a': 'del-eval' }, 'danger') : '') + '</div></div></li>';
    }).join('');
    if (!ev.rows.length) {
      empty.innerHTML = emptyHtml('clipboard', 'No evaluations yet', ev.cards.length ? 'Tap ' + I('plus', 'inline') + ' to evaluate an employee.' : 'Build a scorecard first, in the Scorecards tab.');
      empty.hidden = false;
    } else if (!list.length) {
      empty.innerHTML = emptyHtml('search', 'Nothing matches', 'Try another search.');
      empty.hidden = false;
    } else empty.hidden = true;
  }
  function $$tabs() {
    Array.prototype.forEach.call(ev.box.querySelectorAll('[data-tab]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.tab === ev.tab)); });
  }

  /* ---------- building a scorecard ---------- */
  var sc = { id: null, rows: [], labels: [] };

  function drawCriteria() {
    $('#sc-crit').innerHTML = sc.rows.map(function (c, i) {
      return '<li class="crit" data-i="' + i + '"><div class="crit-top"><span class="crit-n">' + (i + 1) + '</span>' +
        '<input class="c-title" type="text" maxlength="160" placeholder="Criterion, for example Quality of work" value="' + esc(c.title) + '" aria-label="Criterion ' + (i + 1) + ' title">' +
        '<input class="c-weight" type="number" min="1" max="100" step="1" value="' + esc(c.weight) + '" aria-label="Weight for criterion ' + (i + 1) + '" title="Weight: how much it counts">' +
        '<div class="crit-acts">' + (i > 0 ? IB('arrowUp', 'Move up', { 'data-c': 'up' }) : '') + (i < sc.rows.length - 1 ? IB('arrowDown', 'Move down', { 'data-c': 'down' }) : '') +
        IB('x', 'Remove this criterion', { 'data-c': 'rm' }, 'danger') + '</div></div>' +
        '<input class="c-desc" type="text" maxlength="400" placeholder="What good looks like (optional)" value="' + esc(c.description) + '" aria-label="Description for criterion ' + (i + 1) + '"></li>';
    }).join('');
    var tot = sc.rows.reduce(function (a, c) { return a + num(c.weight); }, 0);
    $('#sc-total').textContent = 'Weights add up to ' + tot + '. They need not total 100: the score is worked out in proportion.';
  }
  function readCriteria() {
    Array.prototype.forEach.call($('#sc-crit').children, function (li, i) {
      var c = sc.rows[i];
      if (!c) return;
      c.title = $('.c-title', li).value;
      c.weight = $('.c-weight', li).value;
      c.description = $('.c-desc', li).value;
    });
  }
  function drawLabels() {
    var n = Number($('#sc-scale').value);
    var html = '';
    for (var i = 1; i <= n; i++) {
      html += '<div class="lbl"><span>' + i + '</span><input type="text" maxlength="40" data-l="' + (i - 1) + '" value="' + esc(sc.labels[i - 1] || '') + '" placeholder="Level ' + i + ' (optional)" aria-label="Name for rating ' + i + '"></div>';
    }
    $('#sc-labels').innerHTML = html;
  }
  function readLabels() {
    Array.prototype.forEach.call($('#sc-labels').querySelectorAll('input'), function (inp) { sc.labels[Number(inp.dataset.l)] = inp.value.trim(); });
  }

  function openCard(c) {
    var dlg = $('#sc-dlg'), form = $('#sc-form'), err = $('#sc-err');
    sc.id = c ? c.id : null;
    sc.rows = c ? c.criteria.map(function (x) { return { id: x.id || newId(), title: x.title || '', description: x.description || '', weight: x.weight || 10 }; })
      : [{ id: newId(), title: '', description: '', weight: 20 }, { id: newId(), title: '', description: '', weight: 20 }];
    sc.labels = c ? (c.labels || []).slice() : DEFAULT_LABELS.slice();
    $('#sc-heading').textContent = c ? 'Edit Scorecard' : 'New Scorecard';
    $('#sc-name').value = c ? c.title : '';
    $('#sc-desc').value = c ? c.description || '' : '';
    $('#sc-scale').value = c ? String(c.scale_max) : '5';
    err.hidden = true;
    drawLabels();
    drawCriteria();
    $('#sc-note').hidden = !c;
    $('#sc-scale').onchange = function () { readLabels(); drawLabels(); };
    $('#sc-add').onclick = function () { readCriteria(); if (sc.rows.length >= 30) return; sc.rows.push({ id: newId(), title: '', description: '', weight: 20 }); drawCriteria(); };
    $('#sc-crit').oninput = function (e) {
      if (e.target.classList.contains('c-weight')) { readCriteria(); var tot = sc.rows.reduce(function (a, x) { return a + num(x.weight); }, 0); $('#sc-total').textContent = 'Weights add up to ' + tot + '. They need not total 100: the score is worked out in proportion.'; }
    };
    $('#sc-crit').onclick = function (e) {
      var b = e.target.closest('[data-c]');
      if (!b) return;
      readCriteria();
      var i = Number(b.closest('li').dataset.i), k = b.dataset.c;
      if (k === 'rm') { if (sc.rows.length > 1) sc.rows.splice(i, 1); }
      else if (k === 'up' && i > 0) sc.rows.splice(i - 1, 0, sc.rows.splice(i, 1)[0]);
      else if (k === 'down' && i < sc.rows.length - 1) sc.rows.splice(i + 1, 0, sc.rows.splice(i, 1)[0]);
      drawCriteria();
    };
    form.onsubmit = async function (e) {
      e.preventDefault();
      readCriteria();
      readLabels();
      var title = $('#sc-name').value.trim(), scale = Number($('#sc-scale').value), problem = '';
      var crit = sc.rows.map(function (x) { return { id: x.id, title: String(x.title).trim(), description: String(x.description).trim(), weight: num(x.weight) }; });
      if (!title) problem = 'Give the scorecard a name.';
      else if (crit.some(function (x) { return !x.title; })) problem = 'Every criterion needs a title. Remove any empty ones.';
      else if (crit.some(function (x) { return x.weight < 1 || x.weight > 100; })) problem = 'Each weight must be between 1 and 100.';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      var fields = { title: title, description: $('#sc-desc').value.trim(), scale_max: scale, labels: sc.labels.slice(0, scale).map(function (l) { return l || ''; }), criteria: crit };
      $('#sc-ok').disabled = true;
      var res = c
        ? await sb.from('scorecards').update(fields).eq('id', c.id).select('id').maybeSingle()
        : await sb.from('scorecards').insert(Object.assign({ active: true }, fields)).select('id').maybeSingle();
      $('#sc-ok').disabled = false;
      if (res.error || !res.data) { err.textContent = "Couldn't save that. " + (res.error && res.error.message ? res.error.message : 'You may not have permission.'); err.hidden = false; return; }
      dlg.close();
      logAction(c ? 'scorecard.edit' : 'scorecard.add', title, { id: res.data.id });
      toast(c ? 'Saved. Evaluations already written keep their own copy.' : 'Scorecard saved. You can evaluate with it now.', 'ok');
      load();
    };
    $('#sc-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#sc-name').focus();
  }

  async function toggleCard(c) {
    busy('Saving…');
    var res = await sb.from('scorecards').update({ active: !c.active }).eq('id', c.id).select('id').maybeSingle();
    busy('');
    if (res.error || !res.data) { toast("Couldn't save that. You may not have permission.", 'bad'); return; }
    logAction(c.active ? 'scorecard.hide' : 'scorecard.show', c.title, { id: c.id });
    await load();
  }
  async function removeCard(c) {
    var ok = await ask({ title: 'Delete This Scorecard?', text: '"' + c.title + '" will be deleted. Evaluations already written with it are kept in full.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('scorecards').delete().eq('id', c.id).select('id');
    busy('');
    if (res.error || !(res.data || []).length) { toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    logAction('scorecard.delete', c.title, { id: c.id });
    toast('Deleted.', 'ok');
    await load();
  }

  /* ---------- evaluating an employee ---------- */
  var ee = { row: null, card: null };

  function openEval(row) {
    var dlg = $('#ee-dlg');
    ee.row = row || null;
    if (row) { ee.card = ev.cards.filter(function (c) { return c.id === row.scorecard_id; })[0] || null; drawEditor(); }
    else drawSetup();
    if (!dlg.open) dlg.showModal();
  }

  function drawSetup() {
    var people = ev.people.filter(function (p) { return p.active; });
    var cards = ev.cards.filter(function (c) { return c.active; });
    var body = $('#ee-body');
    if (!cards.length) {
      body.innerHTML = '<h2>Evaluate an Employee</h2><p class="fine">Build a scorecard first. Open the Scorecards tab and tap the plus.</p><div class="actions"><button class="btn btn-ghost btn-sm" type="button" id="ee-close">Close</button></div>';
      $('#ee-close').onclick = function () { $('#ee-dlg').close(); };
      return;
    }
    body.innerHTML = '<h2>Evaluate an Employee</h2>' +
      '<div class="field"><label for="ee-emp">Employee</label><select id="ee-emp"><option value="">Choose an employee</option>' +
      people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.full_name) + ' (' + esc(p.employee_no) + ')</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="ee-card">Scorecard</label><select id="ee-card">' + cards.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.title) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="ee-period">Period</label><input id="ee-period" type="text" maxlength="60" autocomplete="off" placeholder="For example 2026 Q4"></div>' +
      '<p class="msg bad" id="ee-err" role="alert" hidden></p>' +
      '<div class="actions"><button class="btn btn-ghost btn-sm" type="button" id="ee-close">Cancel</button><button class="btn btn-primary btn-sm" type="button" id="ee-start">Start</button></div>';
    $('#ee-close').onclick = function () { $('#ee-dlg').close(); };
    $('#ee-start').onclick = async function () {
      var err = $('#ee-err'), emp = $('#ee-emp').value, cid = $('#ee-card').value, period = $('#ee-period').value.trim();
      var card = ev.cards.filter(function (c) { return c.id === cid; })[0];
      if (!emp) { err.textContent = 'Choose an employee.'; err.hidden = false; return; }
      if (!period) { err.textContent = 'Enter the period, for example 2026 Q4.'; err.hidden = false; return; }
      err.hidden = true;
      $('#ee-start').disabled = true;
      var crit = card.criteria.map(function (c) { return { id: c.id, title: c.title, description: c.description || '', weight: c.weight, rating: null, comment: '' }; });
      var res = await sb.from('evaluations').insert({ employee_id: emp, scorecard_id: card.id, scorecard_title: card.title, period: period, scale_max: card.scale_max, criteria: crit, overall_comment: '', status: 'draft' })
        .select('id,employee_id,scorecard_id,scorecard_title,period,scale_max,criteria,overall_comment,score,status,evaluator_name,finalized_at,created_at,updated_at').maybeSingle();
      $('#ee-start').disabled = false;
      if (res.error || !res.data) {
        err.textContent = res.error && /duplicate|unique|23505/i.test(res.error.code + ' ' + res.error.message)
          ? 'That employee already has an evaluation with this scorecard for this period. Open it from the list.' : "Couldn't start that. You may not have permission.";
        err.hidden = false;
        return;
      }
      logAction('evaluation.start', (person(emp) ? person(emp).employee_no : emp) + ' / ' + period, { id: res.data.id });
      ee.row = res.data;
      ee.card = card;
      ev.rows.unshift(res.data);
      render();
      drawEditor();
    };
  }

  function drawEditor() {
    var r = ee.row, p = person(r.employee_id), final = r.status === 'final';
    var rows = (r.criteria || []).map(function (c, i) {
      var scale = '';
      for (var n = 1; n <= r.scale_max; n++) {
        scale += '<button class="rt" type="button" data-n="' + n + '" aria-pressed="' + (Number(c.rating) === n) + '"' + (final ? ' disabled' : '') + ' title="' + esc(labelFor(ee.card, n)) + '">' + n + '</button>';
      }
      return '<li class="ecrit" data-i="' + i + '"><div class="ec-h"><b>' + esc(c.title) + '</b><span class="ec-w">Weight ' + esc(c.weight) + '</span></div>' +
        (c.description ? '<p class="fine">' + esc(c.description) + '</p>' : '') +
        '<div class="rts" role="group" aria-label="Rating for ' + esc(c.title) + '">' + scale + '</div>' +
        '<div class="ec-l">' + esc(c.rating ? labelFor(ee.card, Number(c.rating)) : '') + '</div>' +
        '<textarea class="ec-c" maxlength="1000" rows="2" placeholder="Comment (optional)"' + (final ? ' disabled' : '') + '>' + esc(c.comment || '') + '</textarea></li>';
    }).join('');
    $('#ee-body').innerHTML = '<h2>' + esc(p ? p.full_name : 'Employee') + '</h2><p class="fine" style="margin:-6px 0 12px">' +
      esc([p ? p.employee_no : '', r.scorecard_title, r.period].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="ee-score" id="ee-score"></div><ul class="ecrits" id="ee-crit">' + rows + '</ul>' +
      '<div class="field"><label for="ee-over">Overall comments</label><textarea id="ee-over" maxlength="3000" rows="4"' + (final ? ' disabled' : '') + '>' + esc(r.overall_comment || '') + '</textarea></div>' +
      '<p class="msg bad" id="ee-err" role="alert" hidden></p>' +
      '<div class="actions"><button class="btn btn-ghost btn-sm" type="button" id="ee-close">Close</button><button class="btn btn-ghost btn-sm" type="button" id="ee-print">Print or PDF</button>' +
      (final ? '<button class="btn btn-ghost btn-sm" type="button" id="ee-reopen">Reopen</button>'
        : '<button class="btn btn-ghost btn-sm" type="button" id="ee-save">Save draft</button><button class="btn btn-primary btn-sm" type="button" id="ee-final">Finalise</button>') + '</div>';
    paintScore();
    $('#ee-close').onclick = function () { $('#ee-dlg').close(); };
    $('#ee-print').onclick = function () { if (!final) readEditor(); printEval(r); };
    if (final) {
      $('#ee-reopen').onclick = reopen;
      return;
    }
    $('#ee-crit').onclick = function (e) {
      var b = e.target.closest('.rt');
      if (!b) return;
      var li = b.closest('.ecrit'), i = Number(li.dataset.i), n = Number(b.dataset.n);
      readEditor();
      r.criteria[i].rating = Number(r.criteria[i].rating) === n ? null : n;
      Array.prototype.forEach.call(li.querySelectorAll('.rt'), function (x) { x.setAttribute('aria-pressed', String(Number(x.dataset.n) === Number(r.criteria[i].rating))); });
      $('.ec-l', li).textContent = r.criteria[i].rating ? labelFor(ee.card, Number(r.criteria[i].rating)) : '';
      paintScore();
    };
    $('#ee-save').onclick = function () { save(false); };
    $('#ee-final').onclick = function () { save(true); };
  }

  function readEditor() {
    var r = ee.row;
    Array.prototype.forEach.call($('#ee-crit').children, function (li, i) { r.criteria[i].comment = $('.ec-c', li).value.trim(); });
    r.overall_comment = $('#ee-over').value.trim();
  }
  function paintScore() {
    var r = ee.row, rated = r.criteria.filter(function (c) { return c.rating; }).length;
    var s = scoreOf(r.criteria, r.scale_max);
    $('#ee-score').innerHTML = '<b>' + (s === null ? 'Not scored yet' : s + '%') + '</b><span>' + rated + ' of ' + r.criteria.length + ' rated' + (r.status === 'final' ? ' · Final' : ' · Draft') + '</span>';
  }

  async function save(finalise) {
    var r = ee.row, err = $('#ee-err');
    readEditor();
    if (finalise && r.criteria.some(function (c) { return !c.rating; })) { err.textContent = 'Rate every criterion before you finalise.'; err.hidden = false; return; }
    err.hidden = true;
    var btns = [$('#ee-save'), $('#ee-final')];
    btns.forEach(function (b) { b.disabled = true; });
    var res = await sb.from('evaluations').update({ criteria: r.criteria, overall_comment: r.overall_comment, status: finalise ? 'final' : 'draft' })
      .eq('id', r.id).select('id,employee_id,scorecard_id,scorecard_title,period,scale_max,criteria,overall_comment,score,status,evaluator_name,finalized_at,created_at,updated_at').maybeSingle();
    btns.forEach(function (b) { b.disabled = false; });
    if (res.error || !res.data) { err.textContent = "Couldn't save that. " + (res.error && res.error.message ? res.error.message : 'You may not have permission.'); err.hidden = false; return; }
    var p = person(r.employee_id);
    logAction(finalise ? 'evaluation.finalise' : 'evaluation.save', (p ? p.employee_no : r.employee_id) + ' / ' + r.period, { id: r.id });
    toast(finalise ? 'Evaluation finalised.' : 'Draft saved.', 'ok');
    $('#ee-dlg').close();
    load();
  }

  async function reopen() {
    var r = ee.row;
    var ok = await ask({ title: 'Reopen This Evaluation?', text: 'It goes back to a draft so you can change it. This is written to the activity log.', ok: 'Reopen' });
    if (!ok) return;
    var res = await sb.from('evaluations').update({ status: 'draft' }).eq('id', r.id).select('id').maybeSingle();
    if (res.error || !res.data) { toast("Couldn't reopen that. You may not have permission.", 'bad'); return; }
    var p = person(r.employee_id);
    logAction('evaluation.reopen', (p ? p.employee_no : r.employee_id) + ' / ' + r.period, { id: r.id });
    toast('Reopened as a draft.', 'ok');
    $('#ee-dlg').close();
    load();
  }

  async function removeEval(r) {
    var p = person(r.employee_id);
    var ok = await ask({ title: 'Delete This Draft?', text: 'The draft evaluation' + (p ? ' for ' + p.full_name : '') + ' will be deleted. A finalised evaluation cannot be deleted.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('evaluations').delete().eq('id', r.id).select('id');
    busy('');
    if (res.error || !(res.data || []).length) { toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    logAction('evaluation.delete', (p ? p.employee_no : r.employee_id) + ' / ' + r.period, { id: r.id });
    toast('Deleted.', 'ok');
    await load();
  }

  /* ---------- copies: a spreadsheet of the evaluations, and a printable page for one ---------- */
  function fmtDay(iso) {
    return iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  }
  function csvCell(v) {
    var t = String(v === null || v === undefined ? '' : v).replace(/\r\n?/g, '\n');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;                 // keep a spreadsheet from running typed text as a formula
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function visibleRows() {
    var q = ev.q.trim().toLowerCase();
    return ev.rows.filter(function (r) {
      var p = person(r.employee_id);
      return !q || (p && (p.full_name.toLowerCase().indexOf(q) !== -1 || p.employee_no.toLowerCase().indexOf(q) !== -1)) ||
        r.scorecard_title.toLowerCase().indexOf(q) !== -1 || r.period.toLowerCase().indexOf(q) !== -1;
    });
  }
  function exportCsv() {
    var list = visibleRows();
    if (!list.length) { toast('Nothing to export.', 'bad'); return; }
    var titles = [];
    list.forEach(function (r) { (r.criteria || []).forEach(function (c) { if (titles.indexOf(c.title) === -1) titles.push(c.title); }); });
    var head = ['Employee ID', 'Employee', 'Scorecard', 'Period', 'Status', 'Score (%)', 'Rating scale (max)', 'Evaluated by', 'Finalised on', 'Overall comments'];
    titles.forEach(function (t) { head.push(t + ' - rating', t + ' - comment'); });
    var lines = [head.map(csvCell).join(',')];
    list.forEach(function (r) {
      var p = person(r.employee_id);
      var row = [p ? p.employee_no : '', p ? p.full_name : '', r.scorecard_title, r.period, r.status === 'final' ? 'Final' : 'Draft',
        r.score === null || r.score === undefined ? '' : r.score, r.scale_max, r.evaluator_name, fmtDay(r.finalized_at), r.overall_comment];
      titles.forEach(function (t) {
        var c = (r.criteria || []).filter(function (x) { return x.title === t; })[0];
        row.push(c && c.rating ? c.rating : '', c ? c.comment || '' : '');
      });
      lines.push(row.map(csvCell).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sinaglikha-evaluations-' + new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    logAction('evaluation.export', list.length + (list.length === 1 ? ' evaluation' : ' evaluations'), { rows: list.length });
    toast('Downloaded ' + list.length + (list.length === 1 ? ' evaluation.' : ' evaluations.'), 'ok');
  }

  function printEval(r) {
    var p = person(r.employee_id), card = ev.cards.filter(function (c) { return c.id === r.scorecard_id; })[0] || null;
    var w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print or save a PDF.', 'bad'); return; }
    var rows = (r.criteria || []).map(function (c) {
      var lab = c.rating ? labelFor(card, Number(c.rating)) : '';
      return '<tr><td><b>' + esc(c.title) + '</b>' + (c.description ? '<div class="m">' + esc(c.description) + '</div>' : '') + '</td><td class="c">' + esc(c.weight) + '</td>' +
        '<td class="c"><b>' + (c.rating ? esc(c.rating) + ' / ' + esc(r.scale_max) : 'Not rated') + '</b>' + (lab ? '<div class="m">' + esc(lab) + '</div>' : '') + '</td><td>' + esc(c.comment || '') + '</td></tr>';
    }).join('');
    var score = r.status === 'final' ? fmtScore(r.score) : 'Draft: ' + (r.score === null || r.score === undefined ? 'not scored' : r.score + '% so far');
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Evaluation - ' + esc(p ? p.full_name : '') + ' - ' + esc(r.period) + '</title><style>' +
      'body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#2B1D16;margin:28px}h1{font-size:22px;margin:0 0 2px;color:#4A2E22}h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B3361A;margin:0 0 14px}' +
      '.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 24px;margin:12px 0 16px}.meta span{color:#6B5648;font-size:12px}.score{display:inline-block;background:#FFF6DC;border:1px solid #E9C77A;border-radius:10px;padding:8px 14px;font-size:18px;margin:4px 0 14px}' +
      'table{width:100%;border-collapse:collapse}th,td{border:1px solid #E6D9C4;padding:7px 9px;vertical-align:top;text-align:left}th{background:#FBF3CB;font-size:12px}.c{text-align:center;white-space:nowrap}.m{color:#6B5648;font-size:12px}' +
      '.over{border:1px solid #E6D9C4;border-radius:8px;padding:10px 12px;margin-top:14px;white-space:pre-wrap}.foot{margin-top:22px;color:#6B5648;font-size:11px}@media print{body{margin:14mm}}</style></head><body>' +
      '<h2>SINAGLIKHA &middot; Performance Evaluation</h2><h1>' + esc(p ? p.full_name : 'Employee') + '</h1>' +
      '<div class="meta"><div><span>Employee ID</span><br>' + esc(p ? p.employee_no : '') + '</div><div><span>Period</span><br>' + esc(r.period) + '</div>' +
      '<div><span>Scorecard</span><br>' + esc(r.scorecard_title) + '</div><div><span>Evaluated by</span><br>' + esc(r.evaluator_name || '') + '</div>' +
      '<div><span>Status</span><br>' + (r.status === 'final' ? 'Final' : 'Draft') + '</div><div><span>' + (r.status === 'final' ? 'Finalised on' : 'Last saved') + '</span><br>' + esc(fmtDay(r.status === 'final' ? r.finalized_at : r.updated_at)) + '</div></div>' +
      '<div class="score"><b>Score: ' + esc(score) + '</b></div>' +
      '<table><thead><tr><th>Criterion</th><th class="c">Weight</th><th class="c">Rating</th><th>Comment</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (r.overall_comment ? '<div class="over"><b>Overall comments</b><br>' + esc(r.overall_comment) + '</div>' : '') +
      '<div class="foot">Confidential. Kept by Total Rewards. Printed ' + esc(fmtDay(new Date().toISOString())) + '.</div></body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 250);
    logAction('evaluation.print', (p ? p.employee_no : r.employee_id) + ' / ' + r.period, { id: r.id });
  }

  /* ---------- clicks ---------- */
  function onClick(e) {
    var t = e.target.closest('[data-tab]');
    if (t) { ev.tab = t.dataset.tab; render(); return; }
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'back') { ev.ctx.back(); return; }
    if (a === 'new-card') { openCard(null); return; }
    if (a === 'new-eval') { openEval(null); return; }
    if (a === 'export') { exportCsv(); return; }
    var li = e.target.closest('li.lrow'), id = li && li.dataset.id;
    if (!id) return;
    if (ev.tab === 'cards') {
      var c = ev.cards.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      if (a === 'edit-card') openCard(c);
      else if (a === 'toggle-card') toggleCard(c);
      else if (a === 'del-card') removeCard(c);
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
      ev.tab = 'evals';
      ev.q = '';
      shell();
      box.onclick = onClick;
      await load();
    }
  };
})();
