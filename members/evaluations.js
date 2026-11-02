/*
  SINAGLIKHA Performance Management System: evaluation setup.
  Managers keep the links to the external evaluation forms here (self, peer and manager), with
  instructions and an optional open and close date. Employees see only the forms that are switched
  on and open today, on their dashboard in the Employee Portal; each opens in a new tab. The forms
  themselves live in a tool such as Google Forms. Evaluation RESULTS are uploaded in the Records tab.
  The database rules in supabase/phase2.sql let any active manager set these up.
  Opened from the Performance Management System card in the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var KINDS = [['self', 'Self evaluation'], ['peer', 'Peer evaluation'], ['manager', 'Manager evaluation']];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var ev = { box: null, ctx: null, rows: [], failed: false };

  function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function fmt(d) {
    return d ? new Date(d + 'T00:00:00+08:00').toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  }
  function chipOf(r) {
    var t = today();
    if (!r.active) return ['off', 'Hidden'];
    if (r.opens_on && r.opens_on > t) return ['incomplete', 'Opens ' + fmt(r.opens_on)];
    if (r.closes_on && r.closes_on < t) return ['closed', 'Closed'];
    return ['open', 'Open to employees'];
  }
  function busy(text) {
    var b = $('#ev-busy', ev.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }

  function shell() {
    ev.box.innerHTML =
      '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Performance Management System</h2><p class="sub">Evaluation forms for employees</p></div>' +
      '<div class="ph-actions">' + IB('plus', 'Add an evaluation form', { 'data-a': 'add' }, 'solid') + '</div></div>' +
      '<p class="sp-note">Build each form in a tool such as Google Forms, then paste its link here. Employees open it in a new tab from their dashboard while it is switched on and open. Evaluation results are uploaded in the Records tab.</p>' +
      '<div id="ev-list"></div>' +
      '<div class="list-card" id="ev-wrap" style="position:relative"><div class="es" id="ev-empty" hidden></div><div class="busy" id="ev-busy" hidden role="status">Loading…</div></div>';
  }

  async function load() {
    busy('Loading…');
    var res = await sb.from('evaluation_setups').select('*').order('created_at', { ascending: false }).limit(500);
    busy('');
    if (res.error) { ev.failed = true; ev.rows = []; }
    else { ev.failed = false; ev.rows = res.data || []; }
    render();
  }

  function render() {
    var list = $('#ev-list', ev.box), empty = $('#ev-empty', ev.box);
    var html = '';
    KINDS.forEach(function (k) {
      var rows = ev.rows.filter(function (r) { return r.kind === k[0]; });
      if (!rows.length) return;
      html += '<h3 style="font-family:var(--serif);font-weight:400;font-size:1.2rem;margin:6px 4px 8px">' + esc(k[1]) + '</h3><div class="list-card" style="margin-bottom:16px"><ul class="rows">' +
        rows.map(function (r) {
          var c = chipOf(r);
          var meta = [r.opens_on ? 'Opens ' + fmt(r.opens_on) : '', r.closes_on ? 'Closes ' + fmt(r.closes_on) : ''].filter(Boolean).join(' · ') || 'No dates set';
          return '<li class="lrow" data-id="' + esc(r.id) + '"><div class="lmain" style="cursor:default"><span class="lico">' + I('clipboard') + '</span>' +
            '<span class="ltext"><span class="lname">' + esc(r.title) + '</span><span class="lmeta">' + esc(meta) + '</span></span></div>' +
            '<div class="lside"><span class="chip t-' + c[0] + '">' + esc(c[1]) + '</span><div class="lacts">' +
            IB('external', 'Open the form to check it', { 'data-a': 'check' }) +
            IB('pencil', 'Edit', { 'data-a': 'edit' }) +
            (r.active ? IB('eyeOff', 'Hide from employees', { 'data-a': 'toggle' }) : IB('eye', 'Show to employees', { 'data-a': 'toggle' }, 'good')) +
            IB('trash', 'Delete', { 'data-a': 'delete' }, 'danger') + '</div></div></li>';
        }).join('') + '</ul></div>';
    });
    list.innerHTML = html;
    if (ev.failed) {
      empty.innerHTML = '<span class="eic">' + I('clipboard') + '</span><b>Not set up yet</b><p>Run supabase/phase2.sql in the Supabase SQL editor, then reload this page.</p>';
      empty.hidden = false;
    } else if (!ev.rows.length) {
      empty.innerHTML = '<span class="eic">' + I('clipboard') + '</span><b>No evaluation forms yet</b><p>Tap ' + I('plus', 'inline') + ' to add the first one. New forms start hidden until you show them.</p>';
      empty.hidden = false;
    } else empty.hidden = true;
  }

  function openDialog(r) {
    var dlg = $('#ev-dlg'), form = $('#ev-form'), err = $('#ev-err');
    $('#ev-title').textContent = r ? 'Edit Evaluation Form' : 'Add Evaluation Form';
    $('#ev-kind').value = r ? r.kind : 'self';
    $('#ev-name').value = r ? r.title : '';
    $('#ev-url').value = r ? r.url : '';
    $('#ev-inst').value = r ? r.instructions || '' : '';
    $('#ev-opens').value = r ? r.opens_on || '' : '';
    $('#ev-closes').value = r ? r.closes_on || '' : '';
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var title = $('#ev-name').value.trim(), url = $('#ev-url').value.trim();
      var opens = $('#ev-opens').value || null, closes = $('#ev-closes').value || null, problem = '';
      if (!title) problem = 'Enter a title.';
      else if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) problem = 'Enter the full link to the form, starting with https://.';
      else if (opens && closes && closes < opens) problem = 'The closing date is before the opening date.';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      var fields = { kind: $('#ev-kind').value, title: title, url: url, instructions: $('#ev-inst').value.trim(), opens_on: opens, closes_on: closes };
      $('#ev-ok').disabled = true;
      var res = r
        ? await sb.from('evaluation_setups').update(fields).eq('id', r.id).select('id').maybeSingle()
        : await sb.from('evaluation_setups').insert(fields).select('id').maybeSingle();
      $('#ev-ok').disabled = false;
      if (res.error || !res.data) { err.textContent = "Couldn't save that. You may not have permission."; err.hidden = false; return; }
      dlg.close();
      logAction(r ? 'evaluation.edit' : 'evaluation.add', title, { id: res.data.id });
      toast(r ? 'Saved.' : 'Added. It stays hidden until you show it to employees.', 'ok');
      load();
    };
    $('#ev-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#ev-name').focus();
  }

  async function toggle(r) {
    busy('Saving…');
    var res = await sb.from('evaluation_setups').update({ active: !r.active }).eq('id', r.id).select('id').maybeSingle();
    busy('');
    if (res.error || !res.data) { toast("Couldn't save that. You may not have permission.", 'bad'); return; }
    logAction(r.active ? 'evaluation.hide' : 'evaluation.show', r.title, { id: r.id });
    toast(r.active ? 'Hidden from employees.' : 'Employees can see it' + (r.opens_on && r.opens_on > today() ? ' from ' + fmt(r.opens_on) + '.' : ' now.'), 'ok');
    await load();
  }

  async function remove(r) {
    var ok = await ask({ title: 'Delete This Form?', text: '"' + r.title + '" will be removed from the portal. The form itself in your form tool is not touched.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('evaluation_setups').delete().eq('id', r.id).select('id');
    busy('');
    if (res.error || !(res.data || []).length) { toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    logAction('evaluation.delete', r.title, { id: r.id });
    toast('Deleted.', 'ok');
    await load();
  }

  function onClick(e) {
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'back') { ev.ctx.back(); return; }
    if (a === 'add') { openDialog(null); return; }
    var li = e.target.closest('li.lrow'), r = li && ev.rows.filter(function (x) { return x.id === li.dataset.id; })[0];
    if (!r) return;
    if (a === 'edit') openDialog(r);
    else if (a === 'toggle') toggle(r);
    else if (a === 'delete') remove(r);
    else if (a === 'check' && /^https?:\/\//i.test(r.url)) window.open(r.url, '_blank', 'noopener');
  }

  window.MembersEvaluations = {
    open: async function (box, ctx) {
      ev.box = box;
      ev.ctx = ctx;
      shell();
      box.onclick = onClick;
      await load();
    }
  };
})();
