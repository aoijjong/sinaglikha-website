/*
  SINAGLIKHA Recruitment and Selection Records: one library for the documents of the hiring process
  (interview schedules, interview rating forms, work sample ratings, selection results and placement
  records). The Senior Managers upload the official documents themselves; nothing is generated here.
  The files live in the PRIVATE "recruitment" bucket and open only through short-lived links made for the
  signed-in person. The database rules in supabase/recruitment.sql allow only the Administrator and the
  Staffing and Recruitment Senior Manager to read or change any of it; this screen only shows that.
  Opened from the Recruitment and Selection Records row of the Staffing panel in the Content tab.
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var BUCKET = 'recruitment';
  var MAX_MB = 15;
  var ALLOWED = /\.(pdf|docx?|xlsx?|csv|txt|png|jpe?g|webp)$/i;
  var VIEWABLE = /\.(pdf|png|jpe?g|webp|txt)$/i;
  var CATS = [['interview_schedule', 'Interview Schedules'], ['interview_rating', 'Interview Rating Forms'], ['work_sample', 'Work Sample Ratings'], ['selection_result', 'Selection Results'], ['placement', 'Placement Records']];
  var CAT = {};
  CATS.forEach(function (c) { CAT[c[0]] = c[1]; });
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var D = { box: null, ctx: null, rows: [], vacancies: [], failed: false, q: '', cat: 'all', from: '', to: '', pos: '' };

  function canManage() { return state.isAdmin || (state.profile && state.profile.department === 'staffing'); }
  function busy(text) {
    var b = $('#rd-busy', D.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toUpperCase() : 'FILE'; }
  function vacancyTitle(id) { var v = D.vacancies.filter(function (x) { return x.id === id; })[0]; return v ? v.title : ''; }

  /* ---------- the list ---------- */
  function shell() {
    D.box.style.position = 'relative';
    D.box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Recruitment and Selection Records</h2><p class="sub">Private: only Staffing and Recruitment can open these</p></div>' +
      '<div class="ph-actions"><div class="sbox">' + I('search') + '<input id="rd-q" type="search" placeholder="Search" aria-label="Search documents" autocomplete="off"></div>' +
      IB('upload', 'Upload a document', { 'data-a': 'add' }, 'solid') + '</div></div>' +
      '<div class="pills" id="rd-pills" role="group" aria-label="Category"></div>' +
      '<div class="fl-row"><select id="rd-pos" class="fl-pill" aria-label="Filter by position"></select>' +
      '<span class="fl-dates"><label class="fl-date"><span>From</span><input id="rd-from" type="date" aria-label="Uploaded from"></label>' +
      '<label class="fl-date"><span>To</span><input id="rd-to" type="date" aria-label="Uploaded to"></label></span>' +
      '<button class="fl-clear" type="button" id="rd-clear" data-a="clear" hidden>Clear filters</button></div>' +
      '<div class="list-card"><ul class="rows" id="rd-rows"></ul><div class="es" id="rd-empty" hidden></div></div>' +
      '<div class="busy" id="rd-busy" hidden role="status">Loading…</div>' +
      '<p class="fine">These files never show on Careers or to other employees.</p>';
  }

  async function load() {
    busy('Loading…');
    var res = await Promise.all([
      sb.from('recruitment_documents').select('*').order('created_at', { ascending: false }).limit(1000),
      sb.from('vacancies').select('id,title').order('title', { ascending: true }).limit(500)
    ]);
    busy('');
    D.failed = !!res[0].error;
    D.rows = res[0].error ? [] : res[0].data || [];
    D.vacancies = res[1].error ? [] : res[1].data || [];
    render();
  }

  function dayOf(iso) { return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10); }

  function render() {
    var counts = { all: D.rows.length };
    D.rows.forEach(function (d) { counts[d.category] = (counts[d.category] || 0) + 1; });
    $('#rd-pills', D.box).innerHTML = [['all', 'All Documents']].concat(CATS).map(function (c) {
      return '<button class="pill" type="button" data-cat="' + c[0] + '" aria-pressed="' + (D.cat === c[0]) + '">' + esc(c[1]) + ' <small>' + (counts[c[0]] || 0) + '</small></button>';
    }).join('');
    // the position filter lists the positions that have at least one document
    var used = {};
    D.rows.forEach(function (d) { if (d.vacancy_id) used[d.vacancy_id] = true; });
    $('#rd-pos', D.box).innerHTML = '<option value="">Any position</option><option value="none"' + (D.pos === 'none' ? ' selected' : '') + '>Not linked to a position</option>' +
      D.vacancies.filter(function (v) { return used[v.id]; }).map(function (v) { return '<option value="' + esc(v.id) + '"' + (D.pos === v.id ? ' selected' : '') + '>' + esc(v.title) + '</option>'; }).join('');
    $('#rd-clear', D.box).hidden = !(D.cat !== 'all' || D.pos || D.from || D.to);
    $('#rd-from', D.box).value = D.from;
    $('#rd-to', D.box).value = D.to;
    var q = D.q.trim().toLowerCase();
    var list = D.rows.filter(function (d) {
      if (D.cat !== 'all' && d.category !== D.cat) return false;
      if (D.pos === 'none' ? !!d.vacancy_id : (D.pos && d.vacancy_id !== D.pos)) return false;
      var day = dayOf(d.created_at);
      if (D.from && day < D.from) return false;
      if (D.to && day > D.to) return false;
      return !q || (d.title + ' ' + d.description + ' ' + d.batch + ' ' + vacancyTitle(d.vacancy_id) + ' ' + d.file_name).toLowerCase().indexOf(q) !== -1;
    });
    $('#rd-rows', D.box).innerHTML = list.map(function (d) {
      var meta = [CAT[d.category], vacancyTitle(d.vacancy_id), d.batch, app.fmtSize(d.file_size), app.fmtDate(d.created_at), d.version > 1 ? 'Version ' + d.version : ''].filter(Boolean).join(' · ');
      var acts = (VIEWABLE.test(d.file_name || d.file_path) ? IB('eye', 'View', { 'data-a': 'view' }) : '') + IB('download', 'Download', { 'data-a': 'download' }) + IB('pencil', 'Edit details', { 'data-a': 'edit' }) + IB('trash', 'Delete', { 'data-a': 'del' }, 'danger');
      return '<li class="lrow" data-id="' + esc(d.id) + '"><div class="lmain" style="cursor:default"><span class="lico">' + esc(extOf(d.file_name || d.file_path)) + '</span><span class="ltext"><span class="lname">' + esc(d.title) +
        '</span><span class="lmeta">' + esc(meta) + '</span>' + (d.description ? '<span class="lmeta" style="white-space:normal">' + esc(d.description) + '</span>' : '') + '</span></div><div class="lside"><div class="lacts">' + acts + '</div></div></li>';
    }).join('');
    var empty = $('#rd-empty', D.box);
    if (D.failed) {
      empty.innerHTML = '<span class="eic">' + I('lock') + '</span><b>Not set up yet</b><p>Run supabase/recruitment.sql in the Supabase SQL editor, then reload this page.</p>';
      empty.hidden = false;
    } else if (!D.rows.length) {
      empty.innerHTML = '<span class="eic">' + I('inbox') + '</span><b>No documents yet</b><p>Tap ' + I('upload', 'inline') + ' to upload the first official document.</p>';
      empty.hidden = false;
    } else if (!list.length) {
      empty.innerHTML = '<span class="eic">' + I('search') + '</span><b>No matches</b><p>Try another category, filter or search.</p>';
      empty.hidden = false;
    } else empty.hidden = true;
  }

  /* ---------- the upload / edit dialog ---------- */
  function openDialog(d) {
    var dlg = $('#rd-dlg'), form = $('#rd-form'), err = $('#rd-err'), picked = null;
    $('#rd-title').textContent = d ? 'Edit Document' : 'Upload Document';
    $('#rd-name').value = d ? d.title : '';
    $('#rd-cat').innerHTML = CATS.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('');
    $('#rd-cat').value = d ? d.category : (D.cat !== 'all' ? D.cat : CATS[0][0]);
    $('#rd-desc').value = d ? d.description : '';
    $('#rd-vac').innerHTML = '<option value="">Not linked to a position</option>' + D.vacancies.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.title) + '</option>'; }).join('');
    $('#rd-vac').value = d && d.vacancy_id ? d.vacancy_id : '';
    $('#rd-batch').value = d ? d.batch : '';
    $('#rd-file').value = '';
    $('#rd-ok').textContent = d ? 'Save' : 'Upload';
    err.hidden = true;
    function drawFile() {
      $('#rd-cur').textContent = picked ? picked.name + ' (' + app.fmtSize(picked.size) + ')' : (d ? d.file_name + ' (current file)' : 'No file chosen yet.');
      $('#rd-pick').textContent = d ? 'Replace the file' : 'Choose a file';
    }
    drawFile();
    $('#rd-pick').onclick = function () { $('#rd-file').click(); };
    $('#rd-file').onchange = function (e) {
      var f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (!ALLOWED.test(f.name)) { err.textContent = 'That file type is not allowed. Use PDF, Word, Excel, CSV, text or an image.'; err.hidden = false; return; }
      if (f.size > MAX_MB * 1048576) { err.textContent = f.name + ' is over ' + MAX_MB + ' MB.'; err.hidden = false; return; }
      err.hidden = true;
      picked = f;
      if (!$('#rd-name').value.trim()) $('#rd-name').value = f.name.replace(/\.[^.]+$/, '');
      drawFile();
    };
    form.onsubmit = async function (e) {
      e.preventDefault();
      var title = $('#rd-name').value.trim();
      if (!title) { err.textContent = 'Enter a document title.'; err.hidden = false; return; }
      if (!d && !picked) { err.textContent = 'Choose the file to upload.'; err.hidden = false; return; }
      err.hidden = true;
      $('#rd-ok').disabled = true;
      var fields = { title: title, category: $('#rd-cat').value, description: $('#rd-desc').value.trim(), vacancy_id: $('#rd-vac').value || null, batch: $('#rd-batch').value.trim() };
      var path = '';
      if (picked) {
        path = 'docs/' + newId() + '/' + app.cleanName(picked.name);
        var up = await sb.storage.from(BUCKET).upload(path, picked, { upsert: false, contentType: picked.type || 'application/octet-stream', cacheControl: '3600' });
        if (up.error) {
          $('#rd-ok').disabled = false;
          err.textContent = "Couldn't upload the file. You may not have permission, or the file type isn't accepted.";
          err.hidden = false;
          return;
        }
        fields.file_path = path;
        fields.file_name = app.cleanName(picked.name);
        fields.file_size = picked.size;
      }
      var res = d
        ? await sb.from('recruitment_documents').update(fields).eq('id', d.id).select('id').maybeSingle()
        : await sb.from('recruitment_documents').insert(fields).select('id').maybeSingle();
      $('#rd-ok').disabled = false;
      if (res.error || !res.data) {
        if (path) await sb.storage.from(BUCKET).remove([path]);
        err.textContent = "Couldn't save that. You may not have permission.";
        err.hidden = false;
        return;
      }
      if (d && path && d.file_path) await sb.storage.from(BUCKET).remove([d.file_path]);
      dlg.close();
      logAction(d ? (path ? 'recruitment.doc.replace' : 'recruitment.doc.edit') : 'recruitment.doc.upload', title, { id: res.data.id, category: fields.category });
      toast(d ? 'Saved.' : 'Uploaded.', 'ok');
      load();
    };
    $('#rd-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#rd-name').focus();
  }

  /* ---------- opening a file: a short-lived link made for this person only ---------- */
  async function openFile(d, download) {
    busy(download ? 'Preparing the download…' : 'Opening…');
    var res = await sb.storage.from(BUCKET).createSignedUrl(d.file_path, 120, download ? { download: d.file_name || true } : undefined);
    busy('');
    if (res.error || !res.data || !res.data.signedUrl) { toast("Couldn't open that file. You may not have permission.", 'bad'); return; }
    logAction(download ? 'recruitment.doc.download' : 'recruitment.doc.view', d.title, { id: d.id });
    if (download) {
      var a = document.createElement('a');
      a.href = res.data.signedUrl;
      a.download = d.file_name || '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else window.open(res.data.signedUrl, '_blank', 'noopener');
  }

  async function remove(d) {
    var ok = await ask({ title: 'Delete This Document?', text: '"' + d.title + '" and its file will be permanently deleted.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('recruitment_documents').delete().eq('id', d.id).select('id');
    if (res.error || !(res.data || []).length) { busy(''); toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    if (d.file_path) await sb.storage.from(BUCKET).remove([d.file_path]);
    busy('');
    logAction('recruitment.doc.delete', d.title, { id: d.id });
    toast('Deleted.', 'ok');
    await load();
  }

  function onClick(e) {
    var pill = e.target.closest('[data-cat]');
    if (pill) { D.cat = pill.dataset.cat; render(); return; }
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'back') { D.ctx.back(); return; }
    if (a === 'add') { openDialog(null); return; }
    if (a === 'clear') { D.cat = 'all'; D.pos = ''; D.from = ''; D.to = ''; D.q = ''; var qi = $('#rd-q', D.box); if (qi) qi.value = ''; render(); return; }
    var li = e.target.closest('li.lrow'), row = li && D.rows.filter(function (x) { return x.id === li.dataset.id; })[0];
    if (!row) return;
    if (a === 'edit') openDialog(row);
    else if (a === 'view') openFile(row, false);
    else if (a === 'download') openFile(row, true);
    else if (a === 'del') remove(row);
  }

  window.MembersRecruitmentDocs = {
    open: function (box, ctx) {
      D.box = box;
      D.ctx = ctx;
      D.q = ''; D.cat = 'all'; D.from = ''; D.to = ''; D.pos = '';
      if (!canManage()) {
        box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') + '<div class="ph-main"><h2>Recruitment and Selection Records</h2></div></div>' +
          '<div class="list-card"><div class="es"><span class="eic">' + I('lock') + '</span><b>Staffing and Recruitment only</b><p>These records can be opened by Staffing and Recruitment.</p></div></div>';
        box.onclick = onClick;
        return;
      }
      shell();
      box.onclick = onClick;
      box.oninput = function (e) {
        if (e.target.id === 'rd-q') { D.q = e.target.value; render(); }
        else if (e.target.id === 'rd-from') { D.from = e.target.value; render(); }
        else if (e.target.id === 'rd-to') { D.to = e.target.value; render(); }
      };
      box.onchange = function (e) { if (e.target.id === 'rd-pos') { D.pos = e.target.value; render(); } };
      return load();
    }
  };
})();
