/*
  SINAGLIKHA members area.
  Sign-in and files run on Supabase. The database rules in supabase/schema.sql
  decide who can see or change what; this page only presents it.
*/
(function () {
  'use strict';

  var cfg = window.MEMBERS_CONFIG || {};
  var BUCKET = cfg.BUCKET || 'library';
  var MAX_MB = Number(cfg.MAX_UPLOAD_MB) || 50;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  $('#year').textContent = new Date().getFullYear();

  /* The email link puts its details after the # in the address. Read them
     before the Supabase client tidies the address bar. */
  var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  var linkType = hash.get('type');
  var linkError = hash.get('error_description') || hash.get('error');

  /* ---------- views ---------- */
  var VIEWS = ['loading', 'setup', 'auth', 'password', 'denied', 'app'];
  function show(name) {
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== name; });
    $('#btn-signout').hidden = !(name === 'app' || name === 'password');
    if (name !== 'app') { $('#who').hidden = true; }
  }

  var toastTimer;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 5200);
  }

  function note(el, msg, kind) {
    el.textContent = msg;
    el.className = 'msg ' + (kind || '');
    el.hidden = !msg;
  }

  /* ---------- not configured yet ---------- */
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !/^YOUR_/.test(cfg.SUPABASE_URL) && !/^YOUR_/.test(cfg.SUPABASE_ANON_KEY);
  if (!configured) { show('setup'); return; }
  /* Catch the common copy-and-paste mistakes with a clear message. */
  function configProblem() {
    var url = String(cfg.SUPABASE_URL), key = String(cfg.SUPABASE_ANON_KEY);
    if (!/^https:\/\//i.test(url)) {
      return /^(sb_|eyJ)/.test(url)
        ? 'SUPABASE_URL contains a key. It should be the Project URL, like https://yourproject.supabase.co.'
        : 'SUPABASE_URL should start with https:// and look like https://yourproject.supabase.co.';
    }
    if (/^sb_secret_/.test(key)) {
      return 'The key in config.js is a secret key. Remove it right away and use the public anon or publishable key.';
    }
    if (key.split('.').length === 3) {
      try {
        var claims = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (claims.role === 'service_role') {
          return 'The key in config.js is the secret service_role key. Remove it right away, then use the public anon key.';
        }
      } catch (e) { /* not readable; let Supabase judge it */ }
    }
    return '';
  }
  var problem = configProblem();
  if (problem) {
    show('setup');
    $('#view-setup .lead').textContent = problem;
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    show('setup');
    $('#view-setup .lead').textContent = "The sign-in library couldn't load. Check your internet connection and reload.";
    return;
  }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });

  var state = { session: null, profile: null, isAdmin: false, path: [], entries: [], filter: '' };

  /* ---------- small helpers ---------- */
  function prefix() { return state.path.length ? state.path.join('/') + '/' : ''; }

  function cleanName(n) {
    var out = String(n).normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.\-() ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!out || out === '.' || out === '..') out = 'file';
    return out;
  }

  function fmtSize(b) {
    if (typeof b !== 'number') return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';
  }
  function fmtDate(d) {
    if (!d) return '';
    var x = new Date(d);
    return isNaN(x) ? '' : x.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function extOf(name) {
    var i = name.lastIndexOf('.');
    return i > 0 && i < name.length - 1 ? name.slice(i + 1, i + 5).toUpperCase() : 'FILE';
  }

  var ICON_FOLDER = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  var ICON_DOWN = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
  var ICON_TRASH = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  /* ---------- confirm / ask dialog ---------- */
  function ask(o) {
    return new Promise(function (resolve) {
      var dlg = $('#modal'), form = $('#modal-form'), input = $('#m-input'), err = $('#m-err');
      var okBtn = $('#m-ok');
      $('#m-title').textContent = o.title;
      $('#m-text').textContent = o.text || '';
      $('#m-text').hidden = !o.text;
      $('#m-field').hidden = !o.label;
      $('#m-label').textContent = o.label || '';
      input.value = o.value || '';
      err.hidden = true;
      okBtn.textContent = o.ok || 'OK';
      okBtn.className = 'btn btn-sm ' + (o.danger ? 'btn-danger' : 'btn-primary');

      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        if (dlg.open) dlg.close();
        resolve(v);
      }
      form.onsubmit = function (e) {
        e.preventDefault();
        if (o.label) {
          var v = input.value.trim();
          var problem = o.validate ? o.validate(v) : '';
          if (problem) { err.textContent = problem; err.hidden = false; input.focus(); return; }
          finish(v);
        } else {
          finish(true);
        }
      };
      $('#m-cancel').onclick = function () { finish(null); };
      dlg.oncancel = function () { done = true; resolve(null); };
      dlg.onclick = function (e) {
        var r = dlg.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) finish(null);
      };
      dlg.showModal();
      if (o.label) input.focus();
    });
  }

  /* ---------- session flow ---------- */
  async function enterApp(session) {
    state.session = session;
    var res = await sb.from('profiles')
      .select('id,email,full_name,role,active')
      .eq('id', session.user.id)
      .maybeSingle();
    var p = res.data;
    if (res.error || !p || !p.active) {
      state.profile = null;
      show('denied');
      return;
    }
    state.profile = p;
    state.isAdmin = p.role === 'admin';
    var who = $('#who');
    who.textContent = p.full_name || p.email || '';
    who.hidden = !who.textContent;
    $$('.admin-only').forEach(function (el) { el.hidden = !state.isAdmin; });
    $('#tabs').hidden = !state.isAdmin;
    setTab('library');
    show('app');
    state.path = [];
    state.filter = '';
    $('#search').value = '';
    await loadFolder();
  }

  function resetToSignIn() {
    state.session = null;
    state.profile = null;
    state.isAdmin = false;
    $('#form-login').reset();
    note($('#login-msg'), '');
    show('auth');
  }

  async function boot() {
    show('loading');

    if (linkError) {
      show('auth');
      note($('#login-msg'), 'That link has expired or was already used. Sign in, use "Forgot your password?", or ask an administrator for a new invitation.', 'bad');
      history.replaceState(null, '', location.pathname);
      return;
    }

    var got = await sb.auth.getSession();
    var session = got.data && got.data.session;

    if (session && (linkType === 'invite' || linkType === 'recovery')) {
      history.replaceState(null, '', location.pathname);
      state.session = session;
      show('password');
      $('#p-new').focus();
      return;
    }
    if (session) { await enterApp(session); return; }
    show('auth');
  }

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT') setTimeout(resetToSignIn, 0);
  });

  /* ---------- sign in / password / sign out ---------- */
  $('#form-login').addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = $('#l-email').value.trim();
    var pass = $('#l-pass').value;
    var msg = $('#login-msg');
    if (!email || !pass) { note(msg, 'Enter your email and password.', 'bad'); return; }
    var btn = $('#btn-login');
    btn.disabled = true;
    note(msg, '');
    var res = await sb.auth.signInWithPassword({ email: email, password: pass });
    btn.disabled = false;
    if (res.error || !res.data.session) {
      note(msg, "That email and password don't match.", 'bad');
      return;
    }
    show('loading');
    await enterApp(res.data.session);
  });

  $('#btn-forgot').addEventListener('click', async function () {
    var email = $('#l-email').value.trim();
    var msg = $('#login-msg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      note(msg, 'Type your email above first, then choose "Forgot your password?".', 'bad');
      $('#l-email').focus();
      return;
    }
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    note(msg, 'If that email belongs to a member, a reset link is on its way.', 'ok');
  });

  $('#form-password').addEventListener('submit', async function (e) {
    e.preventDefault();
    var a = $('#p-new').value, b = $('#p-confirm').value;
    var msg = $('#password-msg');
    if (a.length < 10) { note(msg, 'Use at least 10 characters.', 'bad'); return; }
    if (a !== b) { note(msg, "The two passwords don't match.", 'bad'); return; }
    var btn = $('#btn-password');
    btn.disabled = true;
    var res = await sb.auth.updateUser({ password: a });
    btn.disabled = false;
    if (res.error) {
      note(msg, res.error.message || "Couldn't save the password. Try again.", 'bad');
      return;
    }
    note(msg, '');
    $('#form-password').reset();
    toast('Password saved. Welcome!', 'ok');
    show('loading');
    var cur = await sb.auth.getSession();
    if (cur.data.session) await enterApp(cur.data.session); else resetToSignIn();
  });

  $('#btn-signout').addEventListener('click', function () { sb.auth.signOut(); });
  $('#btn-denied-out').addEventListener('click', function () { sb.auth.signOut(); });

  /* ---------- tabs ---------- */
  function setTab(name) {
    var lib = name === 'library';
    $('#tab-library').setAttribute('aria-selected', String(lib));
    $('#tab-people').setAttribute('aria-selected', String(!lib));
    $('#panel-library').hidden = !lib;
    $('#panel-people').hidden = lib;
    if (!lib) loadPeople();
  }
  $('#tab-library').addEventListener('click', function () { setTab('library'); });
  $('#tab-people').addEventListener('click', function () { setTab('people'); });

  /* ---------- library ---------- */
  function setBusy(text) {
    var b = $('#busy');
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }

  async function loadFolder() {
    setBusy('Loading…');
    var res = await sb.storage.from(BUCKET).list(state.path.join('/'), {
      limit: 1000, sortBy: { column: 'name', order: 'asc' }
    });
    setBusy('');
    if (res.error) {
      toast("Couldn't load this folder. " + (res.error.message || ''), 'bad');
      state.entries = [];
      render();
      return;
    }
    state.entries = (res.data || [])
      .filter(function (e) { return e.name && e.name.charAt(0) !== '.'; })
      .map(function (e) {
        return {
          name: e.name,
          folder: !e.id,
          size: e.metadata && e.metadata.size,
          updated: e.updated_at || e.created_at
        };
      })
      .sort(function (a, b) {
        if (a.folder !== b.folder) return a.folder ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
    render();
  }

  function renderCrumbs() {
    var html = '<button type="button" data-go="0"' + (state.path.length ? '' : ' aria-current="true"') + '>HR 201</button>';
    state.path.forEach(function (seg, i) {
      var last = i === state.path.length - 1;
      html += '<span class="sep" aria-hidden="true">/</span><button type="button" data-go="' + (i + 1) + '"' +
        (last ? ' aria-current="true"' : '') + '>' + esc(seg) + '</button>';
    });
    $('#crumbs').innerHTML = html;
  }

  function rowHtml(e) {
    var n = esc(e.name);
    var del = state.isAdmin
      ? '<button class="icon-btn danger" type="button" data-act="delete" aria-label="Delete ' + (e.folder ? 'folder ' : '') + n + '">' + ICON_TRASH + '</button>'
      : '';
    if (e.folder) {
      return '<li class="row" data-name="' + n + '" data-kind="folder">' +
        '<button class="row-main" type="button" data-act="open"><span class="ico folder">' + ICON_FOLDER + '</span>' +
        '<span class="row-text"><span class="row-name">' + n + '</span><span class="row-meta">Folder</span></span></button>' + del + '</li>';
    }
    var meta = [fmtSize(e.size), fmtDate(e.updated)].filter(Boolean).join(' · ');
    return '<li class="row" data-name="' + n + '" data-kind="file">' +
      '<button class="row-main" type="button" data-act="preview" title="Open in a new tab"><span class="ico">' + esc(extOf(e.name)) + '</span>' +
      '<span class="row-text"><span class="row-name">' + n + '</span><span class="row-meta">' + esc(meta) + '</span></span></button>' +
      '<button class="icon-btn" type="button" data-act="download" aria-label="Download ' + n + '">' + ICON_DOWN + '</button>' + del + '</li>';
  }

  function render() {
    renderCrumbs();
    var q = state.filter.trim().toLowerCase();
    var items = state.entries.filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) !== -1; });
    $('#rows').innerHTML = items.map(rowHtml).join('');
    var empty = $('#empty');
    if (!state.entries.length) {
      empty.textContent = state.isAdmin
        ? 'This folder is empty. Upload files or drag them here.'
        : 'This folder is empty.';
      empty.hidden = false;
    } else if (!items.length) {
      empty.textContent = 'No files match "' + $('#search').value.trim() + '".';
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }

  $('#crumbs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (!b || b.getAttribute('aria-current')) return;
    state.path = state.path.slice(0, Number(b.dataset.go));
    state.filter = '';
    $('#search').value = '';
    loadFolder();
  });

  $('#search').addEventListener('input', function (e) { state.filter = e.target.value; render(); });

  async function signedUrl(name, download) {
    var res = await sb.storage.from(BUCKET).createSignedUrl(prefix() + name, 120, download ? { download: name } : undefined);
    if (res.error || !res.data) throw res.error || new Error('No link');
    return res.data.signedUrl;
  }

  async function preview(name) {
    var w = window.open('about:blank', '_blank');
    try {
      var url = await signedUrl(name, false);
      if (w) { w.opener = null; w.location.href = url; } else { location.href = url; }
    } catch (err) {
      if (w) w.close();
      toast("Couldn't open that file.", 'bad');
    }
  }

  async function download(name) {
    try {
      var url = await signedUrl(name, true);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast("Couldn't download that file.", 'bad');
    }
  }

  async function listTree(folder) {
    var out = [];
    var res = await sb.storage.from(BUCKET).list(folder, { limit: 1000 });
    if (res.error) throw res.error;
    for (var i = 0; i < (res.data || []).length; i++) {
      var e = res.data[i];
      var p = folder ? folder + '/' + e.name : e.name;
      if (!e.id) { out = out.concat(await listTree(p)); } else { out.push(p); }
    }
    return out;
  }

  async function removePaths(paths) {
    var removed = 0;
    for (var i = 0; i < paths.length; i += 100) {
      var batch = paths.slice(i, i + 100);
      var res = await sb.storage.from(BUCKET).remove(batch);
      if (res.error) throw res.error;
      removed += (res.data || []).length;
    }
    return removed;
  }

  async function deleteEntry(name, isFolder) {
    var ok = await ask({
      title: isFolder ? 'Delete this folder?' : 'Delete this file?',
      text: isFolder
        ? '"' + name + '" and everything inside it will be permanently deleted.'
        : '"' + name + '" will be permanently deleted.',
      ok: 'Delete',
      danger: true
    });
    if (!ok) return;
    setBusy('Deleting…');
    try {
      var paths = isFolder ? await listTree(prefix() + name) : [prefix() + name];
      var removed = await removePaths(paths);
      if (removed < paths.length) throw new Error('Some items were not deleted');
      toast(isFolder ? 'Folder deleted.' : 'File deleted.', 'ok');
    } catch (err) {
      toast("Couldn't delete that. You may not have permission.", 'bad');
    }
    await loadFolder();
  }

  $('#rows').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    var li = e.target.closest('li.row');
    if (!btn || !li) return;
    var name = li.dataset.name;
    var folder = li.dataset.kind === 'folder';
    switch (btn.dataset.act) {
      case 'open':
        state.path.push(name);
        state.filter = '';
        $('#search').value = '';
        loadFolder();
        break;
      case 'preview': preview(name); break;
      case 'download': download(name); break;
      case 'delete': deleteEntry(name, folder); break;
    }
  });

  /* ---------- upload and new folder (admins) ---------- */
  async function uploadFiles(files) {
    if (!state.isAdmin || !files.length) return;
    var ok = 0, failed = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      setBusy('Uploading ' + (i + 1) + ' of ' + files.length + '…');
      if (f.size > MAX_MB * 1048576) { failed.push(f.name + ' (over ' + MAX_MB + ' MB)'); continue; }
      var res = await sb.storage.from(BUCKET).upload(prefix() + cleanName(f.name), f, {
        upsert: false, contentType: f.type || 'application/octet-stream', cacheControl: '3600'
      });
      if (res.error) {
        failed.push(f.name + (/exist|duplicate/i.test(res.error.message || '') ? ' (already exists)' : ''));
      } else { ok++; }
    }
    setBusy('');
    if (ok && !failed.length) toast(ok === 1 ? 'File uploaded.' : ok + ' files uploaded.', 'ok');
    else if (ok) toast(ok + ' uploaded. Not uploaded: ' + failed.join(', '), 'bad');
    else toast('Nothing uploaded: ' + failed.join(', '), 'bad');
    await loadFolder();
  }

  $('#btn-upload').addEventListener('click', function () { $('#file-input').click(); });
  $('#file-input').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    e.target.value = '';
    uploadFiles(files);
  });

  var drop = $('#drop');
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      if (!state.isAdmin) return;
      e.preventDefault();
      drop.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function () { drop.classList.remove('drag'); });
  });
  drop.addEventListener('drop', function (e) {
    if (!state.isAdmin) return;
    e.preventDefault();
    uploadFiles(Array.prototype.slice.call(e.dataTransfer.files));
  });

  $('#btn-folder').addEventListener('click', async function () {
    var name = await ask({
      title: 'New folder',
      label: 'Folder name',
      ok: 'Create',
      validate: function (v) {
        if (!v) return 'Enter a folder name.';
        var clean = cleanName(v);
        if (state.entries.some(function (e) { return e.name.toLowerCase() === clean.toLowerCase(); })) {
          return 'Something with that name already exists here.';
        }
        return '';
      }
    });
    if (!name) return;
    var clean = cleanName(name);
    setBusy('Creating folder…');
    var res = await sb.storage.from(BUCKET).upload(prefix() + clean + '/.keep', new Blob([' '], { type: 'text/plain' }), { upsert: false });
    setBusy('');
    if (res.error) toast("Couldn't create the folder.", 'bad'); else toast('Folder created.', 'ok');
    await loadFolder();
  });

  /* ---------- people (admins) ---------- */
  async function loadPeople() {
    if (!state.isAdmin) return;
    var list = $('#people');
    list.innerHTML = '<li class="empty">Loading…</li>';
    var res = await sb.from('profiles')
      .select('id,email,full_name,role,active,created_at')
      .order('created_at', { ascending: true });
    if (res.error) {
      list.innerHTML = '<li class="empty">Couldn\'t load the list.</li>';
      return;
    }
    list.innerHTML = (res.data || []).map(function (p) {
      var me = p.id === state.session.user.id;
      var label = esc(p.full_name || p.email || 'Unnamed');
      return '<li class="row person" data-id="' + esc(p.id) + '">' +
        '<div class="row-text"><span class="row-name">' + label + (me ? ' (you)' : '') + '</span>' +
        '<span class="row-meta">' + esc(p.email || '') + (p.active ? '' : ' · Deactivated') + '</span></div>' +
        '<select data-act="role" aria-label="Role for ' + label + '"' + (me ? ' disabled' : '') + '>' +
        '<option value="member"' + (p.role === 'member' ? ' selected' : '') + '>Member</option>' +
        '<option value="admin"' + (p.role === 'admin' ? ' selected' : '') + '>Admin</option></select>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="toggle"' + (me ? ' disabled' : '') + '>' +
        (p.active ? 'Deactivate' : 'Reactivate') + '</button></li>';
    }).join('') || '<li class="empty">No accounts yet.</li>';
  }

  async function updateProfile(id, patch) {
    var res = await sb.from('profiles').update(patch).eq('id', id).select('id').maybeSingle();
    if (res.error || !res.data) { toast("Couldn't save that change.", 'bad'); return false; }
    toast('Saved.', 'ok');
    return true;
  }

  $('#people').addEventListener('change', async function (e) {
    var sel = e.target.closest('select[data-act="role"]');
    if (!sel) return;
    var id = sel.closest('li').dataset.id;
    if (!(await updateProfile(id, { role: sel.value }))) loadPeople();
  });

  $('#people').addEventListener('click', async function (e) {
    var btn = e.target.closest('button[data-act="toggle"]');
    if (!btn) return;
    var li = btn.closest('li');
    var activate = btn.textContent.trim() === 'Reactivate';
    if (!activate) {
      var ok = await ask({
        title: 'Deactivate this account?',
        text: 'They will lose access to the files right away. You can reactivate them later.',
        ok: 'Deactivate',
        danger: true
      });
      if (!ok) return;
    }
    await updateProfile(li.dataset.id, { active: activate });
    loadPeople();
  });

  $('#form-invite').addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = $('#i-email').value.trim();
    var name = $('#i-name').value.trim();
    var msg = $('#invite-msg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { note(msg, 'Enter a valid email address.', 'bad'); return; }
    var btn = $('#btn-invite');
    btn.disabled = true;
    note(msg, '');
    try {
      var cur = await sb.auth.getSession();
      var token = cur.data.session && cur.data.session.access_token;
      var res = await fetch('../api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ email: email, name: name })
      });
      var body = {};
      try { body = await res.json(); } catch (x) { /* not JSON */ }
      if (res.ok) {
        note(msg, 'Invitation sent to ' + email + '.', 'ok');
        $('#form-invite').reset();
        loadPeople();
      } else if (body.error) {
        note(msg, body.error, 'bad');
      } else {
        note(msg, 'In-site invitations only work on the Vercel version of the website. Invite from Supabase → Authentication → Users instead.', 'bad');
      }
    } catch (err) {
      note(msg, "Couldn't reach the server. Check your connection and try again.", 'bad');
    }
    btn.disabled = false;
  });

  boot().catch(function () {
    show('auth');
    note($('#login-msg'), 'Something went wrong while loading. Reload the page and try again.', 'bad');
  });
})();
