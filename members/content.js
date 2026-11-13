/*
  SINAGLIKHA Content Manager.
  Two steps: pick a department and a deliverable, then work in a folder-style list. Each file, link
  and folder is a row in public.content_items (see supabase/content_manager.sql); the files
  themselves sit in the private "content" bucket. The database rules decide who can read or
  change what; this page only presents it. It shares the sign-in, dialogs and toasts of
  members.js through window.MembersApp. Actions are icon buttons with hover labels.
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var BUCKET = 'content';
  /* Only the file types the deliverables expect. There is no virus scanning, so nothing else goes in. */
  var ALLOWED = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|txt|csv)$/i;
  var STATUS = { draft: 'Draft', published: 'Published', unpublished: 'Unpublished', archived: 'Archived' };
  var AUDIENCE = { managers: 'Managers only', employees: 'Employees', public: 'Everyone' };
  /* Publishing these keeps them for managers only until someone picks another audience. */
  var MANAGEMENT_DEFAULT = ['risk_plan'];
  var DEPT_ORDER = ['staffing', 'training', 'engagement', 'rewards', 'legal'];
  var DEPT_SHORT = { staffing: 'Staffing', training: 'Training', engagement: 'Engagement', rewards: 'Rewards', legal: 'Legal' };
  var DEPT_ICON = { staffing: 'users', training: 'book', engagement: 'chat', rewards: 'award', legal: 'scale' };
  var KIND_ICON = { applicants: 'userCheck', recdocs: 'clipboard', vacancies: 'users', post: 'chat', document: 'file', program: 'calendar', module: 'book', evaluation: 'clipboard', special: 'clock' };
  var DEPT_LINE = {
    staffing: 'Finding and welcoming the right people.',
    training: 'Building skills for a future-ready workforce.',
    engagement: 'Culture, communication, and community.',
    rewards: 'Fair pay, benefits, and recognition.',
    legal: 'Fair, lawful, and safe workplaces.'
  };
  var DELIV_LINE = {
    vacancies: 'The positions shown on the public Careers page',
    applicants: 'Applicants, their status, history and notes',
    recdocs: 'Interview schedules, rating forms, work samples, results and placements',
    announcements: 'Write a post for every employee. It shows your name, and you can attach files',
    attendance: 'Time in and time out records, with corrections and a monthly spreadsheet',
    company_files: 'Company documents for the team and, where you allow it, the public',
    talent_flow: 'Talent management flowcharts and the files that support them',
    training_materials: 'Slides, guides and other learning resources',
    lms: 'Courses and modules that employees complete and track',
    career_dev: 'Programs and opportunities for growing a career here',
    communication: 'Announcements, posters and newsletters',
    forum: 'Employee conversations: moderation, reports and categories',
    daily_activity: 'The activity of the day, with its instructions',
    csr: 'Community activities and their photos',
    wellness: 'Wellness programs and learning material',
    comp_packages: 'General compensation and benefits information',
    pms: 'Evaluation forms for Self, Peer and Manager, and the evaluations',
    incentive_plan: 'Incentive and recognition plan information',
    handbook: 'The current Employee Handbook, with its versions',
    disciplinary_guidelines: 'The approved guidelines for disciplinary action',
    risk_plan: 'The Risk Mitigation Plan (management only by default)'
  };
  var SHOW = [['all', 'All'], ['published', 'Published'], ['drafts', 'Drafts'], ['archived', 'Archived']];
  /* deliverables with a screen of their own: the module that draws it, and the line shown on its card */
  var SPECIAL = { announcements: ['MembersAnnouncements', 'Write posts for every employee, with files if you like'], lms: ['MembersLearning', 'Courses and modules for employees'], forum: ['MembersForum', 'Moderation and categories'], attendance: ['MembersAttendance', 'Review and correct time records'], vacancies: ['MembersVacancies', 'Add, publish and close the positions shown on Careers'], applicants: ['MembersApplicants', 'Follow each applicant from application to placement'], recdocs: ['MembersRecruitmentDocs', 'Interview, rating, selection and placement documents'], pms: ['MembersEvaluations', 'Evaluation forms and employee evaluations'] };

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var cs = { ready: false, loading: null, deliverables: [], dept: '', key: '', path: [], items: [], q: '', show: 'all', token: 0, timer: null, failed: false, view: 'home', special: '' };

  function busy(text) {
    var b = $('#cm-busy');
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function deliverable(key) {
    return cs.deliverables.filter(function (d) { return d.key === key; })[0] || null;
  }
  function folderPath() { return cs.path.join('/'); }
  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function likeEscape(s) { return String(s).replace(/[\\%_]/g, '\\$&'); }
  function myDept() { return state.profile && state.profile.department; }

  /* ---------- the deliverables list ---------- */
  async function loadDeliverables() {
    var res = await sb.from('deliverables').select('key,name,department,kind,allow_public').order('name');
    if (res.error || !res.data || !res.data.length) { cs.failed = true; cs.deliverables = []; return false; }
    cs.failed = false;
    cs.deliverables = res.data;
    var mine = myDept();
    cs.dept = DEPT_ORDER.indexOf(mine) !== -1 ? mine : 'staffing';
    return true;
  }

  /* ---------- home: department, then deliverable ---------- */
  async function showHome() {
    cs.view = 'home';
    $('#cm-browser').hidden = true;
    $('#cm-special').hidden = true;
    $('#cm-home').hidden = false;
    var pills = $('#cm-depts'), cards = $('#cm-cards');
    if (!cs.deliverables.length) {
      pills.innerHTML = '';
      cards.innerHTML = '<div class="es"><span class="eic">' + I('inbox') + '</span><b>Not set up yet</b><p>Run supabase/content_manager.sql in the Supabase SQL editor, then reload this page.</p></div>';
      return;
    }
    var mine = myDept();
    var order = DEPT_ORDER.slice();
    if (mine && order.indexOf(mine) > 0) { order.splice(order.indexOf(mine), 1); order.unshift(mine); }
    // the department switcher sits above the header card: short names as pills on wide screens, a dropdown on narrow ones
    pills.hidden = false;
    pills.innerHTML = '<div class="dp-tabs pills" role="group" aria-label="Departments">' + order.map(function (d) {
      return '<button class="pill" type="button" data-dept="' + d + '" aria-pressed="' + (d === cs.dept) + '" aria-label="' + esc(app.depts[d] || d) + '">' + I(DEPT_ICON[d]) + esc(DEPT_SHORT[d] || app.depts[d] || d) + '</button>';
    }).join('') + '</div><label class="dp-pick"><span class="sr-only">Department</span><select data-deptsel aria-label="Switch department">' + order.map(function (d) {
      return '<option value="' + d + '"' + (d === cs.dept ? ' selected' : '') + '>' + esc(app.depts[d] || d) + '</option>';
    }).join('') + '</select></label>';
    cards.innerHTML = '';
    var res = await sb.from('content_items').select('deliverable,status').neq('kind', 'folder').limit(10000);
    if (cs.view !== 'home') return;
    loadAttention(res.data || []);
    var counts = {};
    (res.data || []).forEach(function (r) {
      var c = counts[r.deliverable] || (counts[r.deliverable] = { published: 0, draft: 0, unpublished: 0, archived: 0 });
      if (c[r.status] !== undefined) c[r.status]++;
    });
    var list = cs.deliverables.filter(function (d) { return d.department === cs.dept; });
    // Staffing and the Administrator get a small "attendance today" card above the list; it replaces the tracker row
    var glance = cs.dept === 'staffing' && canReview() && !!window.MembersAttendance;
    if (glance) list = list.filter(function (d) { return d.key !== 'attendance'; });
    if (cs.attTimer) { clearInterval(cs.attTimer); cs.attTimer = null; }
    /* Announcements are posts, not files, so they have no row in the deliverables table */
    if (cs.dept === 'engagement') list = [{ key: 'announcements', name: 'Announcements', department: 'engagement', kind: 'post' }].concat(list);
    // Engagement moderators get two small cards (latest announcement, forum activity); they replace the two rows
    /* Staffing manages the vacancies shown on the public Careers page */
    var nRec = 0;
    if (cs.dept === 'staffing' && canReview() && window.MembersVacancies) {
      var rec = [{ key: 'vacancies', name: 'Vacancies', department: 'staffing', kind: 'vacancies' }];
      if (window.MembersApplicants) rec.push({ key: 'applicants', name: 'Applicant Tracking System', department: 'staffing', kind: 'applicants' });
      if (window.MembersRecruitmentDocs) rec.push({ key: 'recdocs', name: 'Recruitment and Selection Records', department: 'staffing', kind: 'recdocs' });
      nRec = rec.length;
      list = rec.concat(list);
    }
    var eng = cs.dept === 'engagement' && canModerate() && !!window.MembersAnnouncements && !!window.MembersForum;
    if (eng) list = list.filter(function (d) { return d.key !== 'announcements' && d.key !== 'forum'; });
    var pub = 0, drafts = 0;
    list.forEach(function (d) {
      var n = counts[d.key];
      if (n) { pub += n.published; drafts += n.draft + n.unpublished; }
    });
    var summary = [list.length + (list.length === 1 ? ' deliverable' : ' deliverables')];
    if (pub) summary.push(pub + ' published');
    if (drafts) summary.push(drafts + (drafts === 1 ? ' draft waiting' : ' drafts waiting'));
    if (!glance) nRec = 0;   // without the card the three rows stay in the normal list
      var rowsHtml = list.map(function (d) {
        var n = counts[d.key] || { published: 0, draft: 0, unpublished: 0, archived: 0 };
        var sp = SPECIAL[d.key], special = !!(sp && window[sp[0]]);
        var line = DELIV_LINE[d.key] || '';
        var open = special ? 'data-special="' + esc(d.key) + '"' : 'data-open="' + esc(d.key) + '"';
        var chips = '';
        if (!special) {
          if (n.published) chips += '<span class="chip s-published">' + n.published + ' published</span>';
          if (n.draft + n.unpublished) chips += '<span class="chip s-draft">' + (n.draft + n.unpublished) + (n.draft + n.unpublished === 1 ? ' draft' : ' drafts') + '</span>';
          if (!chips) chips = '<span class="dp-empty">' + I('upload', 'inline') + ' Add the first file</span>';
        }
        if (d.kind === 'special' && !special) {
          return '<li class="lrow"><div class="lmain" style="cursor:default;opacity:.6"><span class="lico">' + I(KIND_ICON[d.kind] || 'file') + '</span><span class="ltext"><span class="lname">' + esc(d.name) +
            '</span><span class="lmeta">' + esc(line) + '</span></span></div><div class="lside"><span class="chip e-none plain">Coming soon</span></div></li>';
        }
        return '<li class="lrow"><button class="lmain" type="button" ' + open + '><span class="lico">' + I(KIND_ICON[d.kind] || 'file') + '</span><span class="ltext"><span class="lname">' + esc(d.name) +
          '</span><span class="lmeta">' + esc(line) + '</span></span>' + I('chevron', 'go go-main') + '</button><div class="lside">' + chips + I('chevron', 'go go-side') + '</div></li>';
    });
    cs.recRows = rowsHtml.slice(0, nRec).join('');
    cards.innerHTML = '<div class="dp-head"><span class="di">' + I(DEPT_ICON[cs.dept]) + '</span><div class="dp-title"><h2>' + esc(app.depts[cs.dept] || cs.dept) + '</h2>' +
      '<p>' + esc(DEPT_LINE[cs.dept] || '') + '</p></div><span class="dp-sum">' + esc(summary.join(' · ')) + '</span></div>' +
      (glance ? '<div id="cm-glance">' + glanceSkeleton() + '</div>' + (nRec ? '<div id="cm-rec"></div>' : '') : '') +
      (eng ? '<div class="eng-grid" id="cm-eng">' + glanceSkeleton() + glanceSkeleton() + '</div>' : '') + '<ul class="rows">' +
      rowsHtml.slice(nRec).join('') + '</ul>';
    if (glance || eng) {
      var again = glance ? function () { loadGlance(); loadRecruit(); } : loadEng, where = cs.dept;
      again();
      cs.attTimer = setInterval(function () { if (cs.view === 'home' && cs.dept === where) again(); else { clearInterval(cs.attTimer); cs.attTimer = null; } }, 60000);
    }
  }

  /* ---------- Engagement: the latest announcement and the forum at a glance ---------- */
  function shortText(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }
  function agoOf(iso) {
    var m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    return Math.round(m / 1440) + ' d ago';
  }
  function manilaDay(iso) { return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10); }
  function engCard(key, icon, title, headline, meta, chips) {
    return '<button class="attc" type="button" data-special="' + key + '" aria-label="Open ' + esc(title) + '">' +
      '<span class="attc-h"><span class="attc-i">' + I(icon) + '</span><b>' + esc(title) + '</b><span class="attc-go">' + I('chevron') + '</span></span>' +
      '<span class="attc-t">' + esc(headline) + '</span><span class="attc-m">' + esc(meta) + '</span><span class="attc-chips">' + chips + '</span></button>';
  }
  async function loadEng() {
    var box = $('#cm-eng');
    if (!box) return;
    var res = await Promise.all([
      sb.from('announcements').select('id,title,body,author_name,created_at,published').order('created_at', { ascending: false }).limit(100),
      sb.from('forum_threads').select('id,title,created_at,hidden').order('created_at', { ascending: false }).limit(200),
      sb.from('forum_posts').select('thread_id,created_at,hidden').order('created_at', { ascending: false }).limit(500),
      sb.from('forum_reports').select('id').eq('resolved', false).limit(500)
    ]);
    box = $('#cm-eng');
    if (!box || cs.view !== 'home' || cs.dept !== 'engagement') return;
    var html = '';
    if (!res[0].error && Array.isArray(res[0].data)) {
      var an = res[0].data, live = an.filter(function (a) { return a.published; });
      var last = live[0] || an[0], week = live.filter(function (a) { return Date.now() - Date.parse(a.created_at) < 7 * 86400000; }).length;
      var hid = an.length - live.length;
      html += last
        ? engCard('announcements', 'chat', 'Announcements', last.title || shortText(last.body, 70), (last.author_name || 'A Senior Manager') + ' · ' + agoOf(last.created_at),
          '<span class="chip">' + week + ' this week</span>' + (hid ? '<span class="chip">' + hid + ' hidden</span>' : ''))
        : engCard('announcements', 'chat', 'Announcements', 'No announcements yet', 'Write the first one for your employees.', '');
    }
    if (!res[1].error && Array.isArray(res[1].data)) {
      var threads = res[1].data.filter(function (t) { return !t.hidden; }), posts = (res[2].data || []).filter(function (x) { return !x.hidden; });
      var replies = {}, act = {};
      threads.forEach(function (t) { act[t.id] = Date.parse(t.created_at); replies[t.id] = 0; });
      posts.forEach(function (x) {
        if (act[x.thread_id] === undefined) return;
        replies[x.thread_id]++;
        act[x.thread_id] = Math.max(act[x.thread_id], Date.parse(x.created_at));
      });
      var top = threads.slice().sort(function (a, b) { return act[b.id] - act[a.id]; })[0];
      var today = manilaToday(), fresh = threads.filter(function (t) { return manilaDay(t.created_at) === today; }).length;
      var reps = res[3].error || !Array.isArray(res[3].data) ? 0 : res[3].data.length;
      var chips = '<span class="chip">' + fresh + ' new today</span>' +
        (reps ? '<span class="chip is-red" data-gtab="reports">' + plural(reps, 'report', 'reports') + '</span>' : '<span class="chip">No reports</span>');
      html += top
        ? engCard('forum', 'users', 'Employee forum', top.title, plural(replies[top.id], 'reply', 'replies') + ' · active ' + agoOf(new Date(act[top.id]).toISOString()), chips)
        : engCard('forum', 'users', 'Employee forum', 'No discussions yet', 'Employees can start one from their dashboard.', chips);
    }
    box.innerHTML = html;
  }

  /* ---------- Staffing: today's attendance at a glance ---------- */
  function glanceSkeleton() {
    return '<div class="attc is-loading" role="status"><span class="sr-only">Loading attendance</span><div class="skl" style="width:40%"></div><div class="skl" style="height:8px"></div><div class="skl" style="width:70%"></div></div>';
  }
  function initialsOf(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] ? Array.from(w[0])[0] : '?') + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
  }
  /* ---------- Staffing: the recruitment numbers at a glance (counted from the stored applicants) ---------- */
  async function loadRecruit() {
    var box = $('#cm-rec');
    if (!box) return;
    var res = await Promise.all([
      sb.from('applicants').select('status').limit(5000),
      sb.from('vacancies').select('id').eq('status', 'published').limit(500)
    ]);
    box = $('#cm-rec');
    if (!box || cs.view !== 'home' || cs.dept !== 'staffing') return;
    // before supabase/recruitment.sql has been run the table is missing, so the card simply stays away
    if (res[0].error || !Array.isArray(res[0].data)) { box.innerHTML = '<ul class="rows">' + (cs.recRows || '') + '</ul>'; return; }
    var n = { all: res[0].data.length };
    res[0].data.forEach(function (r) { n[r.status] = (n[r.status] || 0) + 1; });
    var open = res[1].error || !Array.isArray(res[1].data) ? 0 : res[1].data.length;
    // a view-only dashboard: one bar for each of the ten stages; the way into the full view is the Applicant Tracking System row below
    box.innerHTML = '<div class="attc is-static" role="group" aria-label="Hiring by stage">' +
      '<span class="attc-h"><span class="attc-i">' + I('userPlus') + '</span><b>Hiring</b><span class="attc-d">' + esc(plural(open, 'open position', 'open positions')) + '</span></span>' +
      SngStageChart.html(n, { total: n.all }) + '<ul class="rows rc-rows">' + (cs.recRows || '') + '</ul></div>';
  }

  async function loadGlance() {
    var box = $('#cm-glance');
    if (!box) return;
    var today = manilaToday();
    var res = await Promise.all([
      sb.rpc('employee_options'),
      sb.from('attendance_records').select('employee_id,time_in,time_out').eq('work_date', today).limit(5000)
    ]);
    box = $('#cm-glance');
    if (!box || cs.view !== 'home' || cs.dept !== 'staffing') return;
    if (res[1].error || !Array.isArray(res[0].data)) { box.innerHTML = ''; return; }
    var active = res[0].data.filter(function (p) { return p.active; });
    var rec = {};
    (res[1].data || []).forEach(function (r) { if (r.time_in) rec[r.employee_id] = r; });
    var done = 0, working = 0, missing = [];
    active.forEach(function (p) {
      var r = rec[p.id];
      if (!r) missing.push(p); else if (r.time_out) done++; else working++;
    });
    var n = active.length || 1;
    var date = new Date(today + 'T00:00:00+08:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
    var names = missing.slice(0, 4).map(function (p) { return '<span class="attc-av" title="' + esc(p.full_name) + '">' + esc(initialsOf(p.full_name)) + '</span>'; }).join('');
    box.innerHTML = '<button class="attc" type="button" data-special="attendance" aria-label="Open the full Attendance Tracker">' +
      '<span class="attc-h"><span class="attc-i">' + I('clock') + '</span><b>Attendance today</b><span class="attc-d">' + esc(date) + '</span><span class="attc-go">' + I('chevron') + '</span></span>' +
      '<span class="attc-bar" aria-hidden="true"><i class="g" style="width:' + (done / n * 100) + '%"></i><i class="b" style="width:' + (working / n * 100) + '%"></i></span>' +
      '<span class="attc-chips"><span class="chip t-complete">' + done + ' complete</span><span class="chip t-working">' + working + ' timed in</span><span class="chip t-none">' + missing.length + ' not yet in</span></span>' +
      (missing.length ? '<span class="attc-miss"><span class="attc-avs">' + names + '</span><span>' + (missing.length > 4 ? '+' + (missing.length - 4) + ' more not yet in' : 'not yet in') + '</span></span>' : '') +
      '</button>';
  }

  /* ---------- the "needs attention" strip: only what applies to this person ---------- */
  function canModerate() { return state.isAdmin || myDept() === 'engagement'; }
  function canReview() { return state.isAdmin || myDept() === 'staffing'; }
  function manilaToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  async function loadAttention(rows) {
    var box = $('#cm-attn');
    box.hidden = true;
    var items = [];

    /* drafts waiting, across every department; the button opens the department with the most */
    var byDept = {}, total = 0;
    rows.forEach(function (r) {
      if (r.status !== 'draft' && r.status !== 'unpublished') return;
      var d = deliverable(r.deliverable);
      if (!d) return;
      byDept[d.department] = (byDept[d.department] || 0) + 1;
      total++;
    });
    if (total) {
      var top = Object.keys(byDept).sort(function (a, b) { return byDept[b] - byDept[a]; })[0];
      items.push({ icon: 'file', text: plural(total, 'draft is', 'drafts are') + ' waiting to be published', dept: top });
    }

    var extra = [];
    if (canModerate() && cs.dept !== 'engagement') {
      extra.push(sb.from('forum_reports').select('id').eq('resolved', false).limit(500).then(function (r) {
        var n = r.error || !r.data ? 0 : r.data.length;
        if (n) items.push({ icon: 'flag', text: plural(n, 'forum report needs', 'forum reports need') + ' a moderator', special: 'forum', tab: 'reports' });
      }));
    }
    await Promise.all(extra);
    if (cs.view !== 'home' || !items.length) return;
    box.innerHTML = items.map(function (it, i) {
      return '<button type="button" data-attn="' + i + '"><span class="ai">' + I(it.icon) + '</span><span class="at">' + esc(it.text) + '</span>' + I('chevron', 'go') + '</button>';
    }).join('');
    box._items = items;
    box.hidden = false;
  }

  function openSpecial(key, tab) {
    var sp = SPECIAL[key];
    if (!sp || !window[sp[0]]) return;
    cs.view = 'special';
    cs.special = key;
    $('#cm-home').hidden = true;
    $('#cm-browser').hidden = true;
    var box = $('#cm-special');
    box.hidden = false;
    window[sp[0]].open(box, { tab: tab, back: function () { cs.special = ''; showHome(); } });
  }

  function openDeliverable(key) {
    var d = deliverable(key);
    if (!d) return;
    cs.key = key;
    cs.dept = d.department;
    cs.path = [];
    cs.q = '';
    cs.show = 'all';
    cs.view = 'browser';
    $('#cm-search').value = '';
    $('#cm-home').hidden = true;
    $('#cm-browser').hidden = false;
    return load();
  }

  /* ---------- the list ---------- */
  async function load() {
    if (!cs.key) { showHome(); return; }
    var token = ++cs.token;
    busy('Loading…');
    var term = cs.q.trim().replace(/[\\%_]/g, '');
    var q = sb.from('content_items').select('*').eq('deliverable', cs.key);
    q = term ? q.ilike('title', '%' + term + '%') : q.eq('folder_path', folderPath());
    var res = await q.order('title', { ascending: true }).limit(500);
    if (token !== cs.token) return;
    busy('');
    if (res.error) {
      toast("Couldn't load this list. " + (res.error.message || ''), 'bad');
      cs.items = [];
    } else {
      cs.items = res.data || [];
    }
    render();
    summarize();
  }

  /* counts for the filter pills cover the whole deliverable, not just this folder */
  async function summarize() {
    var key = cs.key;
    var res = await sb.from('content_items').select('status').eq('deliverable', key).neq('kind', 'folder').limit(5000);
    if (key !== cs.key) return;
    var n = { all: 0, published: 0, drafts: 0, archived: 0 };
    (res.data || []).forEach(function (r) {
      n.all++;
      if (r.status === 'published') n.published++;
      else if (r.status === 'archived') n.archived++;
      else n.drafts++;
    });
    cs.counts = n;
    drawPills();
  }
  function drawPills() {
    var n = cs.counts || {};
    $('#cm-status').innerHTML = SHOW.map(function (s) {
      return '<button class="pill" type="button" data-show="' + s[0] + '" aria-pressed="' + (cs.show === s[0]) + '">' + s[1] +
        (n[s[0]] !== undefined ? ' <small>' + n[s[0]] + '</small>' : '') + '</button>';
    }).join('');
  }

  function drawTrail() {
    var d = deliverable(cs.key);
    $('#cm-title').textContent = cs.path.length ? cs.path[cs.path.length - 1] : (d ? d.name : 'Content');
    var html = '<button type="button" data-go="home">' + esc(d ? app.depts[d.department] || d.department : 'Content') + '</button>';
    if (cs.path.length || cs.q.trim()) {
      html += '<span class="sep" aria-hidden="true">›</span><button type="button" data-go="0">' + esc(d ? d.name : '') + '</button>';
    }
    cs.path.forEach(function (seg, i) {
      var last = i === cs.path.length - 1 && !cs.q.trim();
      html += '<span class="sep" aria-hidden="true">›</span><button type="button" data-go="' + (i + 1) + '"' + (last ? ' aria-current="true"' : '') + '>' + esc(seg) + '</button>';
    });
    $('#cm-crumbs').innerHTML = html;
  }

  function rowHtml(it) {
    var n = esc(it.title), searching = !!cs.q.trim();
    if (it.kind === 'folder') {
      return '<li class="lrow" data-id="' + esc(it.id) + '">' +
        '<button class="lmain" type="button" data-act="open"><span class="lico folder">' + I('folder') + '</span>' +
        '<span class="ltext"><span class="lname">' + n + '</span><span class="lmeta">Folder' + (searching && it.folder_path ? ' in ' + esc(it.folder_path) : '') + '</span></span></button>' +
        '<div class="lside"><div class="lacts">' + IB('trash', 'Delete this folder', { 'data-act': 'delete' }, 'danger') + '</div></div></li>';
    }
    var meta = [AUDIENCE[it.audience] || it.audience];
    if (it.kind === 'file' && it.extra && it.extra.size) meta.push(app.fmtSize(it.extra.size));
    if (it.kind === 'link') meta.push('Link');
    if (it.version) meta.push('Version ' + it.version);
    meta.push(app.fmtDate(it.updated_at));
    if (searching && it.folder_path) meta.push('in ' + it.folder_path);
    var s = it.status;
    var acts = IB('pencil', 'Edit details', { 'data-act': 'edit' });
    if (s === 'draft' || s === 'unpublished') acts += IB('eye', 'Publish: show it to its audience', { 'data-act': 'publish' }, 'good');
    if (s === 'published') acts += IB('eyeOff', 'Unpublish: hide it again', { 'data-act': 'unpublish' });
    if (s === 'published' || s === 'unpublished') acts += IB('archive', 'Archive', { 'data-act': 'archive' });
    if (s === 'archived') acts += IB('restore', 'Restore', { 'data-act': 'restore' });
    if (s !== 'published' && s !== 'unpublished') acts += IB('trash', 'Delete', { 'data-act': 'delete' }, 'danger');
    return '<li class="lrow" data-id="' + esc(it.id) + '">' +
      '<button class="lmain" type="button" data-act="preview" title="' + (it.kind === 'link' ? 'Open the link' : 'Open in a new tab') + '"><span class="lico">' +
      (it.kind === 'link' ? I('link') : esc(app.extOf(it.file_path ? it.file_path.split('/').pop() : it.title))) + '</span>' +
      '<span class="ltext"><span class="lname">' + n + '</span><span class="lmeta">' + esc(meta.filter(Boolean).join(' · ')) + '</span></span></button>' +
      '<div class="lside"><span class="chip s-' + esc(s) + '">' + esc(STATUS[s] || s) + '</span><div class="lacts">' + acts + '</div></div></li>';
  }

  function emptyHtml(icon, title, text) {
    return '<span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p>';
  }

  function render() {
    drawTrail();
    drawPills();
    $('#cm-back').setAttribute('data-tip', cs.path.length ? 'Up one folder' : 'Back to the deliverables');
    var items = cs.items.filter(function (it) {
      if (it.kind === 'folder') return cs.show === 'all';
      if (cs.show === 'published') return it.status === 'published';
      if (cs.show === 'drafts') return it.status === 'draft' || it.status === 'unpublished';
      if (cs.show === 'archived') return it.status === 'archived';
      return true;
    }).sort(function (a, b) {
      if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    });
    $('#cm-rows').innerHTML = items.map(rowHtml).join('');
    var empty = $('#cm-empty');
    if (!cs.items.length) {
      empty.innerHTML = cs.q.trim()
        ? emptyHtml('search', 'No matches', 'Nothing here matches "' + esc(cs.q.trim()) + '".')
        : emptyHtml('inbox', 'Nothing here yet', 'Tap ' + I('upload', 'inline') + ' to add files, ' + I('link', 'inline') + ' to add a link, or drop files onto this list. New items start as drafts that only managers can see.');
      empty.hidden = false;
    } else if (!items.length) {
      empty.innerHTML = emptyHtml('inbox', 'Nothing in this view', 'Try another filter above.');
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }

  /* ---------- changing status and audience ---------- */
  async function patch(it, changes, verb, okText) {
    busy('Saving…');
    var res = await sb.from('content_items').update(changes).eq('id', it.id).select().maybeSingle();
    busy('');
    if (res.error || !res.data) {
      toast(res.error && res.error.message ? res.error.message : "Couldn't save that. You may not have permission.", 'bad');
      return false;
    }
    logAction('content.' + verb, it.deliverable + '/' + it.title, { id: it.id });
    toast(okText, 'ok');
    await load();
    return true;
  }

  async function publish(it) {
    var audience = it.audience;
    if (audience === 'managers' && MANAGEMENT_DEFAULT.indexOf(it.deliverable) === -1) audience = 'employees';
    var who = audience === 'public' ? 'Everyone, including visitors to the website,' : audience === 'employees' ? 'Employees' : 'Only managers';
    var ok = await ask({
      title: 'Publish This Item?',
      text: '"' + it.title + '" goes live now. ' + who + ' will see it right away.',
      ok: 'Publish'
    });
    if (!ok) return;
    var changes = { status: 'published' };
    if (audience !== it.audience) changes.audience = audience;
    patch(it, changes, 'publish', 'Published.');
  }

  async function removeItem(it) {
    var isFolder = it.kind === 'folder';
    if (isFolder) {
      var full = it.folder_path ? it.folder_path + '/' + it.title : it.title;
      var a = await sb.from('content_items').select('id').eq('deliverable', it.deliverable).eq('folder_path', full).limit(1);
      var b = await sb.from('content_items').select('id').eq('deliverable', it.deliverable).like('folder_path', likeEscape(full) + '/%').limit(1);
      if (a.error || b.error) { toast("Couldn't check the folder.", 'bad'); return; }
      if ((a.data || []).length || (b.data || []).length) { toast('Empty the folder before deleting it.', 'bad'); return; }
    }
    var ok = await ask({
      title: isFolder ? 'Delete This Folder?' : 'Delete This Item?',
      text: '"' + it.title + '" will be permanently deleted.',
      ok: 'Delete',
      danger: true
    });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('content_items').delete().eq('id', it.id).select('id');
    if (res.error || !(res.data || []).length) {
      busy('');
      toast("Couldn't delete that. Only drafts, unpublished and archived items can be deleted.", 'bad');
      return;
    }
    if (it.file_path) await sb.storage.from(BUCKET).remove([it.file_path]);
    busy('');
    logAction(isFolder ? 'content.folder.delete' : 'content.delete', it.deliverable + '/' + it.title, { id: it.id });
    toast(isFolder ? 'Folder deleted.' : 'Item deleted.', 'ok');
    await load();
  }

  /* ---------- images open in the viewer, with the other images of the same folder one arrow away ---------- */
  // the title may have no extension, so a saved copy takes it from the stored file's name
  function saveName(x) {
    var m = /\.([A-Za-z0-9]{1,5})$/.exec(x.file_path || '');
    return m && !new RegExp('\\.' + m[1] + '$', 'i').test(x.title) ? x.title + '.' + m[1].toLowerCase() : x.title;
  }
  function viewImages(it) {
    var pics = cs.items.filter(function (x) { return x.kind === 'file' && x.file_path && SngViewer.kindOf(x.file_path); });
    var d = deliverable(cs.key), where = cs.path.length ? cs.path.join(' / ') : (d ? d.name : '');
    var signed = function (x, save) {
      return sb.storage.from(BUCKET).createSignedUrl(x.file_path, 300, save ? { download: saveName(x) } : undefined).then(function (r) {
        if (r.error || !r.data) throw new Error('link');
        return r.data.signedUrl;
      });
    };
    SngViewer.open(pics.map(function (x) {
      return { name: x.title, sub: where, kind: SngViewer.kindOf(x.file_path), src: function () { return signed(x, false); }, download: function () { return signed(x, true); } };
    }), Math.max(0, pics.indexOf(it)));
  }

  /* ---------- opening a file or a link ---------- */
  async function preview(it) {
    if (it.kind === 'link') {
      if (/^https?:\/\//i.test(it.external_url || '')) window.open(it.external_url, '_blank', 'noopener');
      else toast('That link is not a web address.', 'bad');
      return;
    }
    if (window.SngViewer && it.file_path && SngViewer.kindOf(it.file_path)) { viewImages(it); return; }
    var w = window.open('', '_blank');
    var res = await sb.storage.from(BUCKET).createSignedUrl(it.file_path, 300);
    if (res.error || !res.data) {
      if (w) w.close();
      toast("Couldn't open that file.", 'bad');
      return;
    }
    if (w) { w.opener = null; w.location.href = res.data.signedUrl; }
    else window.location.href = res.data.signedUrl;
  }

  /* ---------- the details dialog (files and links) ---------- */
  function editItem(it, newLink) {
    var d = deliverable(newLink ? cs.key : it.deliverable);
    var link = newLink || it.kind === 'link';
    var dlg = $('#item-dlg'), form = $('#item-form'), err = $('#it-err');
    $('#it-title').textContent = newLink ? 'Add Link' : 'Item Details';
    $('#it-url-field').hidden = !link;
    $('#it-name').value = newLink ? '' : it.title;
    $('#it-url').value = newLink ? '' : it.external_url || '';
    $('#it-desc').value = newLink ? '' : it.description || '';
    $('#it-cat').value = newLink ? '' : it.category || '';
    $('#it-ver').value = newLink ? '' : it.version || '';
    $('#it-aud').innerHTML = Object.keys(AUDIENCE).map(function (k) {
      var off = k === 'public' && !(d && d.allow_public);
      return '<option value="' + k + '"' + (off ? ' disabled' : '') + '>' + AUDIENCE[k] + (off ? ' (not for this deliverable)' : '') + '</option>';
    }).join('');
    $('#it-aud').value = newLink ? 'managers' : it.audience;
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var title = $('#it-name').value.trim();
      var url = $('#it-url').value.trim();
      var problem = '';
      if (!title) problem = 'Enter a title.';
      else if (link && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) problem = 'Enter a full web address that starts with https://.';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      var fields = {
        title: title,
        description: $('#it-desc').value.trim(),
        category: $('#it-cat').value.trim() || null,
        version: $('#it-ver').value.trim() || null,
        audience: $('#it-aud').value
      };
      if (link) fields.external_url = url;
      $('#it-ok').disabled = true;
      var res;
      if (newLink) {
        fields.deliverable = cs.key;
        fields.kind = 'link';
        fields.folder_path = folderPath();
        res = await sb.from('content_items').insert(fields).select().maybeSingle();
      } else {
        res = await sb.from('content_items').update(fields).eq('id', it.id).select().maybeSingle();
      }
      $('#it-ok').disabled = false;
      if (res.error || !res.data) {
        err.textContent = res.error && res.error.message ? res.error.message : "Couldn't save that.";
        err.hidden = false;
        return;
      }
      dlg.close();
      logAction(newLink ? 'content.link.add' : 'content.edit', (newLink ? cs.key : it.deliverable) + '/' + title, { id: res.data.id });
      toast(newLink ? 'Link added as a draft.' : 'Saved.', 'ok');
      load();
    };
    $('#it-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#it-name').focus();
  }

  /* ---------- upload and new folder ---------- */
  async function upload(files) {
    if (!cs.key || !files.length) return;
    var ok = 0, failed = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      busy('Uploading ' + (i + 1) + ' of ' + files.length + '…');
      if (!ALLOWED.test(f.name)) { failed.push(f.name + ' (file type not allowed)'); continue; }
      if (f.size > app.maxMb * 1048576) { failed.push(f.name + ' (over ' + app.maxMb + ' MB)'); continue; }
      var clean = app.cleanName(f.name);
      var path = cs.key + '/' + newId() + '/' + clean;
      var up = await sb.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream', cacheControl: '3600' });
      if (up.error) { failed.push(f.name); continue; }
      var ins = await sb.from('content_items').insert({
        deliverable: cs.key, kind: 'file', folder_path: folderPath(), title: clean, file_path: path,
        extra: { size: f.size, mime: f.type || null }
      });
      if (ins.error) {
        await sb.storage.from(BUCKET).remove([path]);
        failed.push(f.name);
        continue;
      }
      ok++;
      logAction('content.upload', cs.key + '/' + clean);
    }
    busy('');
    if (ok && !failed.length) toast(ok === 1 ? 'File uploaded as a draft.' : ok + ' files uploaded as drafts.', 'ok');
    else if (ok) toast(ok + ' uploaded. Not uploaded: ' + failed.join(', '), 'bad');
    else toast('Nothing uploaded: ' + failed.join(', '), 'bad');
    await load();
  }

  async function newFolder() {
    var name = await ask({
      title: 'New Folder',
      label: 'Folder Name',
      ok: 'Create',
      validate: function (v) {
        if (!v) return 'Enter a folder name.';
        var clean = v.replace(/[\/\\]+/g, ' ').trim();
        if (cs.items.some(function (e) { return e.kind === 'folder' && e.title.toLowerCase() === clean.toLowerCase(); })) return 'A folder with that name already exists here.';
        return '';
      }
    });
    if (!name) return;
    var clean = name.replace(/[\/\\]+/g, ' ').trim();
    busy('Creating folder…');
    var res = await sb.from('content_items').insert({
      deliverable: cs.key, kind: 'folder', folder_path: folderPath(), title: clean, status: 'published', audience: 'managers'
    });
    busy('');
    if (res.error) toast("Couldn't create the folder.", 'bad');
    else { toast('Folder created.', 'ok'); logAction('content.folder.create', cs.key + '/' + clean); }
    await load();
  }

  /* ---------- wiring ---------- */
  $('#cm-attn').addEventListener('click', function (e) {
    var b = e.target.closest('[data-attn]');
    var it = b && this._items && this._items[Number(b.dataset.attn)];
    if (!it) return;
    if (it.special) openSpecial(it.special, it.tab);
    else if (it.dept) { cs.dept = it.dept; showHome(); }
  });
  $('#cm-depts').addEventListener('change', function (e) {
    if (!e.target.matches('[data-deptsel]')) return;
    cs.dept = e.target.value;
    showHome();
  });
  $('#cm-depts').addEventListener('click', function (e) {
    var d = e.target.closest('[data-dept]');
    if (!d) return;
    cs.dept = d.dataset.dept;
    showHome();
  });
  $('#cm-cards').addEventListener('click', function (e) {
    var s = e.target.closest('[data-special]');
    if (s) { var g = e.target.closest('[data-gtab]'); openSpecial(s.dataset.special, g ? g.dataset.gtab : undefined); return; }
    var b = e.target.closest('[data-open]');
    if (b) openDeliverable(b.dataset.open);
  });
  $('#cm-status').addEventListener('click', function (e) {
    var b = e.target.closest('[data-show]');
    if (!b) return;
    cs.show = b.dataset.show;
    render();
  });
  $('#cm-search').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(cs.timer);
    cs.timer = setTimeout(function () { cs.q = v; load(); }, 250);
  });
  $('#cm-crumbs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (!b || b.getAttribute('aria-current')) return;
    cs.q = '';
    $('#cm-search').value = '';
    if (b.dataset.go === 'home') { cs.key = ''; showHome(); return; }
    cs.path = cs.path.slice(0, Number(b.dataset.go));
    load();
  });
  $('#cm-back').addEventListener('click', function () {
    cs.q = '';
    $('#cm-search').value = '';
    if (cs.path.length) { cs.path.pop(); load(); } else { cs.key = ''; showHome(); }
  });
  $('#cm-rows').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    var li = e.target.closest('li.lrow');
    if (!btn || !li) return;
    var it = cs.items.filter(function (x) { return x.id === li.dataset.id; })[0];
    if (!it) return;
    switch (btn.dataset.act) {
      case 'open':
        cs.path = (it.folder_path ? it.folder_path.split('/') : []).concat(it.title);
        cs.q = '';
        $('#cm-search').value = '';
        load();
        break;
      case 'preview': preview(it); break;
      case 'edit': editItem(it, false); break;
      case 'publish': publish(it); break;
      case 'unpublish': patch(it, { status: 'unpublished' }, 'unpublish', 'Unpublished. Employees no longer see it.'); break;
      case 'archive': patch(it, { status: 'archived' }, 'archive', 'Moved to Archived.'); break;
      case 'restore': patch(it, { status: 'unpublished' }, 'restore', 'Restored as Unpublished.'); break;
      case 'delete': removeItem(it); break;
    }
  });
  $('#cm-upload').addEventListener('click', function () { $('#cm-file').click(); });
  $('#cm-file').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    e.target.value = '';
    upload(files);
  });
  $('#cm-folder').addEventListener('click', newFolder);
  $('#cm-link').addEventListener('click', function () { editItem(null, true); });

  var drop = $('#cm-drop');
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function () { drop.classList.remove('drag'); });
  });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    upload(Array.prototype.slice.call(e.dataTransfer.files));
  });

  window.MembersContent = {
    /* called each time the Content tab opens */
    open: async function () {
      if (!cs.ready) {
        if (!cs.loading) {
          busy('Loading…');
          cs.loading = loadDeliverables().then(function (ok) { cs.ready = ok; cs.loading = null; busy(''); });
        }
        await cs.loading;
      }
      if (cs.view === 'special' && cs.special) openSpecial(cs.special);
      else if (cs.view === 'browser' && cs.key) await load();
      else await showHome();
    },
    /* called when someone signs out, so the next person starts clean */
    reset: function () {
      cs.ready = false; cs.loading = null; cs.key = ''; cs.path = []; cs.items = []; cs.q = ''; cs.view = 'home'; cs.show = 'all'; cs.special = '';
      $('#cm-special').innerHTML = '';
      $('#cm-search').value = '';
      $('#cm-rows').innerHTML = '';
      $('#cm-cards').innerHTML = '';
    }
  };
})();
