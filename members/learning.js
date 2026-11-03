/*
  SINAGLIKHA Learning Management System: the builder for Training and Development (and every manager).
  A course holds modules; a module is a link (a video, an article, a form) or a file. A course stays
  invisible to employees until it is published. Employees open modules and mark them complete in the
  Employee Portal; they see only their own progress, while managers see how many people finished each
  module. The database rules in supabase/phase3.sql decide who can do what; this screen only shows it.
  Opened from the Learning Management System card in the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var BUCKET = 'content';
  var ALLOWED = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|txt|csv)$/i;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var L = { box: null, ctx: null, courses: [], mods: [], course: null, staff: 0, failed: false, token: 0 };

  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function busy(text) {
    var b = $('#lm-busy', L.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function sorted(list) {
    return list.slice().sort(function (a, b) { return (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)); });
  }
  function empty(icon, title, text) {
    return '<div class="es"><span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p></div>';
  }
  function frame(inner) {
    L.box.innerHTML = inner + '<div class="busy" id="lm-busy" hidden role="status">Loading…</div>';
    L.box.style.position = 'relative';
  }

  /* ---------- courses ---------- */
  async function showCourses() {
    L.course = null;
    var token = ++L.token;
    frame('<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Learning Management System</h2><p class="sub">Courses and modules for employees</p></div>' +
      '<div class="ph-actions">' + IB('plus', 'Add a course', { 'data-a': 'add-course' }, 'solid') + '</div></div>' +
      '<p class="sp-note">Employees see a course once published and track their own progress.</p>' +
      '<div class="list-card" id="lc-list"></div>');
    busy('Loading…');
    var c = await sb.from('learning_courses').select('*').limit(500);
    var m = c.error ? { data: [] } : await sb.from('learning_modules').select('id,course_id').limit(5000);
    if (token !== L.token) return;
    busy('');
    L.failed = !!c.error;
    L.courses = sorted(c.data || []);
    var counts = {};
    (m.data || []).forEach(function (x) { counts[x.course_id] = (counts[x.course_id] || 0) + 1; });
    var list = $('#lc-list', L.box);
    if (L.failed) { list.innerHTML = empty('book', 'Not set up yet', 'Run supabase/phase3.sql in the Supabase SQL editor, then reload this page.'); return; }
    if (!L.courses.length) { list.innerHTML = empty('book', 'No courses yet', 'Tap ' + I('plus', 'inline') + ' to create the first one, then add modules to it.'); return; }
    list.innerHTML = '<ul class="rows">' + L.courses.map(function (x, i) {
      var n = counts[x.id] || 0;
      return '<li class="lrow" data-id="' + esc(x.id) + '"><button class="lmain" type="button" data-a="open-course"><span class="lico">' + I('book') + '</span>' +
        '<span class="ltext"><span class="lname">' + esc(x.title) + '</span><span class="lmeta">' + n + (n === 1 ? ' module' : ' modules') + '</span></span></button>' +
        '<div class="lside"><span class="chip ' + (x.published ? 's-published' : 's-draft') + '">' + (x.published ? 'Published' : 'Draft') + '</span><div class="lacts">' +
        (i > 0 ? IB('arrowUp', 'Move up', { 'data-a': 'up' }) : '') + (i < L.courses.length - 1 ? IB('arrowDown', 'Move down', { 'data-a': 'down' }) : '') +
        (x.published ? IB('eyeOff', 'Unpublish: hide from employees', { 'data-a': 'toggle' }) : IB('eye', 'Publish: show to employees', { 'data-a': 'toggle' }, 'good')) +
        IB('pencil', 'Edit', { 'data-a': 'edit-course' }) + IB('trash', 'Delete', { 'data-a': 'del-course' }, 'danger') + '</div></div></li>';
    }).join('') + '</ul>';
  }

  function courseDialog(c) {
    var dlg = $('#lc-dlg'), form = $('#lc-form'), err = $('#lc-err');
    $('#lc-title').textContent = c ? 'Edit Course' : 'Add Course';
    $('#lc-name').value = c ? c.title : '';
    $('#lc-desc').value = c ? c.description || '' : '';
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var title = $('#lc-name').value.trim();
      if (!title) { err.textContent = 'Enter a title.'; err.hidden = false; return; }
      var fields = { title: title, description: $('#lc-desc').value.trim() };
      $('#lc-ok').disabled = true;
      var res = c
        ? await sb.from('learning_courses').update(fields).eq('id', c.id).select('id').maybeSingle()
        : await sb.from('learning_courses').insert(Object.assign({ position: L.courses.length }, fields)).select('id').maybeSingle();
      $('#lc-ok').disabled = false;
      if (res.error || !res.data) { err.textContent = "Couldn't save that. You may not have permission."; err.hidden = false; return; }
      dlg.close();
      logAction(c ? 'learning.course.edit' : 'learning.course.add', title, { id: res.data.id });
      toast(c ? 'Saved.' : 'Course added as a draft.', 'ok');
      showCourses();
    };
    $('#lc-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#lc-name').focus();
  }

  async function move(table, list, id, dir, reload) {
    var i = list.findIndex(function (x) { return x.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var a = list[i], b = list[j];
    busy('Saving…');
    var r1 = await sb.from(table).update({ position: j }).eq('id', a.id).select('id').maybeSingle();
    var r2 = await sb.from(table).update({ position: i }).eq('id', b.id).select('id').maybeSingle();
    busy('');
    if (r1.error || r2.error) toast("Couldn't change the order.", 'bad');
    reload();
  }

  async function removeCourse(c) {
    var ok = await ask({ title: 'Delete This Course?', text: '"' + c.title + '" and all of its modules will be permanently deleted, along with everyone\'s progress in it.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var files = await sb.from('learning_modules').select('file_path').eq('course_id', c.id).eq('kind', 'file');
    var res = await sb.from('learning_courses').delete().eq('id', c.id).select('id');
    if (res.error || !(res.data || []).length) { busy(''); toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    var paths = (files.data || []).map(function (x) { return x.file_path; }).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    busy('');
    logAction('learning.course.delete', c.title, { id: c.id });
    toast('Course deleted.', 'ok');
    showCourses();
  }

  /* ---------- modules ---------- */
  async function showModules(c) {
    L.course = c;
    var token = ++L.token;
    frame('<div class="ph">' + IB('back', 'Back to the courses', { 'data-a': 'courses' }, 'line') +
      '<div class="ph-main"><h2>' + esc(c.title) + '</h2><p class="sub">' + (c.published ? 'Published: employees can see this course' : 'Draft: only managers can see this course') + '</p></div>' +
      '<div class="ph-actions">' + IB('plus', 'Add a module', { 'data-a': 'add-module' }, 'solid') + '</div></div>' +
      '<div class="list-card" id="lm-list"></div>');
    busy('Loading…');
    var m = await sb.from('learning_modules').select('*').eq('course_id', c.id).limit(500);
    var mods = sorted(m.data || []);
    var ids = mods.map(function (x) { return x.id; });
    var p = ids.length ? await sb.from('learning_progress').select('module_id').in('module_id', ids).limit(20000) : { data: [] };
    var staff = await sb.rpc('employee_options');
    if (token !== L.token) return;
    busy('');
    L.mods = mods;
    L.staff = Array.isArray(staff.data) ? staff.data.filter(function (x) { return x.active; }).length : 0;
    var done = {};
    (p.data || []).forEach(function (x) { done[x.module_id] = (done[x.module_id] || 0) + 1; });
    var list = $('#lm-list', L.box);
    if (!mods.length) { list.innerHTML = empty('book', 'No modules yet', 'Tap ' + I('plus', 'inline') + ' to add a link or a file. Employees go through the modules in this order.'); return; }
    list.innerHTML = '<ul class="rows">' + mods.map(function (x, i) {
      var meta = [x.kind === 'link' ? 'Link' : 'File', (done[x.id] || 0) + (L.staff ? ' of ' + L.staff : '') + ' completed'].join(' · ');
      return '<li class="lrow" data-id="' + esc(x.id) + '"><button class="lmain" type="button" data-a="open-module" title="Open this module"><span class="lico">' + I(x.kind === 'link' ? 'link' : 'file') + '</span>' +
        '<span class="ltext"><span class="lname">' + esc(x.title) + '</span><span class="lmeta">' + esc(meta) + '</span></span></button>' +
        '<div class="lside"><div class="lacts">' + (i > 0 ? IB('arrowUp', 'Move up', { 'data-a': 'mup' }) : '') + (i < mods.length - 1 ? IB('arrowDown', 'Move down', { 'data-a': 'mdown' }) : '') +
        IB('pencil', 'Edit', { 'data-a': 'edit-module' }) + IB('trash', 'Delete', { 'data-a': 'del-module' }, 'danger') + '</div></div></li>';
    }).join('') + '</ul>';
  }

  function moduleDialog(mod) {
    var dlg = $('#lm-dlg'), form = $('#lm-form'), err = $('#lm-err');
    $('#lm-title').textContent = mod ? 'Edit Module' : 'Add Module';
    $('#lm-name').value = mod ? mod.title : '';
    $('#lm-desc').value = mod ? mod.description || '' : '';
    $('#lm-kind').value = mod ? mod.kind : 'link';
    $('#lm-kind-field').hidden = !!mod;
    $('#lm-url').value = mod && mod.kind === 'link' ? mod.url || '' : '';
    $('#lm-file').value = '';
    function sync() {
      var kind = $('#lm-kind').value;
      $('#lm-url-field').hidden = kind !== 'link';
      $('#lm-file-field').hidden = !(kind === 'file' && !mod);
    }
    $('#lm-kind').onchange = sync;
    sync();
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var title = $('#lm-name').value.trim(), kind = $('#lm-kind').value, url = $('#lm-url').value.trim(), file = $('#lm-file').files[0], problem = '';
      if (!title) problem = 'Enter a title.';
      else if (kind === 'link' && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) problem = 'Enter a full web address that starts with https://.';
      else if (kind === 'file' && !mod && !file) problem = 'Choose a file.';
      else if (kind === 'file' && !mod && !ALLOWED.test(file.name)) problem = 'That file type is not allowed. Use PDF, an image, Word, Excel, PowerPoint, text or CSV.';
      else if (kind === 'file' && !mod && file.size > app.maxMb * 1048576) problem = 'That file is over ' + app.maxMb + ' MB.';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      $('#lm-ok').disabled = true;
      var res, path = null;
      if (mod) {
        var fields = { title: title, description: $('#lm-desc').value.trim() };
        if (mod.kind === 'link') fields.url = url;
        res = await sb.from('learning_modules').update(fields).eq('id', mod.id).select('id').maybeSingle();
      } else {
        if (kind === 'file') {
          path = 'learning/' + newId() + '/' + app.cleanName(file.name);
          var up = await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream', cacheControl: '3600' });
          if (up.error) { $('#lm-ok').disabled = false; err.textContent = "Couldn't upload the file. You may not have permission."; err.hidden = false; return; }
        }
        res = await sb.from('learning_modules').insert({
          course_id: L.course.id, title: title, description: $('#lm-desc').value.trim(), kind: kind,
          url: kind === 'link' ? url : null, file_path: path, position: L.mods.length
        }).select('id').maybeSingle();
        if ((res.error || !res.data) && path) await sb.storage.from(BUCKET).remove([path]);
      }
      $('#lm-ok').disabled = false;
      if (res.error || !res.data) { err.textContent = "Couldn't save that. You may not have permission."; err.hidden = false; return; }
      dlg.close();
      logAction(mod ? 'learning.module.edit' : 'learning.module.add', L.course.title + ' / ' + title, { id: res.data.id });
      toast(mod ? 'Saved.' : 'Module added.', 'ok');
      showModules(L.course);
    };
    $('#lm-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#lm-name').focus();
  }

  async function openModule(mod) {
    if (mod.kind === 'link') {
      if (/^https?:\/\//i.test(mod.url || '')) window.open(mod.url, '_blank', 'noopener'); else toast('That link is not a web address.', 'bad');
      return;
    }
    var w = window.open('', '_blank');
    var res = await sb.storage.from(BUCKET).createSignedUrl(mod.file_path, 300);
    if (res.error || !res.data) { if (w) w.close(); toast("Couldn't open that file.", 'bad'); return; }
    if (w) { w.opener = null; w.location.href = res.data.signedUrl; } else window.location.href = res.data.signedUrl;
  }

  async function removeModule(mod) {
    var ok = await ask({ title: 'Delete This Module?', text: '"' + mod.title + '" will be permanently deleted, along with everyone\'s progress on it.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('learning_modules').delete().eq('id', mod.id).select('id');
    if (res.error || !(res.data || []).length) { busy(''); toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    if (mod.file_path) await sb.storage.from(BUCKET).remove([mod.file_path]);
    busy('');
    logAction('learning.module.delete', L.course.title + ' / ' + mod.title, { id: mod.id });
    toast('Module deleted.', 'ok');
    showModules(L.course);
  }

  /* ---------- wiring ---------- */
  function onClick(e) {
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a, li = e.target.closest('li.lrow'), id = li && li.dataset.id;
    var course = id && L.courses.filter(function (x) { return x.id === id; })[0];
    var mod = id && L.mods.filter(function (x) { return x.id === id; })[0];
    if (a === 'back') L.ctx.back();
    else if (a === 'courses') showCourses();
    else if (a === 'add-course') courseDialog(null);
    else if (a === 'add-module') moduleDialog(null);
    else if (a === 'open-course' && course) showModules(course);
    else if (a === 'edit-course' && course) courseDialog(course);
    else if (a === 'del-course' && course) removeCourse(course);
    else if (a === 'up' && course) move('learning_courses', L.courses, course.id, -1, showCourses);
    else if (a === 'down' && course) move('learning_courses', L.courses, course.id, 1, showCourses);
    else if (a === 'toggle' && course) {
      sb.from('learning_courses').update({ published: !course.published }).eq('id', course.id).select('id').maybeSingle().then(function (r) {
        if (r.error || !r.data) { toast("Couldn't save that. You may not have permission.", 'bad'); return; }
        logAction(course.published ? 'learning.course.unpublish' : 'learning.course.publish', course.title, { id: course.id });
        toast(course.published ? 'Hidden from employees.' : 'Employees can see it now.', 'ok');
        showCourses();
      });
    }
    else if (a === 'open-module' && mod) openModule(mod);
    else if (a === 'edit-module' && mod) moduleDialog(mod);
    else if (a === 'del-module' && mod) removeModule(mod);
    else if (a === 'mup' && mod) move('learning_modules', L.mods, mod.id, -1, function () { showModules(L.course); });
    else if (a === 'mdown' && mod) move('learning_modules', L.mods, mod.id, 1, function () { showModules(L.course); });
  }

  window.MembersLearning = {
    open: function (box, ctx) {
      L.box = box;
      L.ctx = ctx;
      box.onclick = onClick;
      return showCourses();
    }
  };
})();
