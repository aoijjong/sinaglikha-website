/*
  SINAGLIKHA Announcements: posts written by Senior Managers for every employee, with optional
  attached files. Each post shows who wrote it (the database stamps the name and department from the
  signed-in account) and appears in the Employee Portal as soon as it is posted. Any manager can write,
  edit, hide or delete announcements. The database rules in supabase/phase4.sql decide who can do what;
  this screen only shows it. Files go in the private "content" bucket under announcements/.
  Opened from the Announcements row in the Employee Engagement panel of the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var BUCKET = 'content';
  var MAX_FILES = 5;
  var ALLOWED = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|txt|csv)$/i;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var A = { box: null, ctx: null, rows: [], failed: false };

  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function busy(text) {
    var b = $('#an-busy', A.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function excerpt(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

  /* ---------- the list ---------- */
  function shell() {
    A.box.style.position = 'relative';
    A.box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Announcements</h2><p class="sub">Posts for every employee, with files if you like</p></div>' +
      '<div class="ph-actions">' + IB('plus', 'Write an announcement', { 'data-a': 'add' }, 'solid') + '</div></div>' +
      '<p class="sp-note">Posts show your name and go live at once. Hide one to take it down.</p>' +
      '<div class="list-card"><ul class="rows" id="an-rows"></ul><div class="es" id="an-empty" hidden></div></div>' +
      '<div class="busy" id="an-busy" hidden role="status">Loading…</div>';
  }

  async function load() {
    busy('Loading…');
    var res = await sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(200);
    busy('');
    A.failed = !!res.error;
    A.rows = res.error ? [] : res.data || [];
    render();
  }

  function render() {
    var rows = $('#an-rows', A.box), empty = $('#an-empty', A.box);
    rows.innerHTML = A.rows.map(function (a) {
      var n = Array.isArray(a.files) ? a.files.length : 0;
      var meta = [a.author_name || 'A Senior Manager', app.depts[a.author_dept] || '', app.fmtDate(a.created_at), n ? n + (n === 1 ? ' file' : ' files') : ''].filter(Boolean).join(' · ');
      return '<li class="lrow" data-id="' + esc(a.id) + '"><div class="lmain" style="cursor:default"><span class="lico">' + I('chat') + '</span><span class="ltext"><span class="lname">' +
        esc(a.title || excerpt(a.body, 70)) + '</span><span class="lmeta">' + esc(meta) + '</span>' +
        (a.title ? '<span class="lmeta" style="white-space:normal">' + esc(excerpt(a.body, 140)) + '</span>' : '') + '</span></div>' +
        '<div class="lside"><span class="chip ' + (a.published ? 's-published' : 's-archived') + '">' + (a.published ? 'Posted' : 'Hidden') + '</span><div class="lacts">' +
        IB('pencil', 'Edit', { 'data-a': 'edit' }) +
        (a.published ? IB('eyeOff', 'Hide from employees', { 'data-a': 'toggle' }) : IB('eye', 'Show to employees', { 'data-a': 'toggle' }, 'good')) +
        IB('trash', 'Delete', { 'data-a': 'del' }, 'danger') + '</div></div></li>';
    }).join('');
    if (A.failed) {
      empty.innerHTML = '<span class="eic">' + I('chat') + '</span><b>Not set up yet</b><p>Run supabase/phase4.sql in the Supabase SQL editor, then reload this page.</p>';
      empty.hidden = false;
    } else if (!A.rows.length) {
      empty.innerHTML = '<span class="eic">' + I('chat') + '</span><b>No announcements yet</b><p>Tap ' + I('plus', 'inline') + ' to write the first one.</p>';
      empty.hidden = false;
    } else empty.hidden = true;
  }

  /* ---------- the write / edit dialog ---------- */
  function openDialog(a) {
    var dlg = $('#an-dlg'), form = $('#an-form'), err = $('#an-err');
    var kept = a && Array.isArray(a.files) ? a.files.slice() : [];      // files already on the post
    var added = [];                                                      // files chosen now
    $('#an-title').textContent = a ? 'Edit Announcement' : 'New Announcement';
    $('#an-name').value = a ? a.title || '' : '';
    $('#an-body').value = a ? a.body : '';
    $('#an-file').value = '';
    $('#an-ok').textContent = a ? 'Save' : 'Post';
    err.hidden = true;

    function drawFiles() {
      var html = kept.map(function (f, i) {
        return '<li><span>' + I('file') + esc(f.name) + '</span>' + IB('x', 'Remove this file', { 'data-keep': i }) + '</li>';
      }).join('') + added.map(function (f, i) {
        return '<li><span>' + I('upload') + esc(f.name) + ' <small>new</small></span>' + IB('x', 'Remove this file', { 'data-new': i }) + '</li>';
      }).join('');
      $('#an-files').innerHTML = html;
      $('#an-add').disabled = kept.length + added.length >= MAX_FILES;
    }
    drawFiles();

    $('#an-add').onclick = function () { $('#an-file').click(); };
    $('#an-file').onchange = function (e) {
      Array.prototype.slice.call(e.target.files).forEach(function (f) {
        if (kept.length + added.length >= MAX_FILES) { err.textContent = 'You can attach up to ' + MAX_FILES + ' files.'; err.hidden = false; return; }
        if (!ALLOWED.test(f.name)) { err.textContent = f.name + ': that file type is not allowed. Use PDF, an image, Word, Excel, PowerPoint, text or CSV.'; err.hidden = false; return; }
        if (f.size > app.maxMb * 1048576) { err.textContent = f.name + ' is over ' + app.maxMb + ' MB.'; err.hidden = false; return; }
        added.push(f);
      });
      e.target.value = '';
      drawFiles();
    };
    $('#an-files').onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-keep')) kept.splice(Number(b.getAttribute('data-keep')), 1);
      else if (b.hasAttribute('data-new')) added.splice(Number(b.getAttribute('data-new')), 1);
      drawFiles();
    };

    form.onsubmit = async function (e) {
      e.preventDefault();
      var body = $('#an-body').value.trim(), title = $('#an-name').value.trim();
      if (!body) { err.textContent = 'Write your message first.'; err.hidden = false; return; }
      err.hidden = true;
      $('#an-ok').disabled = true;
      var uploaded = [], failed = false;
      for (var i = 0; i < added.length; i++) {
        var f = added[i], path = 'announcements/' + newId() + '/' + app.cleanName(f.name);
        var up = await sb.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream', cacheControl: '3600' });
        if (up.error) { failed = true; break; }
        uploaded.push({ path: path, name: app.cleanName(f.name), size: f.size });
      }
      if (failed) {
        if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded.map(function (u) { return u.path; }));
        $('#an-ok').disabled = false;
        err.textContent = "Couldn't upload a file. You may not have permission.";
        err.hidden = false;
        return;
      }
      var fields = { title: title, body: body, files: kept.concat(uploaded) };
      var res = a
        ? await sb.from('announcements').update(fields).eq('id', a.id).select('id').maybeSingle()
        : await sb.from('announcements').insert(Object.assign({ published: true }, fields)).select('id').maybeSingle();
      $('#an-ok').disabled = false;
      if (res.error || !res.data) {
        if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded.map(function (u) { return u.path; }));
        err.textContent = "Couldn't save that. You may not have permission.";
        err.hidden = false;
        return;
      }
      if (a) {
        // files taken off the post are deleted from storage too
        var gone = (a.files || []).filter(function (f) { return !kept.some(function (k) { return k.path === f.path; }); }).map(function (f) { return f.path; });
        if (gone.length) await sb.storage.from(BUCKET).remove(gone);
      }
      dlg.close();
      logAction(a ? 'announcement.edit' : 'announcement.post', title || excerpt(body, 60), { id: res.data.id });
      toast(a ? 'Saved.' : 'Posted. Employees can see it now.', 'ok');
      load();
    };
    $('#an-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#an-body').focus();
  }

  async function toggle(a) {
    busy('Saving…');
    var res = await sb.from('announcements').update({ published: !a.published }).eq('id', a.id).select('id').maybeSingle();
    busy('');
    if (res.error || !res.data) { toast("Couldn't save that. You may not have permission.", 'bad'); return; }
    logAction(a.published ? 'announcement.hide' : 'announcement.show', a.title || excerpt(a.body, 60), { id: a.id });
    toast(a.published ? 'Hidden from employees.' : 'Employees can see it again.', 'ok');
    await load();
  }

  async function remove(a) {
    var ok = await ask({ title: 'Delete This Announcement?', text: '"' + (a.title || excerpt(a.body, 60)) + '" and its attached files will be permanently deleted.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('announcements').delete().eq('id', a.id).select('id');
    if (res.error || !(res.data || []).length) { busy(''); toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    var paths = (a.files || []).map(function (f) { return f.path; }).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    busy('');
    logAction('announcement.delete', a.title || excerpt(a.body, 60), { id: a.id });
    toast('Deleted.', 'ok');
    await load();
  }

  function onClick(e) {
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'back') { A.ctx.back(); return; }
    if (a === 'add') { openDialog(null); return; }
    var li = e.target.closest('li.lrow'), row = li && A.rows.filter(function (x) { return x.id === li.dataset.id; })[0];
    if (!row) return;
    if (a === 'edit') openDialog(row);
    else if (a === 'toggle') toggle(row);
    else if (a === 'del') remove(row);
  }

  window.MembersAnnouncements = {
    open: function (box, ctx) {
      A.box = box;
      A.ctx = ctx;
      shell();
      box.onclick = onClick;
      return load();
    }
  };
})();
