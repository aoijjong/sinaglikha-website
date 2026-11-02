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
    compensation: 'Compensation records can be opened by every Senior Manager and the Administrator, and each employee can open their own. Total Rewards uploads them.',
    evaluation: 'Evaluation results can be opened only by Total Rewards and the Administrator. Employees do not see them. Total Rewards uploads them.',
    disciplinary: 'Disciplinary cases can be opened by every Senior Manager and the Administrator. Employees do not see them. Legal Compliance uploads them.'
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var rc = { people: [], rows: [], ready: false, failed: false, token: 0 };

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
    var kinds = viewKinds();
    $('#rc-kind').innerHTML = kinds.map(function (k) { return '<option value="' + k + '">' + KINDS[k] + '</option>'; }).join('');
    $('#rc-emp').innerHTML = '<option value="">All employees</option>' + rc.people.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.employee_no + ' - ' + p.full_name + (p.active ? '' : ' (inactive)')) + '</option>';
    }).join('');
    $('#rc-add').hidden = !uploadKinds().length;
    rc.ready = !rc.failed;
  }

  async function load() {
    var kind = $('#rc-kind').value;
    $('#rc-rule').textContent = RULES[kind] || '';
    if (rc.failed) { rc.rows = []; render(); return; }
    var token = ++rc.token;
    busy('Loading…');
    var q = sb.from('restricted_records').select('id,employee_id,kind,title,period,notes,file_path,extra,created_at').eq('kind', kind);
    if ($('#rc-emp').value) q = q.eq('employee_id', $('#rc-emp').value);
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

  function render() {
    var kind = $('#rc-kind').value, q = $('#rc-search').value.trim().toLowerCase();
    var list = rc.rows.filter(function (r) {
      var p = person(r.employee_id);
      return !q || r.title.toLowerCase().indexOf(q) !== -1 || (p && (p.full_name.toLowerCase().indexOf(q) !== -1 || p.employee_no.toLowerCase().indexOf(q) !== -1));
    });
    $('#rc-rows').innerHTML = list.map(function (r) {
      var p = person(r.employee_id);
      var meta = [p ? p.full_name + ' (' + p.employee_no + ')' : 'Unknown employee', r.period, r.extra && r.extra.size ? app.fmtSize(r.extra.size) : '', app.fmtDate(r.created_at)].filter(Boolean).join(' · ');
      return '<li class="row cm-row" data-id="' + esc(r.id) + '">' +
        '<button class="row-main" type="button" data-act="open" title="Open in a new tab"><span class="ico">' + esc(app.extOf(r.file_path)) + '</span>' +
        '<span class="row-text"><span class="row-name">' + esc(r.title) + '</span><span class="row-meta">' + esc(meta) + '</span></span></button>' +
        '<div class="cm-side"><span class="chip k-' + esc(r.kind) + '">' + esc(KINDS[r.kind] || r.kind) + '</span>' +
        '<div class="cm-acts">' + (canUpload(r.kind) ? '<button class="btn btn-ghost" type="button" data-act="delete">Delete</button>' : '') + '</div></div></li>';
    }).join('');
    var empty = $('#rc-empty');
    if (rc.failed) {
      empty.textContent = "Restricted Records aren't set up in the database yet. Run supabase/restricted_records.sql in the Supabase SQL editor.";
      empty.hidden = false;
    } else if (!rc.rows.length) {
      empty.textContent = 'No ' + (KINDS[kind] || 'records').toLowerCase() + ' records yet.' + (canUpload(kind) ? ' Use Upload Record to add one.' : '');
      empty.hidden = false;
    } else if (!list.length) {
      empty.textContent = 'Nothing matches.';
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
    if (kinds.indexOf($('#rc-kind').value) !== -1) $('#rd-kind').value = $('#rc-kind').value;
    $('#rd-emp').innerHTML = '<option value="">Choose an employee</option>' + rc.people.filter(function (p) { return p.active; }).map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.employee_no + ' - ' + p.full_name) + '</option>';
    }).join('');
    if ($('#rc-emp').value) $('#rd-emp').value = $('#rc-emp').value;
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
      if ($('#rc-kind').value !== kind) $('#rc-kind').value = kind;
      await load();
    };
    $('#rd-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
  }

  /* ---------- wiring ---------- */
  $('#rc-kind').addEventListener('change', load);
  $('#rc-emp').addEventListener('change', load);
  $('#rc-search').addEventListener('input', render);
  $('#rc-add').addEventListener('click', openUpload);
  $('#rc-rows').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]'), li = e.target.closest('li.row');
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
