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
        IB('more', 'Actions for ' + (a.title || 'this announcement'), { 'data-a': 'amenu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }) + '</div></div></li>';
    }).join('');
    if (A.failed) {
      empty.innerHTML = '<span class="eic">' + I('chat') + '</span><b>Not set up yet</b><p>Run supabase/phase4.sql in the Supabase SQL editor, then reload this page.</p>';
      empty.hidden = false;
    } else if (!A.rows.length) {
      empty.innerHTML = '<span class="eic">' + I('chat') + '</span><b>No announcements yet</b><p>Tap ' + I('plus', 'inline') + ' to write the first one.</p>';
      empty.hidden = false;
    } else empty.hidden = true;
  }

  /* ---------- the preview: the post as employees see it on their dashboard ---------- */
  var TINTS = ['#FFE7A8', '#FBD2B0', '#F6C9C0', '#D8E6C4', '#CFE3F1', '#E4D6F0'];
  function initialsOf(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] ? Array.from(w[0])[0] : '?') + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
  }
  function tintOf(name) {
    var h = 0;
    String(name).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return TINTS[h % TINTS.length];
  }
  function openPreview(p) {
    var dlg = $('#an-prev');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'an-prev';
      dlg.className = 'apv-dlg';
      dlg.setAttribute('aria-label', 'Preview of the announcement');
      document.body.appendChild(dlg);
      dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.closest('[data-apv-close]')) dlg.close(); });
    }
    var author = p.author || 'A Senior Manager';
    var when = p.when || 'just now';
    var files = (p.files || []).map(function (f) {
      return '<span class="apv-chip">' + I('file') + '<span>' + esc(f.name) + '</span>' + (f.size ? '<small>' + esc(app.fmtSize(f.size)) + '</small>' : '') + '</span>';
    }).join('');
    dlg.innerHTML = '<div class="apv-top"><div><b>Preview</b><span>This is how employees see it on their dashboard' + (p.published === false ? '. It is hidden right now, so they cannot see it until you show it.' : '.') + '</span></div>' +
      IB('x', 'Close the preview', { 'data-apv-close': '1' }, 'line') + '</div>' +
      '<div class="apv-stage"><section class="apv-panel"><div class="apv-ph"><span class="apv-pi">' + I('chat') + '</span><h2>Announcements</h2></div>' +
      '<article class="apv-post"><div class="apv-who"><span class="apv-av" style="background:' + tintOf(author) + '" aria-hidden="true">' + esc(initialsOf(author)) + '</span>' +
      '<div><b>' + esc(author) + '</b><span>' + esc((p.dept ? p.dept + ' · ' : '') + when) + '</span></div></div>' +
      (p.title ? '<h3 class="apv-title">' + esc(p.title) + '</h3>' : '') +
      '<p class="apv-body">' + esc(p.body || '').replace(/\n/g, '<br>') + '</p>' +
      (files ? '<div class="apv-files">' + files + '</div>' : '') + '</article></section></div>';
    if (!dlg.open) dlg.showModal();
  }
  function previewOf(a) {
    return { author: a.author_name, dept: app.depts[a.author_dept] || '', title: a.title, body: a.body, files: Array.isArray(a.files) ? a.files : [],
      when: a.created_at ? app.fmtDate(a.created_at) : 'just now', published: a.published };
  }

  /* ---------- the dotted menu on each row ---------- */
  var amBtn = null;
  function actionsFor(a) {
    return [['preview', 'eye', 'Preview as employees see it'], ['edit', 'pencil', 'Edit'],
      a.published ? ['toggle', 'eyeOff', 'Hide from employees'] : ['toggle', 'eye', 'Show to employees'], ['del', 'trash', 'Delete']];
  }
  function closeAMenu(focusBack) {
    var m = document.getElementById('an-amenu');
    if (!m || m.hidden) return;
    m.hidden = true;
    var bt = amBtn; amBtn = null;
    if (bt) { bt.setAttribute('aria-expanded', 'false'); if (focusBack && document.body.contains(bt)) bt.focus(); }
  }
  function openAMenu(btn, a) {
    var m = document.getElementById('an-amenu');
    if (!m) {
      m = document.createElement('ul');
      m.id = 'an-amenu'; m.className = 'at-menu am'; m.setAttribute('role', 'menu'); m.hidden = true;
      document.body.appendChild(m);
    }
    if (!m.hidden && amBtn === btn) { closeAMenu(true); return; }
    closeAMenu(false);
    m.setAttribute('aria-label', 'Actions for ' + (a.title || 'this announcement'));
    m.innerHTML = actionsFor(a).map(function (x) {
      return '<li role="menuitem" tabindex="-1" data-am="' + x[0] + '"' + (x[0] === 'del' ? ' class="danger"' : '') + '>' + I(x[1]) + '<span>' + x[2] + '</span></li>';
    }).join('');
    m.dataset.for = a.id;
    m.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    amBtn = btn;
    m.style.maxHeight = '';
    var r = btn.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth, need = mh + 20;
    if (window.innerHeight - r.bottom < need) { window.scrollBy({ top: need - (window.innerHeight - r.bottom), behavior: 'instant' }); r = btn.getBoundingClientRect(); }
    var below = window.innerHeight - r.bottom - 14;
    if (mh > below) m.style.maxHeight = Math.max(140, below) + 'px';
    m.style.top = Math.max(8, r.bottom + 6) + 'px';
    m.style.left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8) + 'px';
    m.firstChild.focus();
  }
  function runAct(act, a) {
    if (act === 'preview') openPreview(previewOf(a));
    else if (act === 'edit') openDialog(a);
    else if (act === 'toggle') toggle(a);
    else if (act === 'del') remove(a);
  }
  function pickAct(act) {
    var m = document.getElementById('an-amenu'), id = m && m.dataset.for;
    var a = A.rows.filter(function (x) { return x.id === id; })[0];
    closeAMenu(false);
    if (a) runAct(act, a);
  }
  document.addEventListener('click', function (e) {
    var mi = e.target.closest('#an-amenu li');
    if (mi) { pickAct(mi.dataset.am); return; }
    if (!e.target.closest('#an-amenu, [data-a="amenu"]')) closeAMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    var m = document.getElementById('an-amenu');
    if (!m || m.hidden || !e.target.closest('#an-amenu')) return;
    var its = [].slice.call(m.querySelectorAll('li')), k = its.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); its[(k + 1) % its.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); its[(k - 1 + its.length) % its.length].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (its[k]) pickAct(its[k].dataset.am); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAMenu(true); }
    else if (e.key === 'Tab') closeAMenu(false);
  });
  window.addEventListener('scroll', function () { closeAMenu(false); }, true);
  window.addEventListener('resize', function () { closeAMenu(false); });

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

    $('#an-prev-btn').onclick = function () {
      var st = app.state && app.state.profile, mine = st && (st.full_name || st.email);
      openPreview({
        author: a ? a.author_name : mine, dept: a ? app.depts[a.author_dept] || '' : (st && app.depts[st.department]) || '',
        title: $('#an-name').value.trim(), body: $('#an-body').value.trim() || 'Your message will show here.',
        files: kept.concat(added.map(function (f) { return { name: app.cleanName(f.name), size: f.size }; })), when: a ? app.fmtDate(a.created_at) : 'just now'
      });
    };
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
    if (a === 'amenu') openAMenu(b, row);
    else runAct(a, row);
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
