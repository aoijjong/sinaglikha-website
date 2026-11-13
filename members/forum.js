/*
  SINAGLIKHA Employee Forum: moderation, for Employee Engagement Senior Managers and the Administrator.
  Employees post under their own name in the Employee Portal (through /api/employee-forum). Here a
  moderator sees every thread, hides, locks or deletes threads and posts, settles reports, and manages
  the categories. Hidden threads and posts never reach employees. The database rules in
  supabase/phase3.sql decide who can do what; this screen only shows what those rules allow.
  Opened from the Employee Forum card in the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var F = { box: null, ctx: null, tab: 'threads', people: {}, cats: [], threads: [], reports: [], thread: null, failed: false, token: 0 };

  function canModerate() { return state.isAdmin || (state.profile && state.profile.department === 'engagement'); }
  function who(id) { return F.people[id] ? F.people[id].full_name : 'Unknown'; }
  function cat(id) { return F.cats.filter(function (c) { return c.id === id; })[0] || null; }
  function sortedCats() {
    return F.cats.slice().sort(function (a, b) { return (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)); });
  }
  function busy(text) {
    var b = $('#fm-busy', F.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function empty(icon, title, text) {
    return '<div class="es"><span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p></div>';
  }
  function excerpt(s) { s = String(s || ''); return s.length > 140 ? s.slice(0, 140) + '…' : s; }

  /* ---------- the shell ---------- */
  function shell() {
    var open = F.reports.filter(function (r) { return !r.resolved; }).length;
    var tabs = [['threads', 'Threads'], ['reports', 'Reports' + (open ? ' ' + open : '')], ['categories', 'Categories']];
    F.box.style.position = 'relative';
    F.box.innerHTML = '<div class="ph">' + IB('back', F.thread ? 'Back to the threads' : 'Back to the deliverables', { 'data-a': F.thread ? 'threads-back' : 'back' }, 'line') +
      '<div class="ph-main"><h2>Employee Forum</h2><p class="sub">Moderation</p></div><div class="ph-actions">' +
      (F.tab === 'categories' && !F.thread ? IB('plus', 'Add a category', { 'data-a': 'add-cat' }, 'solid') : '') + '</div></div>' +
      (F.thread ? '' : '<div class="pills" role="group" aria-label="Show">' + tabs.map(function (t) {
        return '<button class="pill" type="button" data-tab="' + t[0] + '" aria-pressed="' + (F.tab === t[0]) + '">' + esc(t[1]) + '</button>';
      }).join('') + '</div>') +
      '<div id="fm-body"></div><div class="busy" id="fm-busy" hidden role="status">Loading…</div>';
  }

  async function loadAll() {
    var token = ++F.token;
    var c = await sb.from('forum_categories').select('*').limit(200);
    if (token !== F.token) return;
    F.failed = !!c.error;
    F.cats = c.data || [];
    if (!F.failed) {
      var t = await sb.from('forum_threads').select('id,category_id,employee_id,title,body,locked,hidden,created_at').order('created_at', { ascending: false }).limit(300);
      var r = await sb.from('forum_reports').select('*').order('created_at', { ascending: false }).limit(300);
      F.threads = t.data || [];
      F.reports = r.data || [];
    }
    var p = await sb.rpc('employee_options');
    (Array.isArray(p.data) ? p.data : []).forEach(function (x) { F.people[x.id] = x; });
    if (token !== F.token) return;
    render();
  }

  function render() {
    shell();
    var body = $('#fm-body', F.box);
    if (F.failed) { body.innerHTML = '<div class="list-card">' + empty('chat', 'Not set up yet', 'Run supabase/phase3.sql in the Supabase SQL editor, then reload this page.') + '</div>'; return; }
    if (F.thread) { renderThread(body); return; }
    if (F.tab === 'threads') renderThreads(body);
    else if (F.tab === 'reports') renderReports(body);
    else renderCats(body);
  }

  /* ---------- threads ---------- */
  function threadRow(t) {
    var c = cat(t.category_id);
    var meta = [c ? c.name : 'Unknown category', who(t.employee_id), app.fmtDate(t.created_at)].join(' · ');
    var chips = (t.hidden ? '<span class="chip t-hidden">Hidden</span>' : '') + (t.locked ? '<span class="chip t-locked">Locked</span>' : '');
    return '<li class="lrow" data-id="' + esc(t.id) + '"><button class="lmain" type="button" data-a="view"><span class="lico">' + I(t.locked ? 'lock' : 'chat') + '</span>' +
      '<span class="ltext"><span class="lname">' + esc(t.title) + '</span><span class="lmeta">' + esc(meta) + '</span></span></button>' +
      '<div class="lside">' + chips + '<div class="lacts">' +
      (t.hidden ? IB('eye', 'Show to employees again', { 'data-a': 'unhide' }, 'good') : IB('eyeOff', 'Hide from employees', { 'data-a': 'hide' })) +
      (t.locked ? IB('unlock', 'Unlock: allow replies', { 'data-a': 'unlock' }) : IB('lock', 'Lock: stop new replies', { 'data-a': 'lock' })) +
      IB('trash', 'Delete this thread', { 'data-a': 'del' }, 'danger') + '</div></div></li>';
  }
  function renderThreads(body) {
    body.innerHTML = '<div class="list-card">' + (F.threads.length ? '<ul class="rows">' + F.threads.map(threadRow).join('') + '</ul>'
      : empty('chat', 'No threads yet', 'When employees start threads in the portal they will appear here.')) + '</div>';
  }

  async function openThread(id) {
    var t = F.threads.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    busy('Loading…');
    var p = await sb.from('forum_posts').select('id,employee_id,body,hidden,created_at').eq('thread_id', id).order('created_at', { ascending: true }).limit(500);
    busy('');
    F.thread = { t: t, posts: p.data || [] };
    render();
  }
  function renderThread(body) {
    var t = F.thread.t;
    body.innerHTML = '<div class="list-card"><ul class="rows">' +
      '<li class="lrow" data-id="' + esc(t.id) + '"><div class="lmain" style="cursor:default"><span class="lico">' + I('chat') + '</span><span class="ltext"><span class="lname">' + esc(t.title) +
      '</span><span class="lmeta">' + esc(who(t.employee_id) + ' · ' + app.fmtDate(t.created_at)) + '</span><span class="lmeta" style="white-space:normal">' + esc(t.body) + '</span></span></div>' +
      '<div class="lside">' + (t.hidden ? '<span class="chip t-hidden">Hidden</span>' : '') + (t.locked ? '<span class="chip t-locked">Locked</span>' : '') + '</div></li>' +
      (F.thread.posts.length ? F.thread.posts.map(function (p) {
        return '<li class="lrow" data-post="' + esc(p.id) + '"><div class="lmain" style="cursor:default"><span class="lico">' + I('send') + '</span><span class="ltext"><span class="lname">' + esc(who(p.employee_id)) +
          '</span><span class="lmeta">' + esc(app.fmtDate(p.created_at)) + '</span><span class="lmeta" style="white-space:normal">' + esc(p.body) + '</span></span></div>' +
          '<div class="lside">' + (p.hidden ? '<span class="chip t-hidden">Hidden</span>' : '') + '<div class="lacts">' +
          (p.hidden ? IB('eye', 'Show this reply again', { 'data-a': 'post-unhide' }, 'good') : IB('eyeOff', 'Hide this reply', { 'data-a': 'post-hide' })) +
          IB('trash', 'Delete this reply', { 'data-a': 'post-del' }, 'danger') + '</div></div></li>';
      }).join('') : '<li class="none" style="padding:16px 20px;color:var(--muted)">No replies yet.</li>') + '</ul></div>';
  }

  async function setThread(t, fields, okText, verb) {
    busy('Saving…');
    var r = await sb.from('forum_threads').update(fields).eq('id', t.id).select('id').maybeSingle();
    busy('');
    if (r.error || !r.data) { toast("Couldn't save that. You may not have permission.", 'bad'); return; }
    Object.assign(t, fields);
    logAction('forum.thread.' + verb, t.title, { id: t.id });
    toast(okText, 'ok');
    render();
  }
  async function delThread(t) {
    var ok = await ask({ title: 'Delete This Thread?', text: '"' + t.title + '" and all of its replies will be permanently deleted.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var r = await sb.from('forum_threads').delete().eq('id', t.id).select('id');
    busy('');
    if (r.error || !(r.data || []).length) { toast("Couldn't delete that.", 'bad'); return; }
    logAction('forum.thread.delete', t.title, { id: t.id });
    F.threads = F.threads.filter(function (x) { return x.id !== t.id; });
    F.reports = F.reports.filter(function (x) { return x.thread_id !== t.id; });
    F.thread = null;
    toast('Thread deleted.', 'ok');
    render();
  }
  async function setPost(p, hidden) {
    busy('Saving…');
    var r = await sb.from('forum_posts').update({ hidden: hidden }).eq('id', p.id).select('id').maybeSingle();
    busy('');
    if (r.error || !r.data) { toast("Couldn't save that.", 'bad'); return; }
    p.hidden = hidden;
    logAction(hidden ? 'forum.post.hide' : 'forum.post.show', F.thread.t.title, { id: p.id });
    toast(hidden ? 'Reply hidden from employees.' : 'Reply shown again.', 'ok');
    render();
  }
  async function delPost(p) {
    var ok = await ask({ title: 'Delete This Reply?', text: 'It will be permanently deleted.', ok: 'Delete', danger: true });
    if (!ok) return;
    var r = await sb.from('forum_posts').delete().eq('id', p.id).select('id');
    if (r.error || !(r.data || []).length) { toast("Couldn't delete that.", 'bad'); return; }
    logAction('forum.post.delete', F.thread.t.title, { id: p.id });
    F.thread.posts = F.thread.posts.filter(function (x) { return x.id !== p.id; });
    F.reports = F.reports.filter(function (x) { return x.post_id !== p.id; });
    toast('Reply deleted.', 'ok');
    render();
  }

  /* ---------- reports ---------- */
  function renderReports(body) {
    var list = F.reports.filter(function (r) { return !r.resolved; });
    body.innerHTML = '<div class="list-card">' + (list.length ? '<ul class="rows">' + list.map(function (r) {
      var t = r.thread_id ? F.threads.filter(function (x) { return x.id === r.thread_id; })[0] : null;
      var meta = ['Reported by ' + who(r.employee_id), app.fmtDate(r.created_at), r.reason ? 'Reason: ' + r.reason : ''].filter(Boolean).join(' · ');
      return '<li class="lrow" data-report="' + esc(r.id) + '"><button class="lmain" type="button" data-a="report-open"><span class="lico">' + I('flag') + '</span><span class="ltext"><span class="lname">' +
        esc(r.post_id ? 'A reported reply' : 'Reported thread: ' + (t ? t.title : 'deleted')) + '</span><span class="lmeta" style="white-space:normal">' + esc(meta) + '</span></span></button>' +
        '<div class="lside"><div class="lacts">' + IB('check', 'Mark as dealt with', { 'data-a': 'resolve' }, 'good') + '</div></div></li>';
    }).join('') + '</ul>' : empty('flag', 'No open reports', 'Reports from employees will appear here.')) + '</div>';
  }
  async function reportOpen(r) {
    var tid = r.thread_id;
    if (!tid && r.post_id) {
      var p = await sb.from('forum_posts').select('thread_id').eq('id', r.post_id).maybeSingle();
      tid = p.data && p.data.thread_id;
    }
    if (!tid) { toast('That post has already been removed.', 'bad'); return; }
    await openThread(tid);
  }
  async function resolve(r) {
    var res = await sb.from('forum_reports').update({ resolved: true }).eq('id', r.id).select('id').maybeSingle();
    if (res.error || !res.data) { toast("Couldn't save that.", 'bad'); return; }
    r.resolved = true;
    logAction('forum.report.resolve', who(r.employee_id), { id: r.id });
    toast('Marked as dealt with.', 'ok');
    render();
  }

  /* ---------- categories ---------- */
  function renderCats(body) {
    var list = sortedCats();
    body.innerHTML = '<div class="list-card">' + (list.length ? '<ul class="rows">' + list.map(function (c, i) {
      var n = F.threads.filter(function (t) { return t.category_id === c.id; }).length;
      return '<li class="lrow" data-id="' + esc(c.id) + '"><div class="lmain" style="cursor:default"><span class="lico">' + I('chat') + '</span><span class="ltext"><span class="lname">' + esc(c.name) +
        '</span><span class="lmeta">' + esc((c.description ? c.description + ' · ' : '') + n + (n === 1 ? ' thread' : ' threads')) + '</span></span></div>' +
        '<div class="lside"><span class="chip cat-st ' + (c.active ? 's-published' : 's-archived') + '">' + (c.active ? 'Open' : 'Closed') + '</span><div class="lacts">' +
        (i > 0 ? IB('arrowUp', 'Move up', { 'data-a': 'cup' }) : '<span class="ib-gap" aria-hidden="true"></span>') + (i < list.length - 1 ? IB('arrowDown', 'Move down', { 'data-a': 'cdown' }) : '<span class="ib-gap" aria-hidden="true"></span>') +
        IB('more', 'Actions for ' + c.name, { 'data-a': 'camenu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }) + '</div></div></li>';
    }).join('') + '</ul>' : empty('chat', 'No categories', 'Tap ' + I('plus', 'inline') + ' to add one. Employees can only post in open categories.')) + '</div>';
  }
  function catDialog(c) {
    var dlg = $('#fc-dlg'), form = $('#fc-form'), err = $('#fc-err');
    $('#fc-title').textContent = c ? 'Edit Category' : 'Add Category';
    $('#fc-name').value = c ? c.name : '';
    $('#fc-desc').value = c ? c.description || '' : '';
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var name = $('#fc-name').value.trim();
      if (!name) { err.textContent = 'Enter a name.'; err.hidden = false; return; }
      var fields = { name: name, description: $('#fc-desc').value.trim() };
      $('#fc-ok').disabled = true;
      var r = c
        ? await sb.from('forum_categories').update(fields).eq('id', c.id).select('*').maybeSingle()
        : await sb.from('forum_categories').insert(Object.assign({ position: F.cats.length }, fields)).select('*').maybeSingle();
      $('#fc-ok').disabled = false;
      if (r.error || !r.data) { err.textContent = "Couldn't save that. You may not have permission."; err.hidden = false; return; }
      dlg.close();
      logAction(c ? 'forum.category.edit' : 'forum.category.add', name, { id: r.data.id });
      toast(c ? 'Saved.' : 'Category added.', 'ok');
      loadAll();
    };
    $('#fc-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#fc-name').focus();
  }
  async function catMove(c, dir) {
    var list = sortedCats(), i = list.findIndex(function (x) { return x.id === c.id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    busy('Saving…');
    await sb.from('forum_categories').update({ position: j }).eq('id', list[i].id).select('id').maybeSingle();
    await sb.from('forum_categories').update({ position: i }).eq('id', list[j].id).select('id').maybeSingle();
    busy('');
    loadAll();
  }
  async function catDelete(c) {
    var n = F.threads.filter(function (t) { return t.category_id === c.id; }).length;
    var ok = await ask({ title: 'Delete This Category?', text: '"' + c.name + '"' + (n ? ' and its ' + n + (n === 1 ? ' thread' : ' threads') + ' will be permanently deleted. Close it instead if you only want to stop new posts.' : ' will be permanently deleted.'), ok: 'Delete', danger: true });
    if (!ok) return;
    var r = await sb.from('forum_categories').delete().eq('id', c.id).select('id');
    if (r.error || !(r.data || []).length) { toast("Couldn't delete that.", 'bad'); return; }
    logAction('forum.category.delete', c.name, { id: c.id });
    toast('Category deleted.', 'ok');
    loadAll();
  }

  /* ---------- wiring ---------- */
  function catToggle(c) {
    sb.from('forum_categories').update({ active: !c.active }).eq('id', c.id).select('id').maybeSingle().then(function (res) {
      if (res.error || !res.data) { toast("Couldn't save that.", 'bad'); return; }
      logAction(c.active ? 'forum.category.close' : 'forum.category.open', c.name, { id: c.id });
      toast(c.active ? 'Closed to employees.' : 'Open to employees.', 'ok');
      loadAll();
    });
  }

  /* ---------- the dotted menu on each category ---------- */
  function closeCMenu(focusBack) {
    var m = F.box && $('#fm-amenu', F.box);
    if (!m || m.hidden) return;
    m.hidden = true;
    var bt = F.cmBtn;
    F.cmBtn = null;
    if (bt) { bt.setAttribute('aria-expanded', 'false'); if (focusBack && document.body.contains(bt)) bt.focus(); }
  }
  function openCMenu(btn) {
    var li = btn.closest('li.lrow'), c = li && cat(li.dataset.id);
    if (!c) return;
    var m = $('#fm-amenu', F.box);
    if (!m) {
      m = document.createElement('ul');
      m.id = 'fm-amenu';
      m.className = 'at-menu am';
      m.setAttribute('role', 'menu');
      m.hidden = true;
      F.box.appendChild(m);
    }
    if (!m.hidden && F.cmBtn === btn) { closeCMenu(true); return; }
    closeCMenu(false);
    m.setAttribute('aria-label', 'Actions for ' + c.name);
    m.innerHTML = [[ 'ctoggle', c.active ? 'eyeOff' : 'eye', c.active ? 'Close to employees' : 'Open to employees' ], ['cedit', 'pencil', 'Edit'], ['cdel', 'trash', 'Delete']].map(function (x) {
      return '<li role="menuitem" tabindex="-1" data-am="' + x[0] + '"' + (x[0] === 'cdel' ? ' class="danger"' : '') + '>' + I(x[1]) + '<span>' + x[2] + '</span></li>';
    }).join('');
    m.dataset.for = c.id;
    m.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    F.cmBtn = btn;
    m.style.maxHeight = '';
    var r = btn.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
    var need = mh + 20;
    if (window.innerHeight - r.bottom < need) { window.scrollBy({ top: need - (window.innerHeight - r.bottom), behavior: 'instant' }); r = btn.getBoundingClientRect(); }
    var below = window.innerHeight - r.bottom - 14;
    if (mh > below) m.style.maxHeight = Math.max(140, below) + 'px';
    m.style.top = Math.max(8, r.bottom + 6) + 'px';
    m.style.left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8) + 'px';
    m.firstChild.focus();
  }
  function pickCat(a) {
    var m = $('#fm-amenu', F.box), c = m && cat(m.dataset.for);
    closeCMenu(false);
    if (!c) return;
    if (a === 'ctoggle') catToggle(c);
    else if (a === 'cedit') catDialog(c);
    else if (a === 'cdel') catDelete(c);
  }
  function cmenuKey(e) {
    var m = $('#fm-amenu', F.box);
    if (!m || m.hidden || !e.target.closest('#fm-amenu')) return;
    var its = [].slice.call(m.querySelectorAll('li')), k = its.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); its[(k + 1) % its.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); its[(k - 1 + its.length) % its.length].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (its[k]) pickCat(its[k].dataset.am); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCMenu(true); }
    else if (e.key === 'Tab') closeCMenu(false);
  }

  function onClick(e) {
    var mi = e.target.closest('#fm-amenu li');
    if (mi) { pickCat(mi.dataset.am); return; }
    var mb = e.target.closest('[data-a="camenu"]');
    if (mb) { openCMenu(mb); return; }
    var tab = e.target.closest('[data-tab]');
    if (tab) { F.tab = tab.dataset.tab; render(); return; }
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a, li = e.target.closest('li.lrow');
    var t = li && li.dataset.id && F.threads.filter(function (x) { return x.id === li.dataset.id; })[0];
    var c = li && li.dataset.id && cat(li.dataset.id);
    var r = li && li.dataset.report && F.reports.filter(function (x) { return x.id === li.dataset.report; })[0];
    var p = li && li.dataset.post && F.thread && F.thread.posts.filter(function (x) { return x.id === li.dataset.post; })[0];
    if (a === 'back') F.ctx.back();
    else if (a === 'threads-back') { F.thread = null; render(); }
    else if (a === 'add-cat') catDialog(null);
    else if (a === 'view' && t) openThread(t.id);
    else if (a === 'hide' && t) setThread(t, { hidden: true }, 'Hidden from employees.', 'hide');
    else if (a === 'unhide' && t) setThread(t, { hidden: false }, 'Shown to employees again.', 'show');
    else if (a === 'lock' && t) setThread(t, { locked: true }, 'Locked. No new replies.', 'lock');
    else if (a === 'unlock' && t) setThread(t, { locked: false }, 'Unlocked.', 'unlock');
    else if (a === 'del' && t) delThread(t);
    else if (a === 'post-hide' && p) setPost(p, true);
    else if (a === 'post-unhide' && p) setPost(p, false);
    else if (a === 'post-del' && p) delPost(p);
    else if (a === 'report-open' && r) reportOpen(r);
    else if (a === 'resolve' && r) resolve(r);
    else if (a === 'cedit' && c) catDialog(c);
    else if (a === 'cdel' && c) catDelete(c);
    else if (a === 'cup' && c) catMove(c, -1);
    else if (a === 'cdown' && c) catMove(c, 1);
    else if (a === 'ctoggle' && c) catToggle(c);
  }

  document.addEventListener('click', function (e) { if (!e.target.closest('#fm-amenu, [data-a="camenu"]')) closeCMenu(false); });
  window.addEventListener('scroll', function () { closeCMenu(false); }, true);
  window.addEventListener('resize', function () { closeCMenu(false); });

  window.MembersForum = {
    open: function (box, ctx) {
      F.box = box;
      F.ctx = ctx;
      F.thread = null;
      F.tab = ctx && ctx.tab ? ctx.tab : 'threads';
      box.onclick = onClick;
      box.onkeydown = cmenuKey;
      if (!canModerate()) {
        box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') + '<div class="ph-main"><h2>Employee Forum</h2></div></div>' +
          '<div class="list-card"><div class="es"><span class="eic">' + I('lock') + '</span><b>Employee Engagement only</b><p>The forum is moderated by Employee Engagement.</p></div></div>';
        return;
      }
      F.box.innerHTML = '<p class="fine">Loading…</p>';
      return loadAll();
    }
  };
})();
