/*
  SINAGLIKHA Restricted Records: individual compensation, evaluation results and disciplinary cases.
  The database rules in supabase/restricted_records.sql decide who can see or upload what; this page
  only shows the choices that match them:
    Compensation         see: everyone here   upload: Total Rewards, Administrator
    Evaluation results   see: Total Rewards, Administrator   upload: Total Rewards, Administrator
    Disciplinary cases   see: everyone here   upload: Legal Compliance, Administrator
  Files live in the private "restricted" bucket. Every open, upload and delete is written to the
  activity log. Shares the sign-in, dialogs and toasts of members.js through window.MembersApp.
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var BUCKET = 'restricted';
  var ALLOWED = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|txt|csv)$/i;
  var KINDS = { compensation: 'Compensation', evaluation: 'Evaluation Results', disciplinary: 'Disciplinary Cases' };
  var RULES = {
    compensation: 'Compensation records can be opened by every Senior Manager, and each employee can open their own. Total Rewards uploads them.',
    evaluation: 'Uploaded evaluation files can be opened only by Total Rewards and the Administrator. Employees do not see them. Total Rewards uploads them.',
    disciplinary: 'Disciplinary cases can be opened by every Senior Manager. Employees do not see them. Legal Compliance uploads them.'
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var I = window.SngIcon, IB = window.SngIconButton;
  var rc = { people: [], rows: [], kind: '', evsub: 'manager', ready: false, failed: false, token: 0 };
  var EVSUBS = [['manager', 'Manager'], ['self', 'Self'], ['peer', 'Peer'], ['files', 'Uploaded files']];

  function dept() { return state.profile && state.profile.department; }
  function viewKinds() {
    if (state.isAdmin || dept() === 'rewards') return ['compensation', 'evaluation', 'disciplinary'];
    return ['compensation', 'disciplinary'];
  }
  function uploadKinds() {
    if (state.isAdmin) return ['compensation', 'evaluation', 'disciplinary'];
    if (dept() === 'rewards') return ['compensation', 'evaluation'];
    if (dept() === 'legal') return ['disciplinary'];
    return [];
  }
  function canUpload(kind) { return uploadKinds().indexOf(kind) !== -1; }

  function busy(text) {
    var b = $('#rc-busy');
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function person(id) { return rc.people.filter(function (p) { return p.id === id; })[0] || null; }
  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  async function setup() {
    var res = await sb.rpc('employee_options');
    if (res.error || !Array.isArray(res.data)) { rc.failed = true; rc.people = []; }
    else { rc.failed = false; rc.people = res.data; }
    rc.kind = viewKinds()[0];
    drawKinds();
    $('#rc-add').hidden = !uploadKinds().length;
    rc.ready = !rc.failed;
  }

  function drawKinds() {
    $('#rc-kind').innerHTML = viewKinds().map(function (k) {
      return '<button class="pill" type="button" data-kind="' + k + '" aria-pressed="' + (rc.kind === k) + '">' + KINDS[k] + '</button>';
    }).join('');
    // Evaluation Results: the evaluations written on the site, by category, then the uploaded files
    var sub = $('#rc-evsub');
    sub.hidden = rc.kind !== 'evaluation';
    sub.innerHTML = rc.kind !== 'evaluation' ? '' : EVSUBS.map(function (c) {
      return '<button class="pill" type="button" data-evsub="' + c[0] + '" aria-pressed="' + (rc.evsub === c[0]) + '">' + c[1] + '</button>';
    }).join('');
  }

  async function load() {
    var kind = rc.kind;
    // the evaluations written on the site, by category, are listed by the evaluations module
    var results = kind === 'evaluation' && rc.evsub !== 'files' && !!window.MembersEvaluations;
    $('#rc-eval').hidden = !results;
    $('#rc-list').hidden = results;
    $('#rc-rule').hidden = results;
    $('#rc-search').closest('.ph-actions').hidden = results;
    if (results) {
      rc.token++;
      await window.MembersEvaluations.openResults($('#rc-eval'), rc.evsub);
      return;
    }
    $('#rc-rule').textContent = RULES[kind] || '';
    if (rc.failed) { rc.rows = []; render(); return; }
    var token = ++rc.token;
    busy('Loading…');
    var q = sb.from('restricted_records').select('id,employee_id,kind,title,period,notes,file_path,extra,created_at').eq('kind', kind);
    var res = await q.order('created_at', { ascending: false }).limit(500);
    if (token !== rc.token) return;
    busy('');
    if (res.error) {
      if (/relation|does not exist|schema cache|PGRST/i.test(res.error.message || '') || res.error.code === '42P01') rc.failed = true;
      else toast("Couldn't load the records. " + (res.error.message || ''), 'bad');
      rc.rows = [];
    } else rc.rows = res.data || [];
    render();
  }

  function emptyHtml(icon, title, text) {
    return '<span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p>';
  }

  function render() {
    var kind = rc.kind, q = $('#rc-search').value.trim().toLowerCase();
    var list = rc.rows.filter(function (r) {
      var p = person(r.employee_id);
      return !q || r.title.toLowerCase().indexOf(q) !== -1 || (p && (p.full_name.toLowerCase().indexOf(q) !== -1 || p.employee_no.toLowerCase().indexOf(q) !== -1));
    });
    $('#rc-rows').innerHTML = list.map(function (r) {
      var p = person(r.employee_id);
      var meta = [p ? p.full_name + ' (' + p.employee_no + ')' : 'Unknown employee', r.period, r.extra && r.extra.size ? app.fmtSize(r.extra.size) : '', app.fmtDate(r.created_at)].filter(Boolean).join(' · ');
      return '<li class="lrow" data-id="' + esc(r.id) + '">' +
        '<button class="lmain" type="button" data-act="open" title="Open in a new tab"><span class="lico">' + esc(app.extOf(r.file_path)) + '</span>' +
        '<span class="ltext"><span class="lname">' + esc(r.title) + '</span><span class="lmeta">' + esc(meta) + '</span></span></button>' +
        '<div class="lside"><div class="lacts">' + (canUpload(r.kind) ? IB('trash', 'Delete this record', { 'data-act': 'delete' }, 'danger') : '') + '</div></div></li>';
    }).join('');
    var empty = $('#rc-empty');
    if (rc.failed) {
      empty.innerHTML = emptyHtml('lock', 'Not set up yet', 'Run supabase/restricted_records.sql in the Supabase SQL editor, then reload this page.');
      empty.hidden = false;
    } else if (!rc.rows.length) {
      empty.innerHTML = emptyHtml('lock', 'No ' + (KINDS[kind] || 'records').toLowerCase() + ' yet', canUpload(kind) ? 'Tap ' + I('upload', 'inline') + ' to upload the first one.' : 'Nothing has been uploaded for this type.');
      empty.hidden = false;
    } else if (!list.length) {
      empty.innerHTML = emptyHtml('search', 'Nothing matches', 'Try another search.');
      empty.hidden = false;
    } else empty.hidden = true;
  }

  async function openRecord(r) {
    var w = window.open('', '_blank');
    var res = await sb.storage.from(BUCKET).createSignedUrl(r.file_path, 120);
    if (res.error || !res.data) { if (w) w.close(); toast("Couldn't open that record.", 'bad'); return; }
    var p = person(r.employee_id);
    logAction('record.open', r.kind + '/' + (p ? p.employee_no : r.employee_id), { id: r.id });
    if (w) { w.opener = null; w.location.href = res.data.signedUrl; } else window.location.href = res.data.signedUrl;
  }

  async function removeRecord(r) {
    var p = person(r.employee_id);
    var ok = await ask({
      title: 'Delete This Record?',
      text: '"' + r.title + '"' + (p ? ' for ' + p.full_name : '') + ' will be permanently deleted. This is written to the activity log.',
      ok: 'Delete',
      danger: true
    });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('restricted_records').delete().eq('id', r.id).select('id');
    if (res.error || !(res.data || []).length) { busy(''); toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    await sb.storage.from(BUCKET).remove([r.file_path]);
    busy('');
    logAction('record.delete', r.kind + '/' + (p ? p.employee_no : r.employee_id), { id: r.id });
    toast('Record deleted.', 'ok');
    await load();
  }

  /* ---------- upload ---------- */
  function openUpload() {
    var kinds = uploadKinds();
    if (!kinds.length) return;
    var dlg = $('#rec-dlg'), form = $('#rec-form'), err = $('#rd-err');
    $('#rd-kind').innerHTML = kinds.map(function (k) { return '<option value="' + k + '">' + KINDS[k] + '</option>'; }).join('');
    if (kinds.indexOf(rc.kind) !== -1) $('#rd-kind').value = rc.kind;
    $('#rd-emp').innerHTML = '<option value="">Choose an employee</option>' + rc.people.filter(function (p) { return p.active; }).map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.employee_no + ' - ' + p.full_name) + '</option>';
    }).join('');
    ['#rd-name', '#rd-period', '#rd-notes', '#rd-file'].forEach(function (s) { $(s).value = ''; });
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var kind = $('#rd-kind').value, empId = $('#rd-emp').value, title = $('#rd-name').value.trim();
      var file = $('#rd-file').files[0], problem = '';
      if (!empId) problem = 'Choose the employee.';
      else if (!title) problem = 'Enter a title.';
      else if (!file) problem = 'Choose a file.';
      else if (!ALLOWED.test(file.name)) problem = 'That file type is not allowed. Use PDF, an image, Word, Excel, PowerPoint, text or CSV.';
      else if (file.size > app.maxMb * 1048576) problem = 'That file is over ' + app.maxMb + ' MB.';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      $('#rd-ok').disabled = true;
      var path = kind + '/' + empId + '/' + newId() + '/' + app.cleanName(file.name);
      var up = await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream', cacheControl: '3600' });
      if (up.error) {
        $('#rd-ok').disabled = false;
        err.textContent = "Couldn't upload the file. You may not have permission.";
        err.hidden = false;
        return;
      }
      var ins = await sb.from('restricted_records').insert({
        employee_id: empId, kind: kind, title: title, period: $('#rd-period').value.trim() || null,
        notes: $('#rd-notes').value.trim(), file_path: path, extra: { size: file.size, mime: file.type || null }
      }).select('id').maybeSingle();
      $('#rd-ok').disabled = false;
      if (ins.error || !ins.data) {
        await sb.storage.from(BUCKET).remove([path]);
        err.textContent = "Couldn't save the record. You may not have permission.";
        err.hidden = false;
        return;
      }
      dlg.close();
      var p = person(empId);
      logAction('record.upload', kind + '/' + (p ? p.employee_no : empId), { id: ins.data.id });
      toast('Record uploaded.', 'ok');
      if (viewKinds().indexOf(kind) !== -1) { rc.kind = kind; drawKinds(); }
      await load();
    };
    $('#rd-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
  }

  /* ---------- wiring ---------- */
  $('#rc-kind').addEventListener('click', function (e) {
    var b = e.target.closest('[data-kind]');
    if (!b) return;
    rc.kind = b.dataset.kind;
    drawKinds();
    load();
  });
  $('#rc-evsub').addEventListener('click', function (e) {
    var b = e.target.closest('[data-evsub]');
    if (!b) return;
    rc.evsub = b.dataset.evsub;
    drawKinds();
    load();
  });
  $('#rc-search').addEventListener('input', render);
  $('#rc-add').addEventListener('click', openUpload);
  $('#rc-rows').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]'), li = e.target.closest('li.lrow');
    if (!btn || !li) return;
    var r = rc.rows.filter(function (x) { return x.id === li.dataset.id; })[0];
    if (!r) return;
    if (btn.dataset.act === 'open') openRecord(r);
    else if (btn.dataset.act === 'delete') removeRecord(r);
  });

  window.MembersRecords = {
    /* called each time the Records tab opens */
    open: async function () {
      if (!rc.ready) await setup();
      await load();
    },
    /* called when someone signs out, so the next person starts clean */
    reset: function () {
      rc.people = []; rc.rows = []; rc.ready = false; rc.failed = false;
      $('#rc-rows').innerHTML = '';
      $('#rc-search').value = '';
      $('#rc-kind').innerHTML = '';
    }
  };
})();
