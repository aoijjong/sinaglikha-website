/*
  SINAGLIKHA Employee Portal.
  Employees sign in with an Employee ID and a 6-digit PIN they chose themselves. This page only
  talks to the /api/employee-* functions; the PIN is never stored in the browser, and the
  signed-in state is a server cookie this script can't read.
*/
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var I = window.SngIcon, IB = window.SngIconButton;
  var VIEWS = ['loading', 'signin', 'activate', 'home', 'dept', 'learn', 'forum', 'profile'];
  var SIGNED_IN = ['home', 'dept', 'learn', 'forum', 'profile'];
  var DEPTS = [
    ['staffing', 'Staffing and Recruitment', 'users'], ['training', 'Training and Development', 'book'], ['engagement', 'Employee Engagement', 'chat'],
    ['rewards', 'Total Rewards', 'award'], ['legal', 'Legal Compliance', 'scale']
  ];
  var me = null;
  var content = { deliverables: [], items: [], evaluations: [] };
  var att = { today: '', records: [], unavailable: false };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };

  $('#year').textContent = new Date().getFullYear();

  function show(name) {
    VIEWS.forEach(function (v) { $('#v-' + v).hidden = v !== name; });
    $('#top-right').hidden = SIGNED_IN.indexOf(name) === -1;
    var first = { signin: '#s-no', activate: '#a-no' }[name];
    if (first) $(first).focus();
    window.scrollTo(0, 0);
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 4200);
  }

  function note(sel, msg, kind) {
    var el = $(sel);
    el.textContent = msg || '';
    el.className = 'msg ' + (kind || 'bad');
    el.hidden = !msg;
  }

  /* only digits in the PIN boxes */
  ['#s-pin', '#a-pin', '#a-pin2', '#p-cur', '#p-new', '#p-new2'].forEach(function (sel) {
    $(sel).addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
  });
  ['#s-no', '#a-no'].forEach(function (sel) {
    $(sel).addEventListener('input', function () { this.value = this.value.toUpperCase(); });
  });
  $('#a-code').addEventListener('input', function () { this.value = this.value.toUpperCase(); });

  async function call(method, path, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var r;
    try { r = await fetch(path, opts); } catch (e) { return { ok: false, status: 0, data: { error: "Couldn't reach the server. Check your connection and try again." } }; }
    var data = {};
    try { data = await r.json(); } catch (e) { data = {}; }
    return { ok: r.ok, status: r.status, data: data };
  }

  function busy(btn, on, label) {
    btn.disabled = on;
    if (label) btn.textContent = on ? 'Please wait…' : label;
  }

  /* ---------- who is signed in ---------- */
  function initials(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] ? Array.from(w[0])[0] : '?') + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
  }
  function photoOf(m) {
    return m && typeof m.avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(m.avatar) ? m.avatar : '';
  }
  function paintAvatar(el) {
    var src = photoOf(me);
    el.textContent = '';
    if (src) { var img = new Image(); img.alt = ''; img.src = src; el.appendChild(img); }
    else el.textContent = me ? initials(me.full_name) : '';
  }
  function paintMe() {
    paintAvatar($('#btn-profile'));
    paintAvatar($('#pf-avatar'));
    $('#pf-remove').hidden = !photoOf(me);
    $('#pf-name').textContent = me.full_name || '';
    $('#pf-no').textContent = me.employee_no || '';
    $('#pf-pos').textContent = me.position || 'Not set';
    var first = String(me.full_name || '').trim().split(/\s+/)[0] || '';
    $('#h-hello').textContent = first ? 'Hello, ' + first : 'Hello';
    $('#h-sub').textContent = [me.position, me.employee_no].filter(Boolean).join(' · ');
  }

  function enter(employee) {
    me = Object.assign({ avatar: null }, employee);
    ['#f-signin', '#f-activate', '#f-pin'].forEach(function (f) { $(f).reset(); });
    $('#q').value = '';
    note('#h-err', '');
    note('#pf-msg', '');
    note('#p-msg', '');
    paintMe();
    show('home');
    loadContent();
    loadProfile();
  }

  async function loadProfile() {
    var r = await call('GET', '/api/employee-me');
    if (r.ok && me && r.data.employee) { me.avatar = r.data.employee.avatar || null; paintMe(); }
  }

  /* ---------- the dashboard ---------- */
  function fmtDate(d) {
    var x = new Date(d);
    return isNaN(x) ? '' : x.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtSize(b) {
    if (typeof b !== 'number') return '';
    return b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  }
  function extOf(name) {
    var i = String(name).lastIndexOf('.');
    return i > 0 && i < name.length - 1 ? name.slice(i + 1, i + 5).toUpperCase() : 'FILE';
  }
  function deptOf(item) {
    var d = content.deliverables.filter(function (x) { return x.key === item.deliverable; })[0];
    return d ? d.department : '';
  }
  function nameOf(key) {
    var d = content.deliverables.filter(function (x) { return x.key === key; })[0];
    return d ? d.name : '';
  }

  function itemHtml(it, showWhere) {
    var meta = [];
    if (showWhere) meta.push(nameOf(it.deliverable));
    if (it.category) meta.push(it.category);
    if (it.kind === 'link') meta.push('Link');
    else if (it.size) meta.push(fmtSize(it.size));
    if (it.version) meta.push('Version ' + it.version);
    if (it.published_at) meta.push(fmtDate(it.published_at));
    return '<li class="lrow"><button class="lmain" type="button" data-open="' + esc(it.id) + '" aria-label="Open ' + esc(it.title) + '">' +
      '<span class="lico">' + (it.kind === 'link' ? I('link') : esc(extOf(it.title))) + '</span>' +
      '<span class="ltext"><span class="lname">' + esc(it.title) + '</span><span class="lmeta">' + esc(meta.join(' · ')) + '</span>' +
      (it.description ? '<span class="ldesc">' + esc(it.description) + '</span>' : '') + '</span></button>' + I('external', 'lgo') + '</li>';
  }
  function listHtml(items, empty, showWhere) {
    return items.length ? items.map(function (i) { return itemHtml(i, showWhere); }).join('') : '<li class="none">' + esc(empty) + '</li>';
  }

  function renderHome() {
    var by = function (key) { return content.items.filter(function (i) { return i.deliverable === key; }); };
    $('#ann').innerHTML = listHtml(by('communication').slice(0, 5), 'No announcements yet.', false);
    $('#today').innerHTML = listHtml(by('daily_activity').slice(0, 1), 'Nothing posted yet.', false);
    $('#tiles').innerHTML = DEPTS.map(function (d) {
      var n = content.items.filter(function (i) { return deptOf(i) === d[0]; }).length;
      return '<button class="dcard" type="button" data-dept="' + d[0] + '"><span class="di">' + I(d[2]) + '</span><span class="dt"><b>' + esc(d[1]) + '</b><span class="dm">' +
        (n ? n + (n === 1 ? ' item' : ' items') : 'Nothing yet') + '</span></span>' + I('chevron', 'go') + '</button>';
    }).join('');
    renderSearch();
  }

  function renderSearch() {
    var q = $('#q').value.trim().toLowerCase();
    $('#home-main').hidden = !!q;
    $('#results').hidden = !q;
    if (!q) return;
    var found = content.items.filter(function (i) {
      return (i.title + ' ' + i.description + ' ' + i.category + ' ' + nameOf(i.deliverable)).toLowerCase().indexOf(q) !== -1;
    });
    $('#res').innerHTML = listHtml(found, 'Nothing matches "' + $('#q').value.trim() + '".', true);
  }

  function openDept(key) {
    var dep = DEPTS.filter(function (d) { return d[0] === key; })[0];
    if (!dep) return;
    $('#dept-name').textContent = dep[1];
    var html = '';
    content.deliverables.filter(function (d) { return d.department === key; }).forEach(function (d) {
      var items = content.items.filter(function (i) { return i.deliverable === d.key; });
      html += '<div class="panel" style="margin-bottom:16px"><div class="panel-h"><h2>' + esc(d.name) + '</h2></div><ul class="items">' + listHtml(items, 'Nothing published yet.', false) + '</ul></div>';
    });
    $('#dept-body').innerHTML = html || '<p class="fine">Nothing published yet.</p>';
    show('dept');
  }

  async function loadContent() {
    var r = await call('GET', '/api/employee-content');
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { note('#h-err', r.data.error || "Couldn't load the portal content."); content = { deliverables: [], items: [], evaluations: [] }; }
    else { note('#h-err', ''); content = { deliverables: r.data.deliverables || [], items: r.data.items || [], evaluations: r.data.evaluations || [] }; }
    renderHome();
    renderEvaluations();
    loadRecords();
    loadAttendance();
    loadMore();
  }

  /* ---------- evaluations: links to the forms that are open today ---------- */
  var EVAL_KINDS = [['self', 'Self evaluation'], ['peer', 'Peer evaluation'], ['manager', 'Manager evaluation']];
  function renderEvaluations() {
    var list = content.evaluations || [];
    $('#eval-panel').hidden = !list.length;
    var html = '';
    EVAL_KINDS.forEach(function (k) {
      list.filter(function (e) { return e.kind === k[0]; }).forEach(function (e) {
        var meta = [k[1], e.closes_on ? 'Open until ' + fmtDate(e.closes_on + 'T00:00:00+08:00') : ''].filter(Boolean).join(' · ');
        html += '<li class="lrow"><button class="lmain" type="button" data-form="' + esc(e.url) + '" aria-label="Open ' + esc(e.title) + '">' +
          '<span class="lico">' + I('clipboard') + '</span><span class="ltext"><span class="lname">' + esc(e.title) + '</span><span class="lmeta">' + esc(meta) + '</span>' +
          (e.instructions ? '<span class="ldesc">' + esc(e.instructions) + '</span>' : '') + '</span></button>' + I('external', 'lgo') + '</li>';
      });
    });
    $('#evals').innerHTML = html;
  }

  /* ---------- attendance: time in and time out ---------- */
  var TZ = { timeZone: 'Asia/Manila' };
  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('en-PH', Object.assign({ hour: 'numeric', minute: '2-digit' }, TZ));
  }
  function fmtDay(workDate) {
    return new Date(workDate + 'T00:00:00+08:00').toLocaleDateString('en-PH', Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, TZ));
  }
  function tickClock() {
    var now = new Date();
    $('#att-clock').textContent = now.toLocaleTimeString('en-PH', Object.assign({ hour: 'numeric', minute: '2-digit' }, TZ));
    $('#att-date').textContent = now.toLocaleDateString('en-PH', Object.assign({ weekday: 'long', month: 'long', day: 'numeric' }, TZ)) + ' · Philippine time';
  }
  setInterval(tickClock, 20000);

  function renderAttendance() {
    $('#att-panel').hidden = att.unavailable;
    if (att.unavailable) return;
    tickClock();
    var rec = att.records.filter(function (r) { return r.work_date === att.today; })[0];
    var inAt = rec && rec.time_in, outAt = rec && rec.time_out;
    $('#att-status').textContent = !inAt ? "You haven't timed in yet today."
      : !outAt ? 'Timed in at ' + fmtTime(rec.time_in) + '. Remember to time out at the end of your day.'
      : 'Timed in ' + fmtTime(rec.time_in) + ' · Timed out ' + fmtTime(rec.time_out) + '. Thank you for today.';
    $('#att-in').disabled = !!inAt;
    $('#att-out').disabled = !inAt || !!outAt;
    $('#att-recent').innerHTML = att.records.slice(0, 7).map(function (r) {
      var chip = r.time_in && r.time_out ? ['s-published', 'Complete'] : r.work_date === att.today ? ['s-draft', 'Today'] : ['s-archived', 'No time out'];
      return '<li class="lrow"><div class="lmain" style="cursor:default"><span class="ltext"><span class="lname">' + esc(fmtDay(r.work_date)) + '</span><span class="lmeta">' +
        esc((r.time_in ? fmtTime(r.time_in) : '—') + ' to ' + (r.time_out ? fmtTime(r.time_out) : '—')) + '</span></span></div>' +
        '<span class="chip ' + chip[0] + '" style="margin-right:6px">' + chip[1] + '</span></li>';
    }).join('');
  }

  async function loadAttendance() {
    var r = await call('GET', '/api/employee-attendance');
    if (r.status === 401) { show('signin'); return; }
    att = r.ok ? { today: r.data.today, records: r.data.records || [], unavailable: !!r.data.unavailable } : { today: '', records: [], unavailable: true };
    renderAttendance();
  }

  async function punch(action) {
    var btn = $(action === 'in' ? '#att-in' : '#att-out');
    note('#att-msg', '');
    btn.disabled = true;
    var r = await call('POST', '/api/employee-attendance', { action: action });
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) note('#att-msg', r.data.error || "Couldn't record that. Try again.");
    else toast(action === 'in' ? 'Timed in at ' + fmtTime(r.data.record.time_in) + '.' : 'Timed out at ' + fmtTime(r.data.record.time_out) + '.');
    await loadAttendance();
  }
  $('#att-in').addEventListener('click', function () { punch('in'); });
  $('#att-out').addEventListener('click', function () { punch('out'); });

  /* ---------- learning ---------- */
  var learn = { courses: [], course: null, modules: [] };

  function bar(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    return '<span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>';
  }
  function progressText(done, total) {
    return total ? done + ' of ' + total + (total === 1 ? ' module' : ' modules') + ' complete' : 'No modules yet';
  }

  async function loadMore() {
    var l = await call('GET', '/api/employee-learning');
    learn.courses = l.ok && Array.isArray(l.data.courses) ? l.data.courses : [];
    var f = await call('GET', '/api/employee-forum');
    forum.cats = f.ok && Array.isArray(f.data.categories) ? f.data.categories : [];
    var html = '';
    if (learn.courses.length) {
      var done = learn.courses.reduce(function (n, c) { return n + c.done; }, 0), total = learn.courses.reduce(function (n, c) { return n + c.total; }, 0);
      html += '<button class="dcard" type="button" data-go="learn"><span class="di">' + I('book') + '</span><span class="dt"><b>Learning</b><span class="dm">' +
        esc(learn.courses.length + (learn.courses.length === 1 ? ' course' : ' courses') + ' · ' + done + ' of ' + total + ' complete') + '</span></span>' + I('chevron', 'go') + '</button>';
    }
    if (forum.cats.length) {
      html += '<button class="dcard" type="button" data-go="forum"><span class="di">' + I('chat') + '</span><span class="dt"><b>Employee Forum</b><span class="dm">Ask, share and chat with your colleagues</span></span>' + I('chevron', 'go') + '</button>';
    }
    $('#more-cards').innerHTML = html;
    $('#more-sec').hidden = !html;
  }

  function renderCourses() {
    learn.course = null;
    $('#learn-title').textContent = 'Learning';
    $('#learn-body').innerHTML = learn.courses.length ? learn.courses.map(function (c) {
      return '<button class="dcard" type="button" data-course="' + esc(c.id) + '" style="width:100%;margin-bottom:12px"><span class="di">' + I('book') + '</span><span class="dt"><b>' + esc(c.title) +
        '</b>' + (c.description ? '<span class="dm">' + esc(c.description) + '</span>' : '') + bar(c.done, c.total) + '<span class="dm">' + esc(progressText(c.done, c.total)) + '</span></span>' + I('chevron', 'go') + '</button>';
    }).join('') : '<div class="es"><span class="eic">' + I('book') + '</span><b>No courses yet</b><p>Courses from Training and Development will appear here.</p></div>';
  }

  async function openLearning() {
    show('learn');
    $('#learn-body').innerHTML = '<p class="fine">Loading…</p>';
    var l = await call('GET', '/api/employee-learning');
    if (l.status === 401) { show('signin'); return; }
    learn.courses = l.ok && Array.isArray(l.data.courses) ? l.data.courses : [];
    renderCourses();
  }

  function renderCourse() {
    var c = learn.course, done = learn.modules.filter(function (m) { return m.done; }).length;
    $('#learn-title').textContent = c.title;
    $('#learn-body').innerHTML = (c.description ? '<p class="fine" style="margin-bottom:12px">' + esc(c.description) + '</p>' : '') +
      '<div class="panel" style="padding:16px 20px;margin-bottom:14px">' + bar(done, learn.modules.length) + '<p class="fine" style="margin-top:8px">' + esc(progressText(done, learn.modules.length)) + '. Only you can see your progress.</p></div>' +
      '<div class="panel"><ul class="items">' + (learn.modules.length ? learn.modules.map(function (m) {
        return '<li class="lrow"><button class="ib ' + (m.done ? 'good' : '') + '" type="button" data-toggle="' + esc(m.id) + '" aria-label="' + (m.done ? 'Mark as not done' : 'Mark as done') + '" data-tip="' + (m.done ? 'Mark as not done' : 'Mark as done') + '"' +
          (m.done ? ' style="color:#1E6B2A"' : '') + '>' + I(m.done ? 'checkCircle' : 'circle') + '</button>' +
          '<button class="lmain" type="button" data-module="' + esc(m.id) + '" aria-label="Open ' + esc(m.title) + '"><span class="lico">' + (m.kind === 'link' ? I('link') : I('file')) + '</span><span class="ltext"><span class="lname">' + esc(m.title) + '</span>' +
          (m.description ? '<span class="ldesc">' + esc(m.description) + '</span>' : '') + '</span></button>' + I('external', 'lgo') + '</li>';
      }).join('') : '<li class="none">No modules in this course yet.</li>') + '</ul></div>';
  }

  async function openCourse(id) {
    $('#learn-body').innerHTML = '<p class="fine">Loading…</p>';
    var r = await call('GET', '/api/employee-learning?course=' + encodeURIComponent(id));
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { toast(r.data.error || "Couldn't open that course."); renderCourses(); return; }
    learn.course = r.data.course;
    learn.modules = r.data.modules || [];
    renderCourse();
  }

  async function toggleModule(id) {
    var m = learn.modules.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    var r = await call('POST', '/api/employee-learning', { action: m.done ? 'undo' : 'done', module_id: id });
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { toast(r.data.error || "Couldn't save that."); return; }
    m.done = !m.done;
    var c = learn.courses.filter(function (x) { return x.id === learn.course.id; })[0];
    if (c) c.done = learn.modules.filter(function (x) { return x.done; }).length;
    renderCourse();
  }

  /* ---------- the employee forum ---------- */
  var forum = { cats: [], cat: null, thread: null };

  function text(s) { return esc(s).replace(/\n/g, '<br>'); }
  function ago(iso) {
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return fmtDate(iso);
  }

  function renderCats() {
    forum.cat = null; forum.thread = null;
    $('#forum-title').textContent = 'Employee Forum';
    $('#forum-body').innerHTML = '<p class="fine" style="margin-bottom:12px">Be kind and keep it work-friendly. Posts show your name. There are no private messages, and moderators can hide or remove posts.</p>' +
      (forum.cats.length ? forum.cats.map(function (c) {
        return '<button class="dcard" type="button" data-cat="' + esc(c.id) + '" style="width:100%;margin-bottom:12px"><span class="di">' + I('chat') + '</span><span class="dt"><b>' + esc(c.name) + '</b>' +
          (c.description ? '<span class="dm">' + esc(c.description) + '</span>' : '') + '<span class="dm">' + c.threads + (c.threads === 1 ? ' thread' : ' threads') + '</span></span>' + I('chevron', 'go') + '</button>';
      }).join('') : '<div class="es"><span class="eic">' + I('chat') + '</span><b>The forum is quiet</b><p>No categories are open yet.</p></div>');
  }

  async function openForum() {
    show('forum');
    $('#forum-body').innerHTML = '<p class="fine">Loading…</p>';
    var f = await call('GET', '/api/employee-forum');
    if (f.status === 401) { show('signin'); return; }
    forum.cats = f.ok && Array.isArray(f.data.categories) ? f.data.categories : [];
    renderCats();
  }

  async function openCat(id) {
    $('#forum-body').innerHTML = '<p class="fine">Loading…</p>';
    var r = await call('GET', '/api/employee-forum?category=' + encodeURIComponent(id));
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { toast(r.data.error || "Couldn't open that category."); renderCats(); return; }
    forum.cat = r.data.category; forum.thread = null;
    $('#forum-title').textContent = r.data.category.name;
    $('#forum-body').innerHTML = '<div class="ph" style="margin-bottom:12px"><div class="ph-main"><p class="fine">' + esc(r.data.category.description || '') + '</p></div><div class="ph-actions">' +
      IB('plus', 'Start a new thread', { 'data-newthread': '1' }, 'solid') + '</div></div>' +
      '<form class="card" id="f-thread" hidden novalidate style="padding:20px"><div class="field"><label for="t-title">Title</label><input id="t-title" type="text" maxlength="120" autocomplete="off"></div>' +
      '<div class="field"><label for="t-body">What do you want to say?</label><textarea id="t-body" maxlength="2000" rows="5"></textarea></div>' +
      '<p class="msg bad" id="t-msg" role="alert" hidden></p><div class="actions" style="flex-direction:row;justify-content:flex-end"><button class="btn btn-ghost btn-sm" type="button" id="t-cancel">Cancel</button><button class="btn btn-primary btn-sm" type="submit" id="t-ok">Post</button></div></form>' +
      '<div class="panel"><ul class="items">' + (r.data.threads.length ? r.data.threads.map(function (t) {
        return '<li class="lrow"><button class="lmain" type="button" data-thread="' + esc(t.id) + '"><span class="lico">' + I(t.locked ? 'lock' : 'chat') + '</span><span class="ltext"><span class="lname">' + esc(t.title) + '</span>' +
          '<span class="lmeta">' + esc(t.author + ' · ' + t.replies + (t.replies === 1 ? ' reply' : ' replies') + ' · ' + ago(t.last_post_at)) + '</span><span class="ldesc">' + esc(t.preview) + '</span></span></button>' + I('chevron', 'lgo') + '</li>';
      }).join('') : '<li class="none">No threads yet. Be the first to start one.</li>') + '</ul></div>';
  }

  function postHtml(p, kind) {
    return '<div class="post"><div class="post-h"><b>' + esc(p.author) + (p.mine ? ' (you)' : '') + '</b><span>' + esc(ago(p.created_at)) + '</span>' +
      (p.mine ? '' : IB('flag', 'Report to a moderator', { 'data-report': kind, 'data-id': p.id })) + '</div><p>' + text(p.body) + '</p></div>';
  }

  async function openThread(id) {
    $('#forum-body').innerHTML = '<p class="fine">Loading…</p>';
    var r = await call('GET', '/api/employee-forum?thread=' + encodeURIComponent(id));
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { toast(r.data.error || "Couldn't open that thread."); if (forum.cat) openCat(forum.cat.id); else renderCats(); return; }
    forum.cat = r.data.category; forum.thread = r.data.thread;
    var t = r.data.thread;
    $('#forum-title').textContent = t.title;
    $('#forum-body').innerHTML = '<p class="fine" style="margin-bottom:10px">In ' + esc(r.data.category.name) + (t.locked ? ' · Locked' : '') + '</p>' +
      postHtml({ id: t.id, author: t.author, mine: t.mine, created_at: t.created_at, body: t.body }, 'thread') +
      r.data.posts.map(function (p) { return postHtml(p, 'post'); }).join('') +
      (t.locked ? '<p class="msg" style="margin-top:12px">This thread is locked, so it cannot take new replies.</p>' :
        '<form class="card" id="f-reply" novalidate style="padding:20px;margin-top:12px"><div class="field"><label for="r-body">Your reply</label><textarea id="r-body" maxlength="2000" rows="4"></textarea></div>' +
        '<p class="msg bad" id="r-msg" role="alert" hidden></p><div class="actions" style="flex-direction:row;justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit" id="r-ok">Reply</button></div></form>');
  }

  async function forumPost(payload, msgSel, btnSel, done) {
    note(msgSel, '');
    var btn = $(btnSel);
    btn.disabled = true;
    var r = await call('POST', '/api/employee-forum', payload);
    btn.disabled = false;
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { note(msgSel, r.data.error || "Couldn't post that."); return; }
    done(r.data);
  }

  async function sendReport(kind, id) {
    if (!window.confirm('Report this to a moderator? They will take a look.')) return;
    var payload = { action: 'report' };
    payload[kind === 'thread' ? 'thread_id' : 'post_id'] = id;
    var r = await call('POST', '/api/employee-forum', payload);
    toast(r.ok ? 'Thank you. A moderator will take a look.' : (r.data.error || "Couldn't send that report."));
  }

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'f-thread') {
      e.preventDefault();
      forumPost({ action: 'thread', category_id: forum.cat.id, title: $('#t-title').value, body: $('#t-body').value }, '#t-msg', '#t-ok', function (d) { toast('Posted.'); openThread(d.id); });
    } else if (e.target.id === 'f-reply') {
      e.preventDefault();
      forumPost({ action: 'reply', thread_id: forum.thread.id, body: $('#r-body').value }, '#r-msg', '#r-ok', function () { toast('Reply posted.'); openThread(forum.thread.id); });
    }
  });

  document.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-go]'))) { if (t.dataset.go === 'learn') openLearning(); else if (t.dataset.go === 'forum') openForum(); }
    else if ((t = e.target.closest('[data-course]'))) openCourse(t.dataset.course);
    else if ((t = e.target.closest('[data-toggle]'))) toggleModule(t.dataset.toggle);
    else if ((t = e.target.closest('[data-module]'))) openUrl('/api/employee-learning?open=' + encodeURIComponent(t.dataset.module));
    else if ((t = e.target.closest('[data-cat]'))) openCat(t.dataset.cat);
    else if ((t = e.target.closest('[data-thread]'))) openThread(t.dataset.thread);
    else if (e.target.closest('[data-newthread]')) { $('#f-thread').hidden = false; $('#t-title').focus(); }
    else if (e.target.closest('#t-cancel')) $('#f-thread').hidden = true;
    else if ((t = e.target.closest('[data-report]'))) sendReport(t.dataset.report, t.dataset.id);
  });
  $('#learn-back').addEventListener('click', function () { if (learn.course) renderCourses(); else { show('home'); loadMore(); } });
  $('#forum-back').addEventListener('click', function () {
    if (forum.thread && forum.cat) openCat(forum.cat.id);
    else if (forum.cat) renderCats();
    else { show('home'); loadMore(); }
  });

  /* the employee's own compensation records, if Total Rewards has uploaded any */
  async function loadRecords() {
    var r = await call('GET', '/api/employee-content?records=1');
    var list = r.ok && Array.isArray(r.data.records) ? r.data.records : [];
    $('#rec-panel').hidden = !list.length;
    $('#recs').innerHTML = list.map(function (x) {
      return '<li class="lrow"><button class="lmain" type="button" data-rec="' + esc(x.id) + '" aria-label="Open ' + esc(x.title) + '">' +
        '<span class="lico">' + I('lock') + '</span><span class="ltext"><span class="lname">' + esc(x.title) + '</span><span class="lmeta">' +
        esc([x.period, fmtDate(x.created_at)].filter(Boolean).join(' · ')) + '</span></span></button>' + I('external', 'lgo') + '</li>';
    }).join('');
  }

  async function openUrl(path) {
    var w = window.open('', '_blank');
    var r = await call('GET', path);
    if (r.status === 401) { if (w) w.close(); show('signin'); return; }
    if (!r.ok || !r.data.url) { if (w) w.close(); toast(r.data.error || "Couldn't open that."); return; }
    if (w) { w.opener = null; w.location.href = r.data.url; } else window.location.href = r.data.url;
  }

  document.addEventListener('click', function (e) {
    var open = e.target.closest('[data-open]'), tile = e.target.closest('[data-dept]'), rec = e.target.closest('[data-rec]'), form = e.target.closest('[data-form]');
    if (form) { if (/^https?:\/\//i.test(form.dataset.form)) window.open(form.dataset.form, '_blank', 'noopener'); }
    else if (open) openUrl('/api/employee-content?file=' + encodeURIComponent(open.dataset.open));
    else if (rec) openUrl('/api/employee-content?record=' + encodeURIComponent(rec.dataset.rec));
    else if (tile) openDept(tile.dataset.dept);
  });
  $('#q').addEventListener('input', renderSearch);
  $('#dept-back').addEventListener('click', function () { show('home'); });

  /* ---------- sign in, first-time activation ---------- */
  $('#f-signin').addEventListener('submit', async function (e) {
    e.preventDefault();
    var no = $('#s-no').value.trim().toUpperCase(), pin = $('#s-pin').value;
    if (!/^[A-Z]{3}-\d{4}$/.test(no)) { note('#s-msg', 'Enter your Employee ID, like SNG-0001.'); return; }
    if (!/^\d{6}$/.test(pin)) { note('#s-msg', 'Your PIN is 6 digits.'); return; }
    note('#s-msg', '');
    var btn = $('#s-ok');
    busy(btn, true, 'Sign In');
    var res = await call('POST', '/api/employee-login', { employee_no: no, pin: pin });
    busy(btn, false, 'Sign In');
    $('#s-pin').value = '';
    if (!res.ok) { note('#s-msg', res.data.error || 'Check your Employee ID and PIN.'); return; }
    enter(res.data.employee);
  });

  $('#f-activate').addEventListener('submit', async function (e) {
    e.preventDefault();
    var no = $('#a-no').value.trim().toUpperCase(), code = $('#a-code').value.trim();
    var pin = $('#a-pin').value, pin2 = $('#a-pin2').value;
    var problem = '';
    if (!/^[A-Z]{3}-\d{4}$/.test(no)) problem = 'Enter your Employee ID, like SNG-0001.';
    else if (code.replace(/[^A-Za-z0-9]/g, '').length !== 8) problem = 'Enter the 8-character activation code you were given.';
    else if (!/^\d{6}$/.test(pin)) problem = 'Your PIN must be exactly 6 digits.';
    else if (pin !== pin2) problem = "The two PINs don't match.";
    if (problem) { note('#a-msg', problem); return; }
    note('#a-msg', '');
    var btn = $('#a-ok');
    busy(btn, true, 'Save PIN');
    var res = await call('POST', '/api/employee-activate', { employee_no: no, code: code, pin: pin });
    busy(btn, false, 'Save PIN');
    $('#a-pin').value = $('#a-pin2').value = '';
    if (!res.ok) { note('#a-msg', res.data.error || "That didn't work. Ask Staffing and Recruitment for a new code."); return; }
    /* Activating only sets the PIN. The employee signs in with it, so the first sign-in proves they remember it. */
    ['#f-signin', '#f-activate'].forEach(function (f) { $(f).reset(); });
    show('signin');
    $('#s-no').value = no;
    note('#s-msg', 'Your PIN is saved. Now sign in with your Employee ID and your new PIN.', 'ok');
    $('#s-pin').focus();
  });

  /* ---------- profile settings ---------- */
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

  async function savePhoto(data) {
    note('#pf-msg', '');
    var r = await call('POST', '/api/employee-me', { avatar: data });
    if (!r.ok) { note('#pf-msg', r.data.error || "Couldn't save your photo."); return; }
    me.avatar = data;
    paintMe();
    toast(data ? 'Photo saved.' : 'Photo removed.');
  }

  $('#btn-profile').addEventListener('click', function () { note('#pf-msg', ''); note('#p-msg', ''); show('profile'); });
  $('#pf-back').addEventListener('click', function () { show('home'); });
  $('#pf-upload').addEventListener('click', function () { $('#pf-file').click(); });
  $('#pf-remove').addEventListener('click', function () { savePhoto(null); });
  $('#pf-file').addEventListener('change', async function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { note('#pf-msg', 'Choose a picture file.'); return; }
    try { savePhoto(await resizeToAvatar(f)); } catch (err) { note('#pf-msg', "That picture couldn't be read. Try another."); }
  });

  $('#f-pin').addEventListener('submit', async function (e) {
    e.preventDefault();
    var cur = $('#p-cur').value, next = $('#p-new').value, again = $('#p-new2').value;
    var problem = '';
    if (!/^\d{6}$/.test(cur)) problem = 'Enter your current 6-digit PIN.';
    else if (!/^\d{6}$/.test(next)) problem = 'Your new PIN must be exactly 6 digits.';
    else if (next !== again) problem = "The two new PINs don't match.";
    if (problem) { note('#p-msg', problem); return; }
    note('#p-msg', '');
    var btn = $('#p-ok');
    busy(btn, true, 'Save New PIN');
    var res = await call('POST', '/api/employee-me', { action: 'pin', current: cur, next: next });
    busy(btn, false, 'Save New PIN');
    $('#p-cur').value = $('#p-new').value = $('#p-new2').value = '';
    if (!res.ok) {
      if (res.status === 401 && /sign in/i.test(res.data.error || '')) { show('signin'); return; }
      note('#p-msg', res.data.error || "Couldn't save your new PIN.");
      return;
    }
    toast('Your PIN was changed.');
    show('home');
  });

  async function signOut() {
    await call('POST', '/api/employee-me', { action: 'logout' });
    me = null;
    note('#s-msg', '');
    show('signin');
  }
  $('#btn-out').addEventListener('click', signOut);
  $('#to-activate').addEventListener('click', function () { note('#a-msg', ''); show('activate'); });
  $('#to-signin').addEventListener('click', function () { note('#s-msg', ''); show('signin'); });

  (async function boot() {
    var res = await call('GET', '/api/employee-me');
    if (res.ok && res.data.employee) enter(res.data.employee); else show('signin');
  })();
})();
