/*
  SINAGLIKHA Employee Portal.
  Employees sign in with an Employee ID and a 6-digit PIN they chose themselves. This page only
  talks to the /api/employee-* functions; the PIN is never stored in the browser, and the
  signed-in state is a server cookie this script can't read.

  The dashboard loads in ONE request (/api/employee-content?home=1) that the server fills in
  parallel, then draws everything: announcements, the community feed (discussions open and reply in
  place, no page changes), attendance, learning, compensation records and departments.
  Everything typed by people is shown as plain text, never as HTML.
*/
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var I = window.SngIcon, IB = window.SngIconButton;
  var VIEWS = ['loading', 'signin', 'activate', 'home', 'dept', 'learn', 'eval', 'profile'];
  var SIGNED_IN = ['home', 'dept', 'learn', 'eval', 'profile'];
  var DEPTS = [
    ['staffing', 'Staffing and Recruitment', 'users'], ['training', 'Training and Development', 'book'], ['engagement', 'Employee Engagement', 'chat'],
    ['rewards', 'Total Rewards', 'award'], ['legal', 'Legal Compliance', 'scale']
  ];
  var DEPT_NAME = {};
  DEPTS.forEach(function (d) { DEPT_NAME[d[0]] = d[1]; });

  var me = null;
  var content = { deliverables: [], items: [] };
  var att = { today: '', records: [], unavailable: false };
  var recs = [];
  var learn = { courses: [], course: null, modules: [] };
  var forum = { cats: [], threads: [], photos: [] };
  var anns = [], annPhotos = [], annShown = 3;
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var text = function (s) { return esc(s).replace(/\n/g, '<br>'); };

  $('#year').textContent = new Date().getFullYear();

  /* every PIN box starts hidden again whenever the page changes */
  function hidePins() {
    Array.prototype.forEach.call(document.querySelectorAll('.pw-toggle'), function (b) {
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'Show PIN');
      b.setAttribute('data-tip', 'Show PIN');
      document.getElementById(b.getAttribute('data-for')).type = 'password';
    });
  }

  function show(name) {
    hidePins();
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
  Array.prototype.forEach.call(document.querySelectorAll('.pw-toggle'), function (b) {
    b.addEventListener('click', function () {
      var input = document.getElementById(b.getAttribute('data-for')), on = input.type === 'password';
      input.type = on ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Hide PIN' : 'Show PIN');
      b.setAttribute('data-tip', on ? 'Hide PIN' : 'Show PIN');
    });
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

  /* ---------- small formatting helpers ---------- */
  function initials(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] ? Array.from(w[0])[0] : '?') + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
  }
  var TINTS = ['#FFE7A8', '#FBD2B0', '#F6C9C0', '#D8E6C4', '#CFE3F1', '#E4D6F0'];
  var PHOTO_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
  function avSm(name, cls, photo) {
    if (photo && PHOTO_OK.test(photo)) return '<span class="av-sm has-pic' + (cls ? ' ' + cls : '') + '"><img src="' + photo + '" alt=""></span>';
    var h = 0;
    String(name).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return '<span class="av-sm' + (cls ? ' ' + cls : '') + '" style="background:' + TINTS[h % TINTS.length] + '" aria-hidden="true">' + esc(initials(name)) + '</span>';
  }
  function fmtDate(d) {
    var x = new Date(d);
    return isNaN(x) ? '' : x.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function ago(iso) {
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
    return fmtDate(iso);
  }
  function fmtSize(b) {
    if (typeof b !== 'number') return '';
    return b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  }
  function extOf(name) {
    var i = String(name).lastIndexOf('.');
    return i > 0 && i < name.length - 1 ? name.slice(i + 1, i + 5).toUpperCase() : 'FILE';
  }

  /* ---------- who is signed in ---------- */
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

  /* ---------- the dashboard: one request, then everything is drawn ---------- */
  function skeleton() {
    var lines = '<div class="skel" style="width:70%"></div><div class="skel" style="width:90%"></div><div class="skel" style="width:55%"></div>';
    $('#ann-feed').innerHTML = lines;
    $('#tiles').innerHTML = '';
  }

  function enter(employee) {
    me = Object.assign({ avatar: null }, employee);
    ['#f-signin', '#f-activate', '#f-pin'].forEach(function (f) { $(f).reset(); });
    $('#q').value = '';
    note('#h-err', '');
    note('#pf-msg', '');
    note('#p-msg', '');
    paintMe();
    skeleton();
    show('home');
    loadHome();
  }

  function applyHome(d) {
    if (d.employee) { me = Object.assign({}, me || {}, d.employee); paintMe(); }
    content = { deliverables: d.deliverables || [], items: d.items || [] };
    att = d.attendance || { today: '', records: [], unavailable: true };
    recs = d.records || [];
    learn.courses = d.learning || [];
    forum = { cats: (d.forum && d.forum.categories) || [], threads: (d.forum && d.forum.threads) || [] };
    anns = d.announcements || [];
    evals = d.evaluations || { self: [], peer: [] };
    annPhotos = d.announcementPhotos || [];
    forum.photos = (d.forum && d.forum.photos) || [];
    annShown = 3;
    renderHome();
  }

  async function loadHome() {
    var r = await call('GET', '/api/employee-content?home=1');
    if (r.status === 401) { show('signin'); return false; }
    if (!r.ok) { note('#h-err', r.data.error || "Couldn't load your dashboard. Try again in a moment."); $('#ann-feed').innerHTML = ''; return false; }
    note('#h-err', '');
    applyHome(r.data);
    return true;
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
  function deptOf(item) {
    var d = content.deliverables.filter(function (x) { return x.key === item.deliverable; })[0];
    return d ? d.department : '';
  }
  function nameOf(key) {
    var d = content.deliverables.filter(function (x) { return x.key === key; })[0];
    return d ? d.name : '';
  }

  function renderHome() {
    renderAnnouncements();
    renderForum();
    renderAttendance();
    renderEvals();
    renderLearningPanel();
    renderRecords();
    $('#tiles').innerHTML = DEPTS.map(function (d) {
      var n = content.items.filter(function (i) { return deptOf(i) === d[0]; }).length;
      return '<li class="lrow"><button class="lmain" type="button" data-dept="' + d[0] + '"><span class="lico">' + I(d[2]) + '</span><span class="ltext"><span class="lname">' + esc(d[1]) +
        '</span><span class="lmeta">' + (n ? n + (n === 1 ? ' item' : ' items') : 'Nothing yet') + '</span></span></button>' + I('chevron', 'lgo') + '</li>';
    }).join('');
    renderSearch();
  }

  /* ---------- announcements: posts from the Senior Managers ---------- */
  function renderAnnouncements() {
    var feed = $('#ann-feed');
    if (!anns.length) {
      feed.innerHTML = '<div class="none">No announcements yet. When a Senior Manager posts one, it will appear here.</div>';
      $('#ann-more').hidden = true;
      return;
    }
    feed.innerHTML = anns.slice(0, annShown).map(function (a) {
      return '<article class="post"><div class="post-top">' + avSm(a.author, '', annPhotos[a.pic]) + '<div class="who"><b>' + esc(a.author) + '</b><span>' +
        esc((DEPT_NAME[a.dept] ? DEPT_NAME[a.dept] + ' · ' : '') + ago(a.created_at)) + '</span></div></div>' +
        (a.title ? '<h3 class="post-title">' + esc(a.title) + '</h3>' : '') + '<p class="post-body">' + text(a.body) + '</p>' +
        (a.files.length ? '<div class="fchips">' + a.files.map(function (f, i) {
          return '<button class="fchip" type="button" data-annfile="' + esc(a.id) + '" data-i="' + i + '">' + I('file') + '<span>' + esc(f.name) + '</span>' + (f.size ? '<small>' + esc(fmtSize(f.size)) + '</small>' : '') + '</button>';
        }).join('') + '</div>' : '') + '</article>';
    }).join('');
    var more = anns.length - annShown;
    $('#ann-more').hidden = more <= 0;
    $('#ann-more').textContent = 'Show ' + more + ' older ' + (more === 1 ? 'announcement' : 'announcements');
  }

  /* ---------- the community feed: discussions open and reply right here ---------- */
  /* Delete (your own) or Report (someone else's), shown as a labelled button on every post and reply. */
  function modBtn(mine, kind, id) {
    var del = { style: 'margin-left:auto' };
    del['data-del-' + kind] = id;
    return mine
      ? IB('trash', 'Delete', del, 'danger')
      : '<button class="pbtn push" type="button" data-report-' + kind + '="' + esc(id) + '">' + I('flag') + '<span>Report</span></button>';
  }

  function renderForum() {
    var panel = $('#forum-panel');
    panel.hidden = !forum.cats.length;
    if (!forum.cats.length) return;
    var sel = $('#fc-cat'), keep = sel.value;
    sel.innerHTML = forum.cats.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    if (keep) sel.value = keep;
    var catName = function (id) { var c = forum.cats.filter(function (x) { return x.id === id; })[0]; return c ? c.name : ''; };
    $('#forum-feed').innerHTML = forum.threads.length ? forum.threads.map(function (t) {
      return '<article class="post" data-thread="' + esc(t.id) + '"><div class="post-top">' + avSm(t.author, '', forum.photos[t.pic]) + '<div class="who"><b>' + esc(t.author) + (t.mine ? ' (you)' : '') + '</b><span>' + esc(ago(t.created_at)) + '</span></div>' +
        '<span class="chip plain">' + esc(catName(t.category_id)) + '</span></div>' +
        '<h3 class="post-title">' + esc(t.title) + '</h3><p class="post-body clamp">' + text(t.body) + '</p>' +
        '<div class="post-foot"><button class="pbtn" type="button" data-replies="' + esc(t.id) + '">' + I('chat') + '<span>' + t.replies + (t.replies === 1 ? ' reply' : ' replies') + '</span></button>' +
        (t.locked ? '<span class="chip e-none plain">Locked</span>' : '') + modBtn(t.mine, 'thread', t.id) + '</div><div class="replies" hidden></div></article>';
    }).join('') : '<div class="none">No discussions yet. Start the first one above.</div>';
  }

  async function refreshFeed() {
    var r = await call('GET', '/api/employee-forum?feed=1');
    if (r.status === 401) { show('signin'); return; }
    if (r.ok) { forum = { cats: r.data.categories || [], threads: r.data.threads || [], photos: r.data.photos || [] }; renderForum(); }
  }

  function replyHtml(p, photos) {
    return '<div class="reply"><div class="post-top">' + avSm(p.author, '', photos[p.pic]) + '<div class="who"><b>' + esc(p.author) + (p.mine ? ' (you)' : '') + '</b><span>' + esc(ago(p.created_at)) + '</span></div>' +
      modBtn(p.mine, 'post', p.id) + '</div><p>' + text(p.body) + '</p></div>';
  }

  async function toggleReplies(id) {
    var card = document.querySelector('[data-thread="' + id + '"]');
    if (!card) return;
    var box = card.querySelector('.replies'), body = card.querySelector('.post-body');
    if (!box.hidden) { box.hidden = true; body.classList.add('clamp'); return; }
    box.hidden = false;
    body.classList.remove('clamp');
    box.innerHTML = '<div class="skel" style="width:60%;margin:8px 0"></div>';
    var r = await call('GET', '/api/employee-forum?thread=' + encodeURIComponent(id));
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { box.innerHTML = '<p class="fine">' + esc(r.data.error || "Couldn't load the replies.") + '</p>'; return; }
    var photos = r.data.photos || [];
    box.innerHTML = r.data.posts.map(function (p) { return replyHtml(p, photos); }).join('') + (r.data.thread.locked ? '<p class="fine" style="margin-top:8px">This thread is locked, so it cannot take new replies.</p>' :
      '<form class="rcmp" data-reply-form="' + esc(id) + '" novalidate><label class="sr-only" for="rb-' + esc(id) + '">Your reply</label><textarea id="rb-' + esc(id) + '" maxlength="2000" rows="1" placeholder="Write a reply…"></textarea>' +
      IB('send', 'Send reply', { 'data-send-reply': '1' }, 'solid') + '</form><p class="msg bad" role="alert" hidden style="margin-top:8px"></p>');
  }

  async function sendReply(form) {
    var id = form.getAttribute('data-reply-form'), ta = form.querySelector('textarea'), msg = form.nextElementSibling;
    var textVal = ta.value.trim();
    if (!textVal) { msg.textContent = 'Write a reply first.'; msg.hidden = false; return; }
    msg.hidden = true;
    var btn = form.querySelector('button');
    btn.disabled = true;
    var r = await call('POST', '/api/employee-forum', { action: 'reply', thread_id: id, body: textVal });
    btn.disabled = false;
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { msg.textContent = r.data.error || "Couldn't post that."; msg.hidden = false; return; }
    toast('Reply posted.');
    var t = forum.threads.filter(function (x) { return x.id === id; })[0];
    if (t) t.replies += 1;
    var card = document.querySelector('[data-thread="' + id + '"]');
    card.querySelector('[data-replies] span').textContent = (t ? t.replies : '') + ((t && t.replies === 1) ? ' reply' : ' replies');
    card.querySelector('.replies').hidden = true;
    toggleReplies(id);
  }

  function composerOpen(on) {
    $('#fc-fields').hidden = !on;
    $('#fc-open').hidden = on;
    if (on) $('#fc-title').focus();
  }
  $('#fc-open').addEventListener('click', function () { composerOpen(true); });
  $('#fc-cancel').addEventListener('click', function () { note('#fc-msg', ''); composerOpen(false); });

  $('#f-compose').addEventListener('submit', async function (e) {
    e.preventDefault();
    var title = $('#fc-title').value.trim(), body = $('#fc-body').value.trim();
    if (!title) { note('#fc-msg', 'Give your discussion a title.'); return; }
    if (!body) { note('#fc-msg', 'Write something to share.'); return; }
    note('#fc-msg', '');
    var btn = $('#fc-post');
    btn.disabled = true;
    var r = await call('POST', '/api/employee-forum', { action: 'thread', category_id: $('#fc-cat').value, title: title, body: body });
    btn.disabled = false;
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { note('#fc-msg', r.data.error || "Couldn't post that."); return; }
    $('#fc-title').value = '';
    $('#fc-body').value = '';
    toast('Posted.');
    composerOpen(false);
    refreshFeed();
  });

  async function sendDelete(kind, id) {
    if (!window.confirm(kind === 'thread' ? 'Delete this discussion? Its replies will disappear too.' : 'Delete your reply?')) return;
    var payload = { action: 'delete' };
    payload[kind === 'thread' ? 'thread_id' : 'post_id'] = id;
    var r = await call('POST', '/api/employee-forum', payload);
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { toast(r.data.error || "Couldn't delete that. Try again."); return; }
    toast('Deleted.');
    if (kind === 'thread') { forum.threads = forum.threads.filter(function (x) { return x.id !== id; }); renderForum(); return; }
    var btn = document.querySelector('[data-del-post="' + id + '"]'), card = btn && btn.closest('[data-thread]');
    if (btn) btn.closest('.reply').remove();
    if (card) {
      var t = forum.threads.filter(function (x) { return x.id === card.getAttribute('data-thread'); })[0];
      if (t) { t.replies = Math.max(0, t.replies - 1); card.querySelector('[data-replies] span').textContent = t.replies + (t.replies === 1 ? ' reply' : ' replies'); }
    }
  }

  async function sendReport(kind, id) {
    if (!window.confirm('Report this to a moderator? They will take a look.')) return;
    var payload = { action: 'report' };
    payload[kind === 'thread' ? 'thread_id' : 'post_id'] = id;
    var r = await call('POST', '/api/employee-forum', payload);
    toast(r.ok ? 'Thank you. A moderator will take a look.' : (r.data.error || "Couldn't send that report."));
  }

  /* ---------- search over files and documents ---------- */
  var searching = false, sugRows = [], sugAt = -1;
  function hay(i) { return (i.title + ' ' + i.description + ' ' + i.category + ' ' + nameOf(i.deliverable)).toLowerCase(); }
  function mark(text, q) {
    var i = text.toLowerCase().indexOf(q);
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  function hideSuggest() {
    $('#q-sug').hidden = true; $('#q').setAttribute('aria-expanded', 'false'); sugAt = -1;
  }
  /* a short dropdown under the search box; Enter or "See all results" opens the full list */
  function suggest() {
    var raw = $('#q').value.trim(), q = raw.toLowerCase(), box = $('#q-sug');
    if (!q || searching) { hideSuggest(); return; }
    var found = content.items.filter(function (i) { return hay(i).indexOf(q) !== -1; });
    sugAt = -1;
    sugRows = found.slice(0, 6);
    box.innerHTML = found.length
      ? sugRows.map(function (i, n) {
        return '<li role="option" id="sg' + n + '" data-open="' + esc(i.id) + '"><span class="sico">' + (i.kind === 'link' ? I('link') : esc(extOf(i.title))) + '</span>' +
          '<span class="stxt"><span class="sname">' + mark(i.title, q) + '</span><span class="spath">' + esc(nameOf(i.deliverable) || 'File') + '</span></span></li>';
      }).join('') + (found.length > sugRows.length ? '<li class="sall" role="option" data-all="1">See all ' + found.length + ' results</li>' : '')
      : '<li class="snote" role="presentation">Nothing matches "' + esc(raw) + '".</li>';
    box.hidden = false;
    $('#q').setAttribute('aria-expanded', 'true');
  }
  function runSearch() { searching = true; hideSuggest(); renderSearch(); }

  function renderSearch() {
    var q = $('#q').value.trim().toLowerCase();
    if (!q) searching = false;
    var on = searching && !!q;
    $('#home-main').hidden = on;
    $('#results').hidden = !on;
    if (!on) return;
    var found = content.items.filter(function (i) {
      return (i.title + ' ' + i.description + ' ' + i.category + ' ' + nameOf(i.deliverable)).toLowerCase().indexOf(q) !== -1;
    });
    $('#res').innerHTML = listHtml(found, 'Nothing matches "' + $('#q').value.trim() + '".', true);
  }

  var DEPT_LINE = {
    staffing: 'Finding and welcoming the right people.', training: 'Building skills for a future-ready workforce.', engagement: 'Culture, communication, and community.',
    rewards: 'Fair pay, benefits, and recognition.', legal: 'Fair, lawful, and safe workplaces.'
  };
  var DELIV_ICON = {
    company_files: 'file', talent_flow: 'file', training_materials: 'book', lms: 'book', career_dev: 'award', communication: 'chat', forum: 'chat',
    daily_activity: 'calendar', csr: 'users', wellness: 'users', comp_packages: 'file', pms: 'clipboard', incentive_plan: 'award', handbook: 'book',
    disciplinary_guidelines: 'scale', risk_plan: 'lock'
  };
  var PREVIEW_EXT = /^(pdf|png|jpe?g|gif|webp|txt)$/i;

  /* one file in a deliverable's tray: its type, name and details, and round Preview and Download buttons */
  function fileLine(it) {
    var meta = [];
    if (it.folder) meta.push(it.folder);
    if (it.category) meta.push(it.category);
    if (it.kind === 'link') meta.push('Link'); else if (it.size) meta.push(fmtSize(it.size));
    if (it.version) meta.push('Version ' + it.version);
    if (it.published_at) meta.push(fmtDate(it.published_at));
    var ext = it.kind === 'link' ? '' : extOf(it.title), acts = '';
    if (it.kind === 'link') acts = '<button class="dact" type="button" data-open="' + esc(it.id) + '" aria-label="Open the link: ' + esc(it.title) + '" data-tip="Open link">' + I('external') + '</button>';
    else {
      if (PREVIEW_EXT.test(ext)) acts += '<button class="dact" type="button" data-open="' + esc(it.id) + '" aria-label="Preview ' + esc(it.title) + '" data-tip="Preview">' + I('eye') + '</button>';
      acts += '<button class="dact" type="button" data-dl="' + esc(it.id) + '" aria-label="Download ' + esc(it.title) + '" data-tip="Download">' + I('download') + '</button>';
    }
    return '<div class="dfile"><span class="dbadge">' + (it.kind === 'link' ? I('link') : esc(ext || 'FILE')) + '</span><span class="dtext"><b>' + esc(it.title) + '</b><small>' + esc(meta.join(' · ')) + '</small>' +
      (it.description ? '<span>' + esc(it.description) + '</span>' : '') + '</span><span class="dacts">' + acts + '</span></div>';
  }

  function openDept(key) {
    var dep = DEPTS.filter(function (d) { return d[0] === key; })[0];
    if (!dep) return;
    var groups = content.deliverables.filter(function (d) { return d.department === key; }).map(function (d) {
      return { d: d, items: content.items.filter(function (i) { return i.deliverable === d.key; }) };
    });
    var total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    var first = groups.filter(function (g) { return g.items.length; })[0];
    var html = '<div class="dhero"><span class="dh-ic">' + I(dep[2]) + '</span><div class="dh-t"><h1>' + esc(dep[1]) + '</h1><p>' + esc(DEPT_LINE[key] || '') + '</p></div>' +
      '<span class="dh-chip">' + (total ? total + (total === 1 ? ' file published' : ' files published') : 'Nothing published yet') + '</span></div>';
    groups.forEach(function (g) {
      var n = g.items.length, open = g === first;
      var head = '<span class="dp-t">' + I(DELIV_ICON[g.d.key] || 'file') + '</span><span class="dp-x"><b>' + esc(g.d.name) + '</b><small>' + (n ? 'Published for employees' : 'Nothing published yet') + '</small></span>' +
        '<span class="dp-r"><span class="dchip' + (n ? '' : ' m') + '">' + (n ? n + (n === 1 ? ' file' : ' files') : 'Empty') + '</span>' + (n ? I('chevron') : '') + '</span>';
      html += '<div class="dgroup' + (n ? ' has' : '') + (open ? ' open' : '') + '">' +
        (n ? '<button class="dpill" type="button" data-dtoggle aria-expanded="' + open + '">' + head + '</button><div class="dtray"' + (open ? '' : ' hidden') + '>' + g.items.map(fileLine).join('') + '</div>'
           : '<div class="dpill">' + head + '</div>') + '</div>';
    });
    if (!groups.length) html += '<p class="fine" style="margin-top:14px">Nothing published yet.</p>';
    $('#dept-body').innerHTML = html;
    show('dept');
  }

  /* open or close a deliverable's tray */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-dtoggle]');
    if (!b) return;
    var g = b.closest('.dgroup'), tray = g.querySelector('.dtray'), on = tray.hidden;
    tray.hidden = !on;
    g.classList.toggle('open', on);
    b.setAttribute('aria-expanded', String(on));
  });
  /* Download: the file is saved by the browser, the page stays where it is */
  async function downloadUrl(path) {
    var r = await call('GET', path);
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok || !r.data.url) { toast((r.data && r.data.error) || "Couldn't download that."); return; }
    window.location.href = r.data.url;
  }

  /* ---------- evaluations: the Self and Peer forms, filled in on a page of their own ---------- */
  var evals = { self: [], peer: [] };
  var ef = null;   // the form being filled in: { kind, form, qs, name, overall, step, readonly }
  var F = window.SngEvalForm;

  function renderEvals() {
    var all = (evals.self || []).length + (evals.peer || []).length;
    $('#evl-panel').hidden = !all;
    if (!all) return;
    var rows = (evals.self || []).map(function (f) {
      var chip = f.status === 'final' ? ['s-published', 'Submitted'] : f.status === 'draft' ? ['s-draft', 'Draft'] : ['plain', 'Not started'];
      return '<li class="lrow"><button class="lmain" type="button" data-evself="' + esc(f.id) + '"><span class="lico">' + I('clipboard') + '</span><span class="ltext"><span class="lname">' + esc(f.title) +
        '</span><span class="lmeta">' + esc(['Self-assessment', f.period].filter(Boolean).join(' · ')) + '</span></span></button><span class="chip ' + chip[0] + '" style="margin-right:6px">' + chip[1] + '</span></li>';
    }).concat((evals.peer || []).map(function (f) {
      return '<li class="lrow"><button class="lmain" type="button" data-evpeer="' + esc(f.id) + '"><span class="lico">' + I('users') + '</span><span class="ltext"><span class="lname">' + esc(f.title) +
        '</span><span class="lmeta">' + esc(['Evaluate a colleague', f.period, f.done ? f.done + ' sent' : 'Optional'].filter(Boolean).join(' · ')) + '</span></span></button>' + I('chevron', 'lgo') + '</li>';
    }));
    $('#evl-list').innerHTML = rows.join('');
  }

  function efCard(inner, cls) { return '<div class="gf-card' + (cls ? ' ' + cls : '') + '">' + inner + '</div>'; }

  function efHead(f) {
    var meta = [f.period, f.closes_on ? 'Open until ' + fmtDate(f.closes_on + 'T00:00:00+08:00') : ''].filter(Boolean);
    var who = ef.kind === 'peer' && ef.name ? '<div class="gf-meta">Evaluating <b>' + esc(ef.name) + '</b></div>' : '';
    return efCard('<h1 class="gf-h1">' + esc(f.title) + '</h1>' + (f.description ? '<div class="gf-desc">' + esc(f.description) + '</div>' : '') +
      (meta.length ? '<div class="gf-meta">' + meta.map(esc).join(' · ') + '</div>' : '') + who +
      (ef.step === 'form' && !ef.readonly ? '<div class="gf-req">* Required</div>' : '') +
      (ef.readonly ? '<div class="gf-meta"><span class="gf-chip">Submitted</span></div>' : ''), 'head');
  }

  function drawEval() {
    var f = ef.form, html = efHead(f);
    if (ef.step === 'who') {
      html += efCard('<div class="gf-qt">Who would you like to evaluate? <span class="s">*</span></div><div class="gf-qd">Type your colleague\'s full name. Your answers are private: they will not see them, or that you wrote them.</div>' +
        '<div class="gf-ans"><input id="ef-name" type="text" maxlength="120" autocomplete="off" placeholder="Full name" value="' + esc(ef.name) + '"></div><div class="gf-err" id="ef-who-err" hidden></div>' +
        '<div class="gf-bar" style="margin-top:14px"><span></span><button class="btn btn-primary btn-sm" type="button" id="ef-next">Continue</button></div>');
    } else if (ef.step === 'done') {
      html += efCard('<div class="gf-done"><h2>Thank you</h2><p>' + (ef.kind === 'self' ? 'Your self-assessment has been submitted.' : 'Your evaluation has been sent.') + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px">' +
        (ef.kind === 'peer' ? '<button class="btn btn-ghost btn-sm" type="button" id="ef-again">Evaluate another colleague</button>' : '') +
        '<button class="btn btn-primary btn-sm" type="button" id="ef-home">Back to the dashboard</button></div></div>');
    } else {
      html += ef.qs.map(function (q, i) { return F.card(q, f, ef.readonly, i); }).join('');
      html += efCard('<div class="gf-qt">Anything else you would like to add?</div><div class="gf-ans"><textarea id="ef-over" maxlength="3000" rows="3" placeholder="Optional"' + (ef.readonly ? ' disabled' : '') + '>' + esc(ef.overall) + '</textarea></div>');
      if (!ef.readonly) {
        html += '<div class="gf-bar"><div class="l"><button class="btn btn-primary btn-sm" type="button" id="ef-send">' + (ef.kind === 'self' ? 'Submit' : 'Send evaluation') + '</button>' +
          (ef.kind === 'self' ? '<button class="btn btn-ghost btn-sm" type="button" id="ef-draft">Save draft</button>' : '') + '</div><span class="fine" id="ef-msg" role="alert"></span></div>';
      }
    }
    $('#eval-body').innerHTML = '<div class="gf">' + html + '</div>';
  }

  function openEvalForm(kind, id) {
    var f = (evals[kind] || []).filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    var mine = {};
    if (kind === 'self') (f.answers || []).forEach(function (a) { mine[a.id] = a; });
    ef = {
      kind: kind, form: f, name: '', overall: kind === 'self' ? f.overall || '' : '', step: kind === 'peer' ? 'who' : 'form', readonly: kind === 'self' && f.status === 'final',
      qs: f.questions.map(function (q) {
        var a = mine[q.id] || {};
        return Object.assign({}, q, { rating: a.rating || null, comment: a.comment || '', picked: Array.isArray(a.picked) ? a.picked.slice() : [] });
      })
    };
    $('#eval-title').textContent = kind === 'self' ? 'Self-assessment' : 'Evaluate a colleague';
    drawEval();
    show('eval');
  }

  function efPayload(extra) {
    var over = $('#ef-over');
    if (over) ef.overall = over.value;
    return Object.assign({ form_id: ef.form.id, answers: F.answers(ef.qs), overall: ef.overall }, extra);
  }
  function efMissing() {
    var ids = F.missing(ef.qs);
    F.markMissing($('#eval-body'), ids);
    return ids.length > 0;
  }
  async function refreshEvals() {
    var r = await call('GET', '/api/employee-evaluate');
    if (r.ok) { evals = { self: r.data.self || [], peer: r.data.peer || [] }; renderEvals(); }
  }

  async function efSubmit(kind) {
    var msg = $('#ef-msg');
    if (kind !== 'draft' && efMissing()) { msg.textContent = 'Please answer the required questions.'; return; }
    msg.textContent = '';
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ef-send,#ef-draft'));
    btns.forEach(function (b) { b.disabled = true; });
    var r = ef.kind === 'self'
      ? await call('POST', '/api/employee-evaluate', efPayload({ action: 'self', submit: kind !== 'draft' }))
      : await call('POST', '/api/employee-evaluate', efPayload({ action: 'peer', name: ef.name }));
    btns.forEach(function (b) { b.disabled = false; });
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { msg.textContent = (r.data && r.data.error) || "Couldn't send that. Try again."; return; }
    if (kind === 'draft') { toast('Draft saved.'); refreshEvals(); return; }
    ef.step = 'done';
    drawEval();
    window.scrollTo(0, 0);
    refreshEvals();
  }

  // the answering controls on the page: one binding that survives every redraw
  F.bind($('#eval-body'), function () { return ef ? ef.qs : []; }, function () { return ef ? ef.form : {}; });

  document.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-evself]'))) openEvalForm('self', t.getAttribute('data-evself'));
    else if ((t = e.target.closest('[data-evpeer]'))) openEvalForm('peer', t.getAttribute('data-evpeer'));
    if (!ef || $('#v-eval').hidden) return;
    if (e.target.closest('#ef-send')) efSubmit('send');
    else if (e.target.closest('#ef-draft')) efSubmit('draft');
    else if (e.target.closest('#ef-home')) { show('home'); }
    else if (e.target.closest('#ef-again')) {
      ef.name = ''; ef.overall = ''; ef.step = 'who';
      ef.qs = ef.form.questions.map(function (q) { return Object.assign({}, q, { rating: null, comment: '', picked: [] }); });
      drawEval();
      window.scrollTo(0, 0);
    } else if (e.target.closest('#ef-next')) efLookup();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'ef-name') { e.preventDefault(); efLookup(); }
  });
  async function efLookup() {
    var input = $('#ef-name'), err = $('#ef-who-err'), name = input.value.trim();
    if (!name) { err.textContent = 'Type your colleague\'s full name.'; err.hidden = false; return; }
    err.hidden = true;
    var btn = $('#ef-next');
    btn.disabled = true;
    var r = await call('POST', '/api/employee-evaluate', { action: 'peer_lookup', name: name });
    btn.disabled = false;
    if (r.status === 401) { show('signin'); return; }
    if (!r.ok) { err.textContent = (r.data && r.data.error) || "Couldn't check that name."; err.hidden = false; return; }
    ef.name = r.data.name;
    ef.step = 'form';
    drawEval();
    window.scrollTo(0, 0);
  }
  $('#eval-back').addEventListener('click', function () { show('home'); });

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
    $('#att-date').textContent = now.toLocaleDateString('en-PH', Object.assign({ weekday: 'long', month: 'long', day: 'numeric' }, TZ)) + ' · UTC+8';
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
    // only the last 7 days (today and the 6 days before it) show here
    var from = new Date(Date.parse(att.today + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);
    var week = att.records.filter(function (r) { return r.work_date >= from; });
    $('#att-recent').innerHTML = !week.length ? '<li class="none">No time records in the last 7 days.</li>' : week.map(function (r) {
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
  function bar(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    return '<span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>';
  }
  function progressText(done, total) {
    return total ? done + ' of ' + total + (total === 1 ? ' module' : ' modules') + ' complete' : 'No modules yet';
  }

  function renderLearningPanel() {
    $('#learn-panel').hidden = !learn.courses.length;
    $('#learn-list').innerHTML = learn.courses.slice(0, 4).map(function (c) {
      return '<li class="lrow"><button class="lmain" type="button" data-course="' + esc(c.id) + '"><span class="lico">' + I('book') + '</span><span class="ltext"><span class="lname">' + esc(c.title) +
        '</span>' + bar(c.done, c.total) + '<span class="lmeta">' + esc(progressText(c.done, c.total)) + '</span></span></button>' + I('chevron', 'lgo') + '</li>';
    }).join('');
  }

  function renderCourses() {
    learn.course = null;
    $('#learn-title').textContent = 'Learning';
    $('#learn-body').innerHTML = learn.courses.length ? learn.courses.map(function (c) {
      return '<button class="dcard" type="button" data-course="' + esc(c.id) + '" style="width:100%;margin-bottom:12px"><span class="di">' + I('book') + '</span><span class="dt"><b>' + esc(c.title) +
        '</b>' + (c.description ? '<span class="dm">' + esc(c.description) + '</span>' : '') + bar(c.done, c.total) + '<span class="dm">' + esc(progressText(c.done, c.total)) + '</span></span>' + I('chevron', 'go') + '</button>';
    }).join('') : '<div class="es"><span class="eic">' + I('book') + '</span><b>No courses yet</b><p>Courses from Training and Development will appear here.</p></div>';
  }

  function renderCourse() {
    var c = learn.course, done = learn.modules.filter(function (m) { return m.done; }).length;
    $('#learn-title').textContent = c.title;
    $('#learn-body').innerHTML = (c.description ? '<p class="fine" style="margin-bottom:12px">' + esc(c.description) + '</p>' : '') +
      '<div class="panel" style="padding:16px 20px;margin-bottom:14px">' + bar(done, learn.modules.length) + '<p class="fine" style="margin-top:8px">' + esc(progressText(done, learn.modules.length)) + '. Only you can see your progress.</p></div>' +
      '<div class="panel plist"><ul class="items">' + (learn.modules.length ? learn.modules.map(function (m) {
        return '<li class="lrow"><button class="ib ' + (m.done ? 'good' : '') + '" type="button" data-toggle="' + esc(m.id) + '" aria-label="' + (m.done ? 'Mark as not done' : 'Mark as done') + '" data-tip="' + (m.done ? 'Mark as not done' : 'Mark as done') + '"' +
          (m.done ? ' style="color:#1E6B2A"' : '') + '>' + I(m.done ? 'checkCircle' : 'circle') + '</button>' +
          '<button class="lmain" type="button" data-module="' + esc(m.id) + '" aria-label="Open ' + esc(m.title) + '"><span class="lico">' + (m.kind === 'link' ? I('link') : I('file')) + '</span><span class="ltext"><span class="lname">' + esc(m.title) + '</span>' +
          (m.description ? '<span class="ldesc">' + esc(m.description) + '</span>' : '') + '</span></button>' + I('external', 'lgo') + '</li>';
      }).join('') : '<li class="none">No modules in this course yet.</li>') + '</ul></div>';
  }

  async function openLearning() {
    show('learn');
    renderCourses();
  }

  async function openCourse(id) {
    show('learn');
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
    renderLearningPanel();
  }

  /* ---------- the employee's own compensation records ---------- */
  function renderRecords() {
    $('#rec-panel').hidden = !recs.length;
    $('#recs').innerHTML = recs.map(function (x) {
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

  /* ---------- clicks on the dashboard ---------- */
  document.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-form]'))) { if (/^https?:\/\//i.test(t.dataset.form)) window.open(t.dataset.form, '_blank', 'noopener'); }
    else if ((t = e.target.closest('[data-annfile]'))) openUrl('/api/employee-content?ann=' + encodeURIComponent(t.dataset.annfile) + '&i=' + encodeURIComponent(t.dataset.i));
    else if ((t = e.target.closest('[data-dl]'))) downloadUrl('/api/employee-content?dl=1&file=' + encodeURIComponent(t.dataset.dl));
    else if ((t = e.target.closest('[data-open]'))) openUrl('/api/employee-content?file=' + encodeURIComponent(t.dataset.open));
    else if ((t = e.target.closest('[data-rec]'))) openUrl('/api/employee-content?record=' + encodeURIComponent(t.dataset.rec));
    else if ((t = e.target.closest('[data-dept]'))) openDept(t.dataset.dept);
    else if ((t = e.target.closest('[data-course]'))) openCourse(t.dataset.course);
    else if ((t = e.target.closest('[data-toggle]'))) toggleModule(t.dataset.toggle);
    else if ((t = e.target.closest('[data-module]'))) openUrl('/api/employee-learning?open=' + encodeURIComponent(t.dataset.module));
    else if ((t = e.target.closest('[data-replies]'))) toggleReplies(t.dataset.replies);
    else if ((t = e.target.closest('[data-send-reply]'))) sendReply(t.closest('form'));
    else if ((t = e.target.closest('[data-del-thread]'))) sendDelete('thread', t.dataset.delThread);
    else if ((t = e.target.closest('[data-del-post]'))) sendDelete('post', t.dataset.delPost);
    else if ((t = e.target.closest('[data-report-thread]'))) sendReport('thread', t.dataset.reportThread);
    else if ((t = e.target.closest('[data-report-post]'))) sendReport('post', t.dataset.reportPost);
    else if (e.target.closest('#ann-more')) { annShown = anns.length; renderAnnouncements(); }
  });
  document.addEventListener('submit', function (e) {
    if (e.target.hasAttribute('data-reply-form')) { e.preventDefault(); sendReply(e.target); }
  });
  $('#q').addEventListener('input', function () { suggest(); renderSearch(); });
  $('#q').addEventListener('focus', suggest);
  $('#q').addEventListener('blur', function () { setTimeout(hideSuggest, 120); });
  $('#q').addEventListener('keydown', function (e) {
    var opts = Array.prototype.slice.call($('#q-sug').querySelectorAll('li[role="option"]'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!opts.length || $('#q-sug').hidden) return;
      e.preventDefault();
      sugAt = (sugAt + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach(function (li, n) { li.setAttribute('aria-selected', String(n === sugAt)); });
      opts[sugAt].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var li = opts[sugAt];
      if (li && li.dataset.open) { hideSuggest(); li.click(); } else runSearch();
    } else if (e.key === 'Escape') hideSuggest();
  });
  $('#q-sug').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('#q-sug').addEventListener('click', function (e) {
    if (e.target.closest('[data-all]')) runSearch(); else if (e.target.closest('[data-open]')) hideSuggest();
  });
  $('#dept-back').addEventListener('click', function () { show('home'); });
  $('#learn-back').addEventListener('click', function () { if (learn.course) renderCourses(); else show('home'); });

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

  /* ---------- start: one request tells us who is signed in AND fills the dashboard ---------- */
  (async function boot() {
    var r = await call('GET', '/api/employee-content?home=1');
    if (r.ok && r.data.employee) {
      me = Object.assign({ avatar: null }, r.data.employee);
      paintMe();
      show('home');
      applyHome(r.data);
    } else show('signin');
  })();
})();
