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
  var VIEWS = ['loading', 'setup', 'auth', 'password', 'denied', 'app', 'profile'];
  function show(name) {
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== name; });
    var signedIn = name === 'app' || name === 'profile';
    $('#btn-signout').hidden = !(signedIn || name === 'password');
    if (!signedIn) { $('#who').hidden = true; $('#btn-profile').hidden = true; }
    else updateWho();
    if (signedIn) $('#btn-profile').setAttribute('aria-current', name === 'profile' ? 'page' : 'false');
  }

  function onProfileUrl() { return new URLSearchParams(location.search).has('profile'); }

  /* ---------- profile pictures: a small square JPEG kept with the profile ---------- */
  function initials(p) {
    var words = String(p.full_name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return Array.from(String(p.email || '?'))[0].toUpperCase();
    var first = Array.from(words[0])[0], last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
    return (first + last).toUpperCase();
  }
  function photoOf(p) {
    return p && typeof p.avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(p.avatar) ? p.avatar : '';
  }
  /* fills a circle with the person's picture, or their initials when they have none */
  function paintAvatar(el, p, photo) {
    var src = photo === undefined ? photoOf(p) : photo;
    el.textContent = '';
    if (src) {
      var img = new Image();
      img.alt = '';
      img.src = src;
      el.appendChild(img);
    } else if (p) {
      el.textContent = initials(p);
    }
  }
  function avatarHtml(p) {
    var src = photoOf(p);
    return src ? '<img src="' + src + '" alt="">' : esc(initials(p));
  }
  /* the signed-in person's name (wide screens) and picture button (always) in the top bar */
  function updateWho() {
    var p = state.profile, who = $('#who'), av = $('#btn-profile');
    who.textContent = p ? (p.full_name || p.email || '') : '';
    who.hidden = !who.textContent;
    paintAvatar(av, p);
    av.hidden = !p;
  }

  function resizeToAvatar(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) { reject(new Error('empty')); return; }
        var c = document.createElement('canvas');
        c.width = c.height = 256;
        var g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, 256, 256);
        g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
        var q = 0.86, out = c.toDataURL('image/jpeg', q);
        while (out.length > 90000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
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

  var state = { session: null, profile: null, isAdmin: false, canUse: false, deptKnown: false, can201: false, path: [], entries: [], filter: '' };

  /* The five HR departments. The 201 Files are for Staffing and Recruitment and Legal Compliance. */
  var DEPTS = { staffing: 'Staffing and Recruitment', training: 'Training and Development', engagement: 'Employee Engagement', rewards: 'Total Rewards', legal: 'Legal Compliance' };
  var FILE_DEPTS = ['staffing', 'legal'];

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
  var ICON_DEACTIVATE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5M22 8l-5 5"/></svg>';
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
      input.maxLength = o.max || 60;
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

  /* ---------- activity log: a line for each file and account action (the database adds who and when) ---------- */
  function logAction(action, target, detail) {
    try {
      sb.rpc('log_action', { action: action, target: target || null, detail: detail || null }).then(function () {}, function () {});
    } catch (x) { /* logging never stops the work */ }
  }

  /* The pieces the Content Manager (content.js) shares with this page. */
  window.MembersApp = {
    sb: sb, state: state, esc: esc, toast: toast, ask: ask, logAction: logAction,
    fmtDate: fmtDate, fmtSize: fmtSize, extOf: extOf, cleanName: cleanName, maxMb: MAX_MB, depts: DEPTS
  };

  /* What the signed-in person can open. The 201 Files are for the Administrator and for Senior
     Managers of Staffing and Recruitment and Legal Compliance. Everyone keeps the Content and
     Accounts tabs. */
  var TAB_TITLES = { library: '201 Files', content: 'Content Manager', employees: 'Employee Directory', records: 'Restricted Records', people: 'Accounts' };
  function applyAccess() {
    var files = state.canUse && state.can201;
    $$('.manager-only').forEach(function (el) { el.hidden = !files; });
    $('#tab-library').hidden = !files;
    $('#tabs').hidden = false;
    /* The Employee Directory is for the Administrator and Staffing and Recruitment. */
    $('#tab-employees').hidden = !(state.canUse && (state.isAdmin || (state.profile && state.profile.department === 'staffing')));
    $('#tabs').style.setProperty('--n', String(visibleTabs().length));
    $('#pf-back-text').textContent = 'Back';
    $('#dept-note').hidden = !(state.deptKnown && !state.isAdmin && !state.profile.department);
  }

  /* ---------- session flow ---------- */
  async function enterApp(session) {
    state.session = session;
    var res = await sb.from('profiles')
      .select('id,email,full_name,role,active,created_at')
      .eq('id', session.user.id)
      .maybeSingle();
    var p = res.data;
    if (res.error || !p || !p.active || (p.role !== 'admin' && p.role !== 'senior_manager')) {
      state.profile = null;
      show('denied');
      return;
    }
    /* The picture is read separately so the page still opens if the latest database update
       (which adds that column) hasn't been run yet. */
    var pic = await sb.from('profiles').select('avatar').eq('id', session.user.id).maybeSingle();
    p.avatar = pic.error || !pic.data ? null : pic.data.avatar || null;
    /* Same for the department (added by the access update). Until that update is run the page
       behaves as before and every Senior Manager can open the 201 Files. */
    var dep = await sb.from('profiles').select('department').eq('id', session.user.id).maybeSingle();
    state.deptKnown = !dep.error && !!dep.data;
    p.department = state.deptKnown ? dep.data.department || null : null;
    state.profile = p;
    state.isAdmin = p.role === 'admin';   // the hidden owner: also sets roles and departments
    state.canUse = true;                   // every Senior Manager and the owner: the Accounts tab
    state.can201 = state.isAdmin || !state.deptKnown || FILE_DEPTS.indexOf(p.department) !== -1;
    applyAccess();
    setTab(state.can201 ? 'library' : 'content');
    if (onProfileUrl()) { fillProfile(); show('profile'); } else show('app');
    state.path = [];
    state.filter = '';
    $('#search').value = '';
    if (state.can201) await loadFolder();
  }

  function resetToSignIn() {
    if ($('#viewer').open) $('#viewer').close();
    index = null;
    indexPromise = null;
    if (window.MembersContent) window.MembersContent.reset();
    if (window.MembersEmployees) window.MembersEmployees.reset();
    if (window.MembersRecords) window.MembersRecords.reset();
    state.session = null;
    state.profile = null;
    state.isAdmin = false;
    state.canUse = false;
    state.can201 = false;
    state.deptKnown = false;
    people = [];
    if (location.search) history.replaceState(null, '', location.pathname);
    $('#form-login').reset();
    note($('#login-msg'), '');
    show('auth');
  }

  async function boot() {
    show('loading');

    if (linkError) {
      show('auth');
      note($('#login-msg'), 'That link has expired or was already used. Sign in, use "Forgot your password?", or ask a Senior Manager for a new invitation.', 'bad');
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
    note(msg, 'If that email belongs to an account, a reset link is on its way.', 'ok');
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
  var TAB_NAMES = ['library', 'content', 'employees', 'records', 'people'];
  function visibleTabs() { return TAB_NAMES.filter(function (n) { return !$('#tab-' + n).hidden; }); }
  function setTab(name) {
    var open = visibleTabs();
    if (open.indexOf(name) === -1) name = open[0];
    TAB_NAMES.forEach(function (n) {
      var on = n === name;
      $('#tab-' + n).setAttribute('aria-selected', String(on));
      $('#tab-' + n).tabIndex = on ? 0 : -1;
      $('#panel-' + n).hidden = !on;
    });
    $('#tabs').style.setProperty('--pos', String(open.indexOf(name)));
    $('#app-title').textContent = TAB_TITLES[name];
    if (name === 'people') loadPeople();
    if (name === 'content' && window.MembersContent) window.MembersContent.open();
    if (name === 'employees' && window.MembersEmployees) window.MembersEmployees.open();
    if (name === 'records' && window.MembersRecords) window.MembersRecords.open();
  }
  TAB_NAMES.forEach(function (n) {
    $('#tab-' + n).addEventListener('click', function () { setTab(n); });
  });
  $('#tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    var open = visibleTabs();
    var cur = TAB_NAMES.filter(function (n) { return $('#tab-' + n).getAttribute('aria-selected') === 'true'; })[0];
    var i = open.indexOf(cur);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = open.length - 1;
    else i = Math.max(0, Math.min(open.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
    setTab(open[i]);
    $('#tab-' + open[i]).focus();
  });

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
    var html = '<button type="button" data-go="0"' + (state.path.length ? '' : ' aria-current="true"') + '>201 Files</button>';
    state.path.forEach(function (seg, i) {
      var last = i === state.path.length - 1;
      html += '<span class="sep" aria-hidden="true">/</span><button type="button" data-go="' + (i + 1) + '"' +
        (last ? ' aria-current="true"' : '') + '>' + esc(seg) + '</button>';
    });
    $('#crumbs').innerHTML = html;
  }

  function rowHtml(e) {
    var n = esc(e.name);
    var del = state.canUse
      ? '<button class="icon-btn danger" type="button" data-act="delete" aria-label="Delete ' + (e.folder ? 'folder ' : '') + n + '">' + ICON_TRASH + '</button>'
      : '';
    if (e.folder) {
      return '<li class="row" data-name="' + n + '" data-kind="folder">' +
        '<button class="row-main" type="button" data-act="open"><span class="ico folder">' + ICON_FOLDER + '</span>' +
        '<span class="row-text"><span class="row-name">' + n + '</span><span class="row-meta">Folder</span></span></button>' + del + '</li>';
    }
    var meta = [fmtSize(e.size), fmtDate(e.updated)].filter(Boolean).join(' · ');
    return '<li class="row" data-name="' + n + '" data-kind="file">' +
      '<button class="row-main" type="button" data-act="preview" title="' + (isPdf(e.name) ? 'Preview' : 'Open in a new tab') + '"><span class="ico">' + esc(extOf(e.name)) + '</span>' +
      '<span class="row-text"><span class="row-name">' + n + '</span><span class="row-meta">' + esc(meta) + '</span></span></button>' +
      '<button class="icon-btn" type="button" data-act="download" aria-label="Download ' + n + '">' + ICON_DOWN + '</button>' + del + '</li>';
  }

  function render() {
    renderCrumbs();
    $('#btn-back').hidden = !state.path.length;
    var q = state.filter.trim().toLowerCase();
    var items = state.entries.filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) !== -1; });
    $('#rows').innerHTML = items.map(rowHtml).join('');
    var empty = $('#empty');
    if (!state.entries.length) {
      empty.textContent = state.canUse
        ? 'This folder is empty. Upload files or drag them here.'
        : 'This folder is empty.';
      empty.hidden = false;
    } else if (!items.length) {
      empty.textContent = 'Nothing in this folder matches "' + $('#search').value.trim() + '". Choose a suggestion to jump to another folder.';
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

  $('#btn-back').addEventListener('click', function () {
    if (!state.path.length) return;
    state.path.pop();
    state.filter = '';
    $('#search').value = '';
    loadFolder();
  });

  /* ---------- search suggestions (across every folder) ---------- */
  var index = null, indexPromise = null;
  var sug = { items: [], active: -1 };

  function dirtyIndex() { index = null; indexPromise = null; }

  async function walk(folder, depth, out) {
    var res = await sb.storage.from(BUCKET).list(folder, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (res.error) throw res.error;
    var subs = [];
    (res.data || []).forEach(function (e) {
      if (!e.name || e.name.charAt(0) === '.') return;
      var p = folder ? folder + '/' + e.name : e.name;
      if (!e.id) {
        out.push({ name: e.name, path: p, dir: folder, folder: true });
        if (depth < 8) subs.push(p);
      } else {
        out.push({ name: e.name, path: p, dir: folder, folder: false });
      }
    });
    for (var i = 0; i < subs.length && out.length < 5000; i++) await walk(subs[i], depth + 1, out);
  }

  function ensureIndex() {
    if (index) return Promise.resolve(index);
    if (!indexPromise) {
      indexPromise = (async function () {
        var out = [];
        try { await walk('', 0, out); } catch (e) { indexPromise = null; throw e; }
        index = out;
        return out;
      })();
    }
    return indexPromise;
  }

  function scoreOf(name, token) {
    var n = name.toLowerCase(), i = n.indexOf(token);
    if (i < 0) return -1;
    if (i === 0) return 3;
    return /[\s._\-(]/.test(n.charAt(i - 1)) ? 2 : 1;
  }

  function highlight(text, tokens) {
    var low = text.toLowerCase(), on = [];
    for (var k = 0; k < text.length; k++) on.push(false);
    tokens.forEach(function (t) {
      var i = low.indexOf(t);
      while (i !== -1) {
        for (var j = i; j < i + t.length; j++) on[j] = true;
        i = low.indexOf(t, i + t.length);
      }
    });
    var out = '', open = false;
    for (var c = 0; c < text.length; c++) {
      if (on[c] && !open) { out += '<mark>'; open = true; }
      if (!on[c] && open) { out += '</mark>'; open = false; }
      out += esc(text.charAt(c));
    }
    return out + (open ? '</mark>' : '');
  }

  function closeSuggest() {
    $('#suggest').hidden = true;
    $('#search').setAttribute('aria-expanded', 'false');
    $('#search').removeAttribute('aria-activedescendant');
    sug.items = [];
    sug.active = -1;
  }

  function setActive(i) {
    sug.active = i;
    $$('#suggest li[role="option"]').forEach(function (li, n) {
      var on = n === i;
      li.setAttribute('aria-selected', String(on));
      if (on) {
        $('#search').setAttribute('aria-activedescendant', li.id);
        li.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  async function updateSuggest() {
    var raw = $('#search').value.trim();
    var q = raw.toLowerCase();
    var box = $('#suggest');
    if (!q) { closeSuggest(); return; }
    var tokens = q.split(/\s+/).filter(Boolean);
    box.hidden = false;
    $('#search').setAttribute('aria-expanded', 'true');
    if (!index) box.innerHTML = '<li class="snote" role="presentation">Searching all folders…</li>';

    var data;
    try { data = await ensureIndex(); }
    catch (err) { box.innerHTML = '<li class="snote" role="presentation">Couldn\'t search all folders.</li>'; return; }
    if ($('#search').value.trim().toLowerCase() !== q) return; // the text changed while we were loading

    var hits = [];
    data.forEach(function (item) {
      var s0 = scoreOf(item.name, tokens[0]);
      if (s0 < 0) return;
      for (var t = 1; t < tokens.length; t++) if (item.name.toLowerCase().indexOf(tokens[t]) < 0) return;
      hits.push({ item: item, score: s0 });
    });
    hits.sort(function (a, b) {
      return b.score - a.score ||
        (a.item.folder === b.item.folder ? 0 : a.item.folder ? -1 : 1) ||
        a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    sug.items = hits.slice(0, 8).map(function (h) { return h.item; });
    sug.active = -1;

    if (!sug.items.length) {
      box.innerHTML = '<li class="snote" role="presentation">No files or folders match "' + esc(raw) + '".</li>';
      return;
    }
    box.innerHTML = sug.items.map(function (it, i) {
      var where = ['201 Files'].concat(it.dir ? it.dir.split('/') : []).join(' / ');
      return '<li id="sg-' + i + '" role="option" aria-selected="false" data-i="' + i + '">' +
        '<span class="sico' + (it.folder ? ' folder' : '') + '">' + (it.folder ? ICON_FOLDER : esc(extOf(it.name))) + '</span>' +
        '<span class="stxt"><span class="sname">' + highlight(it.name, tokens) + '</span>' +
        '<span class="spath">' + esc(it.folder ? 'Folder in ' + where : where) + '</span></span></li>';
    }).join('');
  }

  async function chooseSuggestion(item) {
    closeSuggest();
    $('#search').value = '';
    state.filter = '';
    state.path = item.folder ? item.path.split('/') : (item.dir ? item.dir.split('/') : []);
    await loadFolder();
    if (!item.folder) {
      var row = $$('#rows li.row').filter(function (li) { return li.dataset.name === item.name; })[0];
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.add('flash');
        setTimeout(function () { row.classList.remove('flash'); }, 3000);
      }
    }
  }

  $('#search').addEventListener('input', function (e) {
    state.filter = e.target.value;
    render();
    updateSuggest();
  });
  $('#search').addEventListener('focus', function () {
    ensureIndex().catch(function () { /* will report when the person types */ });
    if (this.value.trim()) updateSuggest();
  });
  $('#search').addEventListener('keydown', function (e) {
    var box = $('#suggest');
    if (box.hidden) {
      if (e.key === 'ArrowDown' && this.value.trim()) { e.preventDefault(); updateSuggest(); }
      return;
    }
    var n = sug.items.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive((sug.active + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive(sug.active <= 0 ? n - 1 : sug.active - 1); }
    else if (e.key === 'Enter' && sug.active >= 0) { e.preventDefault(); chooseSuggestion(sug.items[sug.active]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); }
    else if (e.key === 'Tab') { closeSuggest(); }
  });
  $('#suggest').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('#suggest').addEventListener('click', function (e) {
    var li = e.target.closest('li[data-i]');
    if (li) chooseSuggestion(sug.items[Number(li.dataset.i)]);
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#search-box')) closeSuggest();
  });

  async function signedUrl(name, download) {
    var res = await sb.storage.from(BUCKET).createSignedUrl(prefix() + name, 120, download ? { download: name } : undefined);
    if (res.error || !res.data) throw res.error || new Error('No link');
    return res.data.signedUrl;
  }

  function isPdf(name) { return /\.pdf$/i.test(name); }

  /* ---------- PDF viewer ----------
     PDFs open in a full-screen viewer on this page. The file is fetched with the person's own
     sign-in (so the same storage rules apply), then drawn page by page with pdf.js. The library
     is only downloaded the first time a PDF is opened, and is pinned to an exact file (SRI). */
  var PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
  var PDFJS_SRI = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';
  var ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  var pdfjsReady = null;
  var V = { token: 0, name: '', blob: null, doc: null, zoom: 2, pages: [], io: null, ticking: false };

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsReady) {
      pdfjsReady = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = PDFJS_BASE + 'pdf.min.js';
        sc.integrity = PDFJS_SRI;
        sc.crossOrigin = 'anonymous';
        sc.onload = function () {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        sc.onerror = function () { pdfjsReady = null; reject(new Error('The PDF viewer could not load')); };
        document.head.appendChild(sc);
      });
    }
    return pdfjsReady;
  }

  function vMessage(text, loading) {
    var box = $('#v-state');
    box.innerHTML = (loading ? '<div class="spinner" aria-hidden="true"></div>' : '') + (text ? '<p>' + esc(text) + '</p>' : '');
    box.hidden = !text;
  }

  function vReset() {
    V.token++;
    if (V.io) { V.io.disconnect(); V.io = null; }
    V.pages.forEach(function (p) { if (p.task) { try { p.task.cancel(); } catch (e) { /* already done */ } } });
    if (V.doc) { try { V.doc.destroy(); } catch (e) { /* already gone */ } }
    V.doc = null;
    V.blob = null;
    V.pages = [];
    $('#v-pages').innerHTML = '';
    $('#v-count').textContent = '';
    $('#v-download').disabled = true;
  }

  function vZoomLabel() {
    $('#v-zoom-reset').textContent = Math.round(ZOOMS[V.zoom] * 100) + '%';
    $('#v-zoom-out').disabled = V.zoom <= 0;
    $('#v-zoom-in').disabled = V.zoom >= ZOOMS.length - 1;
  }

  function vUnrender(p) {
    if (p.task) { try { p.task.cancel(); } catch (e) { /* already done */ } p.task = null; }
    p.canvas.width = 0;
    p.canvas.height = 0;
    p.drawnW = 0;
  }

  async function vRender(p) {
    var cssW = p.cssW;
    if (p.drawnW === cssW || p.drawing === cssW) return;
    var token = V.token;
    p.drawing = cssW;
    if (p.task) { try { p.task.cancel(); } catch (e) { /* already done */ } }
    try {
      var page = await V.doc.getPage(p.num);
      if (token !== V.token) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      dpr = Math.min(dpr, 4096 / cssW, 4096 / p.cssH);   // keep the drawing a sane size on very large pages
      var vp = page.getViewport({ scale: (cssW / p.baseW) * dpr });
      var canvas = p.canvas;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      p.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      await p.task.promise;
      p.drawnW = cssW;
    } catch (err) {
      /* a cancelled draw (zoomed or scrolled away) is expected; anything else leaves the page blank */
    } finally {
      if (p.drawing === cssW) p.drawing = 0;
    }
  }

  function vLayout() {
    var body = $('#v-body'), avail = Math.max(160, body.clientWidth - (window.innerWidth <= 560 ? 20 : 36));
    var w = avail * ZOOMS[V.zoom];
    V.pages.forEach(function (p) {
      p.cssW = Math.round(w);
      p.cssH = Math.round(w * p.baseH / p.baseW);
      p.box.style.width = p.cssW + 'px';
      p.box.style.height = p.cssH + 'px';
      if (p.drawnW && p.drawnW !== p.cssW) vUnrender(p);
      if (p.visible) vRender(p);
    });
    vZoomLabel();
  }

  function vSetZoom(i) {
    i = Math.max(0, Math.min(ZOOMS.length - 1, i));
    if (i === V.zoom) return;
    var body = $('#v-body'), ratio = body.scrollTop / (body.scrollHeight || 1);
    V.zoom = i;
    vLayout();
    body.scrollTop = ratio * body.scrollHeight;
    vCount();
  }

  function vCount() {
    if (!V.pages.length) return;
    var body = $('#v-body'), top = body.getBoundingClientRect().top + body.clientHeight * 0.35, cur = V.pages.length;
    for (var i = 0; i < V.pages.length; i++) {
      if (V.pages[i].box.getBoundingClientRect().bottom > top) { cur = i + 1; break; }
    }
    $('#v-count').textContent = V.pages.length === 1 ? '1 page' : 'Page ' + cur + ' of ' + V.pages.length;
  }

  async function openViewer(name) {
    var path = prefix() + name, dlg = $('#viewer');
    vReset();
    var token = V.token;
    V.name = name;
    V.zoom = 2;
    $('#v-title').textContent = name;
    $('#v-title').title = name;
    vZoomLabel();
    vMessage('Opening…', true);
    if (!dlg.open) dlg.showModal();
    $('#v-body').scrollTop = 0;
    try {
      var res = await sb.storage.from(BUCKET).download(path);
      if (res.error || !res.data) throw new Error('download');
      if (token !== V.token) return;
      V.blob = res.data;
      V.path = path;
      logAction('file.view', path);
      $('#v-download').disabled = false;
    } catch (err) {
      if (token === V.token) vMessage("Couldn't open this file. You may not have permission.");
      return;
    }
    try {
      var lib = await loadPdfJs();
      var buf = await V.blob.arrayBuffer();
      var doc = await lib.getDocument({ data: buf }).promise;
      if (token !== V.token) { doc.destroy(); return; }
      V.doc = doc;
      var holder = $('#v-pages'), frag = document.createDocumentFragment();
      for (var n = 1; n <= doc.numPages; n++) {
        var page = await doc.getPage(n);
        if (token !== V.token) return;
        var vp = page.getViewport({ scale: 1 });
        var box = document.createElement('div');
        box.className = 'v-sheet';
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', 'Page ' + n + ' of ' + doc.numPages);
        var canvas = document.createElement('canvas');
        box.appendChild(canvas);
        frag.appendChild(box);
        V.pages.push({ num: n, box: box, canvas: canvas, baseW: vp.width, baseH: vp.height, cssW: 0, cssH: 0, drawnW: 0, drawing: 0, task: null, visible: false });
      }
      holder.appendChild(frag);
      V.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var p = V.pages.filter(function (x) { return x.box === en.target; })[0];
          if (!p) return;
          p.visible = en.isIntersecting;
          if (en.isIntersecting) vRender(p); else vUnrender(p);
        });
      }, { root: $('#v-body'), rootMargin: '1200px 0px' });
      V.pages.forEach(function (p) { V.io.observe(p.box); });
      vMessage('');
      vLayout();
      vCount();
    } catch (err) {
      if (token !== V.token) return;
      vMessage(err && err.name === 'PasswordException'
        ? "This PDF is password-protected, so it can't be previewed. Download it to open it."
        : "This PDF couldn't be displayed. You can still download it.");
    }
  }

  $('#viewer').addEventListener('close', vReset);
  $('#v-close').addEventListener('click', function () { $('#viewer').close(); });
  $('#v-zoom-in').addEventListener('click', function () { vSetZoom(V.zoom + 1); });
  $('#v-zoom-out').addEventListener('click', function () { vSetZoom(V.zoom - 1); });
  $('#v-zoom-reset').addEventListener('click', function () { vSetZoom(2); });
  $('#v-download').addEventListener('click', function () {
    if (!V.blob) return;
    logAction('file.download', V.path);
    var url = URL.createObjectURL(V.blob), a = document.createElement('a');
    a.href = url;
    a.download = V.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });
  $('#v-body').addEventListener('scroll', function () {
    if (V.ticking) return;
    V.ticking = true;
    requestAnimationFrame(function () { V.ticking = false; vCount(); });
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (!$('#viewer').open || !V.pages.length) return;
    clearTimeout(V.resizeTimer);
    V.resizeTimer = setTimeout(function () { vLayout(); vCount(); }, 150);
  });
  $('#viewer').addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); vSetZoom(V.zoom + 1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); vSetZoom(V.zoom - 1); }
    else if (e.key === '0') { e.preventDefault(); vSetZoom(2); }
  });

  async function preview(name) {
    if (isPdf(name)) { openViewer(name); return; }
    var w = window.open('about:blank', '_blank');
    try {
      var url = await signedUrl(name, false);
      logAction('file.view', prefix() + name);
      if (w) { w.opener = null; w.location.href = url; } else { location.href = url; }
    } catch (err) {
      if (w) w.close();
      toast("Couldn't open that file.", 'bad');
    }
  }

  async function download(name) {
    try {
      var url = await signedUrl(name, true);
      logAction('file.download', prefix() + name);
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
      title: isFolder ? 'Delete This Folder?' : 'Delete This File?',
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
      logAction(isFolder ? 'folder.delete' : 'file.delete', prefix() + name, { items: removed });
      toast(isFolder ? 'Folder deleted.' : 'File deleted.', 'ok');
    } catch (err) {
      toast("Couldn't delete that. You may not have permission.", 'bad');
    }
    dirtyIndex();
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

  /* ---------- upload and new folder ---------- */
  async function uploadFiles(files) {
    if (!state.canUse || !files.length) return;
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
      } else { ok++; logAction('file.upload', prefix() + cleanName(f.name)); }
    }
    setBusy('');
    if (ok && !failed.length) toast(ok === 1 ? 'File uploaded.' : ok + ' files uploaded.', 'ok');
    else if (ok) toast(ok + ' uploaded. Not uploaded: ' + failed.join(', '), 'bad');
    else toast('Nothing uploaded: ' + failed.join(', '), 'bad');
    dirtyIndex();
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
      if (!state.canUse) return;
      e.preventDefault();
      drop.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function () { drop.classList.remove('drag'); });
  });
  drop.addEventListener('drop', function (e) {
    if (!state.canUse) return;
    e.preventDefault();
    uploadFiles(Array.prototype.slice.call(e.dataTransfer.files));
  });

  $('#btn-folder').addEventListener('click', async function () {
    var name = await ask({
      title: 'New Folder',
      label: 'Folder Name',
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
    if (res.error) toast("Couldn't create the folder.", 'bad'); else { toast('Folder created.', 'ok'); logAction('folder.create', prefix() + clean); }
    dirtyIndex();
    await loadFolder();
  });

  /* ---------- people (Senior Managers; only the owner sets roles) ---------- */
  var people = [];
  var showInactive = false;

  function roleControl(p, label, me) {
    if (!state.isAdmin) return '<div class="pfield"><span class="plabel">Role</span><span class="role-tag">' + (p.role === 'admin' ? 'Administrator' : 'Senior Manager') + '</span></div>';
    return '<label class="pfield"><span class="plabel">Role</span><select data-act="role" aria-label="Role for ' + label + '"' + (me ? ' disabled' : '') + '>' +
      '<option value="senior_manager"' + (p.role === 'senior_manager' ? ' selected' : '') + '>Senior Manager</option>' +
      '<option value="admin"' + (p.role === 'admin' ? ' selected' : '') + '>Administrator</option></select></label>';
  }

  /* Department: the Administrator picks it; everyone else just sees it. Hidden until the database
     update that adds departments has been run. */
  function deptControl(p, label) {
    if (!state.deptKnown || p.role === 'admin') return '';
    if (!state.isAdmin) {
      return '<div class="pfield pdept"><span class="plabel">Department</span><span class="role-tag' + (p.department ? '' : ' is-none') + '">' +
        esc(p.department ? DEPTS[p.department] || p.department : 'Not set') + '</span></div>';
    }
    return '<label class="pfield pdept"><span class="plabel">Department</span><select data-act="dept" aria-label="Department for ' + label + '">' +
      '<option value=""' + (p.department ? '' : ' selected') + '>Not set</option>' +
      Object.keys(DEPTS).map(function (k) {
        return '<option value="' + k + '"' + (p.department === k ? ' selected' : '') + '>' + DEPTS[k] + '</option>';
      }).join('') + '</select></label>';
  }

  function personRow(p) {
    var me = p.id === state.session.user.id;
    var label = esc(p.full_name || p.email || 'Unnamed');
    var actions = p.active
      ? '<button class="icon-btn outline" type="button" data-act="toggle" data-to="off" aria-label="Deactivate ' + label + '" title="' + (me ? "You can't deactivate your own account" : 'Deactivate') + '"' + (me ? ' disabled' : '') + '>' + ICON_DEACTIVATE + '</button>'
      : '<button class="btn btn-ghost btn-sm" type="button" data-act="toggle" data-to="on">Reactivate</button>' +
        '<button class="btn btn-ghost btn-sm btn-warn" type="button" data-act="delete">Delete</button>';
    /* the name leads; the email sits underneath (and stands in as the title when there is no name) */
    var nameLine = p.full_name ? esc(p.full_name) + (me ? ' (you)' : '') : '<span class="no-name">No name added</span>';
    return '<li class="row person' + (p.active ? '' : ' is-off') + '" data-id="' + esc(p.id) + '" data-email="' + esc(p.email || '') + '">' +
      '<div class="pid"><span class="pav" aria-hidden="true">' + avatarHtml(p) + '</span>' +
      '<div class="row-text"><span class="row-name">' + nameLine + '</span>' +
      '<span class="row-meta">' + esc(p.email || '') + (!p.full_name && me ? ' (you)' : '') + '</span></div></div>' +
      '<div class="pfield"><span class="plabel">Status</span><span class="status ' + (p.active ? 'on' : 'off') + '">' + (p.active ? 'Active' : 'Deactivated') + '</span></div>' +
      roleControl(p, label, me) + deptControl(p, label) + '<div class="pactions">' + actions + '</div></li>';
  }

  function renderPeople() {
    var active = people.filter(function (p) { return p.active; });
    var inactive = people.filter(function (p) { return !p.active; });
    var html = active.map(personRow).join('');
    if (!people.length) html = '<li class="empty">No accounts yet.</li>';
    if (inactive.length) {
      html += '<li class="row toggle-row"><button class="link" type="button" data-act="toggle-inactive">' +
        (showInactive ? 'Hide' : 'Show') + ' deactivated accounts (' + inactive.length + ')</button></li>';
      if (showInactive) html += inactive.map(personRow).join('');
    } else {
      showInactive = false;
    }
    $('#people').innerHTML = html;
    $('#people-count').textContent = active.length + (active.length === 1 ? ' active account' : ' active accounts');
  }

  async function loadPeople() {
    if (!state.canUse) return;
    var list = $('#people');
    if (!people.length) list.innerHTML = '<li class="empty">Loading…</li>';
    var cols = 'id,email,full_name,role,active,created_at';
    var load = function (c) {
      return sb.from('profiles').select(c).eq('hidden', false).order('created_at', { ascending: true });
    };
    /* the picture and department columns aren't there until the database updates are run */
    var res = null, extras = [',avatar,department', ',department', ',avatar', ''];
    for (var k = 0; k < extras.length; k++) {
      res = await load(cols + extras[k]);
      if (!res.error) break;
    }
    if (res.error) {
      list.innerHTML = '<li class="empty">Couldn\'t load the list.</li>';
      return;
    }
    people = res.data || [];
    renderPeople();
  }

  async function updateProfile(id, patch, okMessage) {
    var res = await sb.from('profiles').update(patch).eq('id', id).select('id').maybeSingle();
    if (res.error || !res.data) { toast("Couldn't save that change.", 'bad'); return false; }
    toast(okMessage || 'Saved.', 'ok');
    return true;
  }

  async function removeAccount(id, email) {
    var ok = await ask({
      title: 'Delete This Account?',
      text: (email || 'This account') + ' will be removed for good and can be invited again later. Files they uploaded stay in the library.',
      ok: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      var cur = await sb.auth.getSession();
      var token = cur.data.session && cur.data.session.access_token;
      var res = await fetch('../api/remove-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ id: id })
      });
      var body = {};
      try { body = await res.json(); } catch (x) { /* not JSON */ }
      if (res.ok) { toast('Account deleted.', 'ok'); logAction('account.delete', email); }
      else toast(body.error || 'Deleting accounts only works on the Vercel version of the website. Use Supabase, then Authentication, then Users instead.', 'bad');
    } catch (err) {
      toast("Couldn't reach the server. Check your connection and try again.", 'bad');
    }
    loadPeople();
  }

  $('#people').addEventListener('change', async function (e) {
    var sel = e.target.closest('select[data-act="role"], select[data-act="dept"]');
    if (!sel) return;
    var li = sel.closest('li'), id = li.dataset.id;
    var isDept = sel.dataset.act === 'dept';
    var patch = isDept ? { department: sel.value || null } : { role: sel.value };
    if (await updateProfile(id, patch)) {
      logAction(isDept ? 'account.department' : 'account.role', li.dataset.email, isDept ? { department: sel.value || null } : { role: sel.value });
      var who = people.filter(function (p) { return p.id === id; })[0];
      if (who) { if (isDept) who.department = sel.value || null; else who.role = sel.value; }
    } else {
      loadPeople();
    }
  });

  $('#people').addEventListener('click', async function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'toggle-inactive') { showInactive = !showInactive; renderPeople(); return; }
    var li = btn.closest('li');
    if (act === 'delete') { await removeAccount(li.dataset.id, li.dataset.email); return; }
    if (act !== 'toggle') return;

    var activate = btn.dataset.to === 'on';
    if (!activate) {
      var ok = await ask({
        title: 'Deactivate This Account?',
        text: 'They will lose access to the files right away. You can reactivate or delete them later.',
        ok: 'Deactivate',
        danger: true
      });
      if (!ok) return;
    }
    if (await updateProfile(li.dataset.id, { active: activate },
      activate ? 'Account reactivated.' : "Deactivated. You'll find them under \"Show deactivated accounts\".")) {
      logAction(activate ? 'account.activate' : 'account.deactivate', li.dataset.email);
    }
    loadPeople();
  });

  /* ---------- profile settings page: picture, name, password ---------- */
  var pf = { photo: '' };          // the picture shown in the form: a data URL, or '' for none
  var pushedProfile = false;

  function paintPhoto() {
    paintAvatar($('#pf-avatar'), { full_name: $('#pf-name').value, email: state.profile.email }, pf.photo);
    $('#pf-remove').hidden = !pf.photo;
    $('#pf-avatar').parentNode.classList.toggle('has-photo', !!pf.photo);
    $('#pf-upload').textContent = pf.photo ? 'Change Photo' : 'Upload Photo';
  }
  function fillProfile() {
    var p = state.profile;
    pf.photo = photoOf(p);
    $('#pf-name').value = p.full_name || '';
    $('#pf-email').value = p.email || '';
    $('#pf-role').textContent = p.role === 'admin' ? 'Administrator' : 'Senior Manager';
    $('#pf-dept').textContent = p.role === 'admin' ? 'All departments' : !state.deptKnown ? 'Not available' : p.department ? DEPTS[p.department] || p.department : 'Not set';
    $('#pf-since').textContent = fmtDate(p.created_at) || 'Not available';
    note($('#profile-msg'), '');
    resetPasswordForm();
    paintPhoto();
  }
  function openProfile() {
    if (!state.profile) return;
    if (!onProfileUrl()) {
      history.pushState(null, '', location.pathname + '?profile');
      pushedProfile = true;
    }
    fillProfile();
    show('profile');
    window.scrollTo(0, 0);
  }
  function closeProfile() {
    if (pushedProfile) { pushedProfile = false; history.back(); return; }
    history.replaceState(null, '', location.pathname);
    show('app');
  }

  $('#btn-profile').addEventListener('click', openProfile);
  $('#pf-back').addEventListener('click', closeProfile);
  window.addEventListener('popstate', function () {
    if (!state.profile) return;
    if (onProfileUrl()) { fillProfile(); show('profile'); } else show('app');
  });

  $('#pf-name').addEventListener('input', function () { if (!pf.photo) paintPhoto(); });
  $('#pf-upload').addEventListener('click', function () { $('#pf-file').click(); });
  $('#pf-remove').addEventListener('click', function () { pf.photo = ''; paintPhoto(); });
  $('#pf-discard').addEventListener('click', fillProfile);
  $('#pf-file').addEventListener('change', async function () {
    var f = this.files && this.files[0];
    this.value = '';
    var msg = $('#profile-msg');
    if (!f) return;
    if (!/^image\//.test(f.type)) { note(msg, 'Choose an image file (JPG or PNG).', 'bad'); return; }
    if (f.size > 15 * 1048576) { note(msg, 'That image is too large. Choose one under 15 MB.', 'bad'); return; }
    try {
      pf.photo = await resizeToAvatar(f);
      note(msg, '');
      paintPhoto();
    } catch (err) {
      note(msg, "Couldn't read that image. Try a JPG or PNG.", 'bad');
    }
  });

  $('#form-profile').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = $('#profile-msg'), btn = $('#pf-save');
    var name = $('#pf-name').value.trim();
    if (name.length > 80) { note(msg, 'Use 80 characters or fewer.', 'bad'); return; }
    btn.disabled = true;
    note(msg, '');
    var res = await sb.rpc('set_my_profile', {
      new_name: name,
      new_avatar: pf.photo || null,
      change_avatar: pf.photo !== photoOf(state.profile)
    });
    btn.disabled = false;
    if (res.error || !res.data) {
      note(msg, res.error && res.error.code === 'PGRST202'
        ? "Saving isn't set up yet: the latest database update hasn't been run in Supabase."
        : "Couldn't save your changes. Please try again.", 'bad');
      return;
    }
    state.profile.full_name = res.data.full_name || '';
    state.profile.avatar = res.data.avatar || null;
    updateWho();
    people = [];
    fillProfile();
    note(msg, 'Saved.', 'ok');
    toast('Profile saved.', 'ok');
  });

  /* ---------- password form: an error under each field, and show/hide on every field ---------- */
  var PW_FIELDS = ['np-current', 'np-new', 'np-confirm'];

  function fieldError(id, msg) {
    var input = $('#' + id), err = $('#' + id + '-err');
    err.textContent = msg || '';
    err.hidden = !msg;
    input.closest('.field').classList.toggle('invalid', !!msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function setPwVisible(btn, show) {
    var input = $('#' + btn.dataset.for);
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.title = show ? 'Hide password' : 'Show password';
  }
  function resetPasswordForm() {
    $('#form-newpass').reset();
    PW_FIELDS.forEach(function (id) { fieldError(id, ''); });
    $$('.pw-toggle').forEach(function (b) { setPwVisible(b, false); });
    note($('#newpass-msg'), '');
  }

  $$('.pw-toggle').forEach(function (btn) {
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep the keyboard and cursor in the field
    btn.addEventListener('click', function () {
      setPwVisible(btn, btn.getAttribute('aria-pressed') !== 'true');
    });
  });
  PW_FIELDS.forEach(function (id) {
    $('#' + id).addEventListener('input', function () { fieldError(id, ''); note($('#newpass-msg'), ''); });
  });

  $('#form-newpass').addEventListener('submit', async function (e) {
    e.preventDefault();
    var cur = $('#np-current').value, a = $('#np-new').value, b = $('#np-confirm').value;
    var msg = $('#newpass-msg'), btn = $('#np-save');
    note(msg, '');

    /* check every field at once, so each one says what is wrong with it */
    var errs = {};
    if (!cur) errs['np-current'] = 'Enter your current password.';
    if (!a) errs['np-new'] = 'Enter a new password.';
    else if (a.length < 10) errs['np-new'] = 'Use at least 10 characters.';
    else if (cur && a === cur) errs['np-new'] = 'Choose a password that is different from your current one.';
    if (!b) errs['np-confirm'] = 'Confirm your new password.';
    else if (a && b !== a) errs['np-confirm'] = "The two passwords don't match.";
    var first = null;
    PW_FIELDS.forEach(function (id) {
      fieldError(id, errs[id]);
      if (errs[id] && !first) first = id;
    });
    if (first) { $('#' + first).focus(); return; }

    btn.disabled = true;
    /* Prove it's really them first: sign in again with the current password. */
    var check = await sb.auth.signInWithPassword({ email: state.profile.email, password: cur });
    if (check.error || !check.data || !check.data.session) {
      btn.disabled = false;
      fieldError('np-current', "Your current password isn't right.");
      $('#np-current').focus();
      return;
    }
    var res = await sb.auth.updateUser({ password: a });
    btn.disabled = false;
    if (res.error) {
      fieldError('np-new', res.error.message || "Couldn't update the password. Try again.");
      $('#np-new').focus();
      return;
    }
    resetPasswordForm();
    note(msg, 'Password updated.', 'ok');
    toast('Password updated.', 'ok');
  });

  $('#form-invite').addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = $('#i-email').value.trim();
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
        body: JSON.stringify({ email: email })
      });
      var body = {};
      try { body = await res.json(); } catch (x) { /* not JSON */ }
      if (res.ok) {
        note(msg, 'Invitation sent to ' + email + '.', 'ok');
        logAction('account.invite', email);
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
