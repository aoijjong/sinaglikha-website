/*
  SINAGLIKHA Vacancies: the recruitment team's list of positions. A vacancy is a draft until someone
  publishes it; only published vacancies inside their opening and closing dates appear on the public
  Careers page (careers/index.html). The database rules in supabase/careers.sql decide who can read and
  change vacancies (the Administrator and the Staffing and Recruitment Senior Manager); this screen only
  shows what those rules allow. Poster images go in the public "careers" bucket.
  Opened from the Vacancies row of the Staffing and Recruitment panel in the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var BUCKET = 'careers';
  var DEPT_KEYS = ['staffing', 'training', 'engagement', 'rewards', 'legal'];
  var STATUS = { draft: ['s-draft', 'Draft'], published: ['s-published', 'Published'], closed: ['t-incomplete', 'Closed'], archived: ['s-archived', 'Archived'] };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var V = { box: null, ctx: null, rows: [], failed: false, q: '', show: 'all', dept: 'all', poster: null };

  function canManage() { return state.isAdmin || (state.profile && state.profile.department === 'staffing'); }
  function busy(text) {
    var b = $('#vc-busy', V.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }
  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  // an image's address: the site's own posters start with assets/, uploaded ones live in the careers bucket
  function imgUrl(path) {
    if (!path) return '';
    if (/^assets\//.test(path)) return '../' + path;
    var cfg = window.MEMBERS_CONFIG || {};
    return cfg.SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/');
  }
  function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }

  /* ---------- the list ---------- */
  function shell() {
    V.box.style.position = 'relative';
    V.box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Vacancies</h2><p class="sub">Drafts stay private until you publish them</p></div>' +
      '<div class="ph-actions"><div class="sbox">' + I('search') + '<input id="vc-q" type="search" placeholder="Search" aria-label="Search vacancies" autocomplete="off"></div>' +
      IB('external', 'Open the public Careers page', { 'data-a': 'site' }) + IB('plus', 'Add a vacancy', { 'data-a': 'add' }, 'solid') + '</div></div>' +
      '<div class="vc-dash" id="vc-dash"></div>' +
      '<div class="pills" id="vc-pills" role="group" aria-label="Show"></div>' +
      '<div class="list-card"><ul class="rows" id="vc-rows"></ul><div class="es" id="vc-empty" hidden></div></div>' +
      '<div class="busy" id="vc-busy" hidden role="status">Loading…</div>' +
      '<p class="fine">Only published vacancies inside their dates show on Careers.</p>';
  }

  async function load() {
    busy('Loading…');
    var res = await sb.from('vacancies').select('*').order('sort_order', { ascending: true }).order('title', { ascending: true }).limit(500);
    busy('');
    V.failed = !!res.error;
    V.rows = res.error ? [] : res.data || [];
    render();
  }

  function isLive(v) {
    var t = today();
    return v.status === 'published' && (!v.opens_on || v.opens_on <= t) && (!v.closes_on || v.closes_on >= t);
  }

  function render() {
    // the department chosen in the dashboard narrows the numbers, the pills and the list together
    var scope = V.rows.filter(function (v) { return V.dept === 'all' || v.department === V.dept; });
    var counts = { all: scope.length, published: 0, draft: 0, closed: 0, archived: 0 };
    scope.forEach(function (v) { counts[v.status] = (counts[v.status] || 0) + 1; });
    var perDept = {};
    V.rows.forEach(function (v) { perDept[v.department] = (perDept[v.department] || 0) + 1; });
    var openings = scope.filter(function (v) { return v.status === 'published'; }).reduce(function (n, v) { return n + (v.openings || 0); }, 0);
    var tile = function (key, n, label) {
      return '<button class="vc-k" type="button" data-show="' + key + '" aria-pressed="' + (V.show === key) + '"><b>' + n + '</b><span>' + label + '</span></button>';
    };
    $('#vc-dash', V.box).innerHTML = '<div class="vc-dh">Vacancy dashboard</div>' +
      '<div class="vc-kpis">' + tile('all', counts.all, 'Total vacancies') + tile('published', counts.published, 'Published') + tile('draft', counts.draft, 'Drafts') + tile('closed', counts.closed, 'Closed') + '</div>' +
      '<p class="vc-note">' + (counts.published ? 'The published vacancies list ' + (openings ? openings + (openings === 1 ? ' opening' : ' openings') : 'no opening count yet') + '. ' : '') + 'Applicant numbers will appear here once applications are open.</p>' +
      '<label class="vc-fl" for="vc-dept-filter">Filter by department</label>' +
      '<select id="vc-dept-filter" class="vc-sel">' + [['all', 'All Departments']].concat(DEPT_KEYS.map(function (k) { return [k, app.depts[k] || k]; })).map(function (d) {
        return '<option value="' + d[0] + '"' + (V.dept === d[0] ? ' selected' : '') + '>' + esc(d[1]) + (d[0] === 'all' ? ' (' + V.rows.length + ')' : ' (' + (perDept[d[0]] || 0) + ')') + '</option>';
      }).join('') + '</select>' +
      '<p class="vc-show">Showing vacancy records for: ' + esc(V.dept === 'all' ? 'All Departments' : app.depts[V.dept] || V.dept) + '</p>';
    $('#vc-pills', V.box).innerHTML = [['all', 'All'], ['published', 'Published'], ['draft', 'Drafts'], ['closed', 'Closed'], ['archived', 'Archived']].map(function (s) {
      return '<button class="pill" type="button" data-show="' + s[0] + '" aria-pressed="' + (V.show === s[0]) + '">' + s[1] + ' <small>' + (counts[s[0]] || 0) + '</small></button>';
    }).join('');
    var q = V.q.trim().toLowerCase();
    var list = scope.filter(function (v) {
      return (V.show === 'all' || v.status === V.show) && (!q || (v.title + ' ' + (app.depts[v.department] || '')).toLowerCase().indexOf(q) !== -1);
    });
    $('#vc-rows', V.box).innerHTML = list.map(function (v) {
      var st = STATUS[v.status] || ['s-draft', v.status];
      var meta = [app.depts[v.department] || v.department, v.openings ? v.openings + (v.openings === 1 ? ' opening' : ' openings') : '', v.opens_on ? 'Opens ' + app.fmtDate(v.opens_on) : '', v.closes_on ? 'Closes ' + app.fmtDate(v.closes_on) : ''].filter(Boolean).join(' · ');
      var note = v.status === 'published' && !isLive(v) ? '<span class="lmeta" style="color:#8A5A12">Published, but outside its dates, so Careers is not showing it</span>' : '';
      var acts = IB('pencil', 'Edit this vacancy', { 'data-a': 'edit' });
      if (v.poster_path) acts += IB('external', 'Preview the poster', { 'data-a': 'preview' });
      if (v.status === 'draft') acts += IB('eye', 'Publish: show it on Careers', { 'data-a': 'publish' }, 'good');
      if (v.status === 'published') acts += IB('eyeOff', 'Unpublish: back to a draft', { 'data-a': 'unpublish' }) + IB('lock', 'Close: stop showing it, keep the record', { 'data-a': 'close' });
      if (v.status === 'closed') acts += IB('eye', 'Reopen: show it on Careers again', { 'data-a': 'publish' }, 'good') + IB('archive', 'Archive', { 'data-a': 'archive' });
      if (v.status === 'archived') acts += IB('restore', 'Restore as a draft', { 'data-a': 'unpublish' });
      if (v.status === 'draft' || v.status === 'archived') acts += IB('trash', 'Delete', { 'data-a': 'del' }, 'danger');
      var thumb = v.thumb_path || v.poster_path;
      return '<li class="lrow" data-id="' + esc(v.id) + '"><div class="lmain" style="cursor:default"><span class="lico' + (thumb ? ' has-photo' : '') + '">' +
        (thumb ? '<img src="' + esc(imgUrl(thumb)) + '" alt="" loading="lazy">' : I('users')) + '</span><span class="ltext"><span class="lname">' + esc(v.title) +
        '</span><span class="lmeta">' + esc(meta) + '</span>' + note + '</span></div><div class="lside"><span class="chip ' + st[0] + '">' + st[1] + '</span><div class="lacts">' + acts + '</div></div></li>';
    }).join('');
    var empty = $('#vc-empty', V.box);
    if (V.failed) {
      empty.innerHTML = '<span class="eic">' + I('users') + '</span><b>Not set up yet</b><p>Run supabase/careers.sql in the Supabase SQL editor, then reload this page.</p>';
      empty.hidden = false;
    } else if (!V.rows.length) {
      empty.innerHTML = '<span class="eic">' + I('users') + '</span><b>No vacancies yet</b><p>Tap ' + I('plus', 'inline') + ' to add the first one, or run supabase/careers_seed.sql to add the posters you were given as drafts.</p>';
      empty.hidden = false;
    } else if (!list.length) {
      empty.innerHTML = '<span class="eic">' + I('search') + '</span><b>No matches</b><p>Try another filter or search.</p>';
      empty.hidden = false;
    } else empty.hidden = true;
  }

  /* ---------- poster images: shrunk in the browser before they are uploaded ---------- */
  function shrink(file, maxW, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var w = Math.min(maxW, im.naturalWidth), h = Math.round(im.naturalHeight * w / im.naturalWidth);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode')); }, 'image/webp', quality);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('read')); };
      im.src = url;
    });
  }

  /* ---------- the add / edit dialog ---------- */
  function openDialog(v) {
    var dlg = $('#vc-dlg'), form = $('#vc-form'), err = $('#vc-err');
    V.poster = null;
    $('#vc-title').textContent = v ? 'Edit Vacancy' : 'New Vacancy';
    $('#vc-name').value = v ? v.title : '';
    $('#vc-dept').innerHTML = DEPT_KEYS.map(function (k) { return '<option value="' + k + '">' + esc(app.depts[k] || k) + '</option>'; }).join('');
    $('#vc-dept').value = v ? v.department : (state.profile && DEPT_KEYS.indexOf(state.profile.department) !== -1 ? state.profile.department : 'staffing');
    $('#vc-sum').value = v ? v.summary : '';
    $('#vc-resp').value = v ? v.responsibilities : '';
    $('#vc-qual').value = v ? v.qualifications : '';
    $('#vc-type').value = v ? v.employment_type : '';
    $('#vc-loc').value = v ? v.location : '';
    $('#vc-open').value = v && v.openings ? v.openings : '';
    $('#vc-from').value = v && v.opens_on ? v.opens_on : '';
    $('#vc-to').value = v && v.closes_on ? v.closes_on : '';
    $('#vc-file').value = '';
    $('#vc-ok').textContent = v ? 'Save' : 'Add as draft';
    err.hidden = true;

    function drawPoster() {
      var src = V.poster ? URL.createObjectURL(V.poster) : (v && (v.thumb_path || v.poster_path) ? imgUrl(v.thumb_path || v.poster_path) : '');
      $('#vc-poster').innerHTML = src ? '<img src="' + esc(src) + '" alt="Poster preview">' : '<span class="fine">No poster yet.</span>';
      $('#vc-pick').textContent = src ? 'Replace the poster' : 'Choose a poster image';
    }
    drawPoster();
    $('#vc-pick').onclick = function () { $('#vc-file').click(); };
    $('#vc-file').onchange = function (e) {
      var f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) { err.textContent = 'Use a PNG, JPG or WebP image. For a PDF, save one page as an image first.'; err.hidden = false; return; }
      if (f.size > 15 * 1048576) { err.textContent = 'That image is over 15 MB. Try a smaller one.'; err.hidden = false; return; }
      err.hidden = true;
      V.poster = f;
      drawPoster();
    };

    form.onsubmit = async function (e) {
      e.preventDefault();
      var title = $('#vc-name').value.trim();
      var from = $('#vc-from').value, to = $('#vc-to').value, openings = $('#vc-open').value.trim();
      if (!title) { err.textContent = 'Enter the position title.'; err.hidden = false; return; }
      if (from && to && to < from) { err.textContent = 'The closing date is before the opening date.'; err.hidden = false; return; }
      if (openings && (!/^\d+$/.test(openings) || Number(openings) < 1 || Number(openings) > 999)) { err.textContent = 'Openings must be a whole number from 1 to 999.'; err.hidden = false; return; }
      err.hidden = true;
      $('#vc-ok').disabled = true;
      var fields = {
        title: title, department: $('#vc-dept').value, summary: $('#vc-sum').value.trim(), responsibilities: $('#vc-resp').value.trim(), qualifications: $('#vc-qual').value.trim(),
        employment_type: $('#vc-type').value.trim(), location: $('#vc-loc').value.trim(), openings: openings ? Number(openings) : null, opens_on: from || null, closes_on: to || null
      };
      var uploaded = [];
      if (V.poster) {
        try {
          var id = newId(), big = await shrink(V.poster, 1200, 0.85), small = await shrink(V.poster, 360, 0.78);
          var p1 = 'posters/' + id + '.webp', p2 = 'posters/' + id + '-t.webp';
          var u1 = await sb.storage.from(BUCKET).upload(p1, big, { upsert: false, contentType: 'image/webp', cacheControl: '31536000' });
          if (u1.error) throw u1.error;
          uploaded.push(p1);
          var u2 = await sb.storage.from(BUCKET).upload(p2, small, { upsert: false, contentType: 'image/webp', cacheControl: '31536000' });
          if (u2.error) throw u2.error;
          uploaded.push(p2);
          fields.poster_path = p1;
          fields.thumb_path = p2;
        } catch (x) {
          if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded);
          $('#vc-ok').disabled = false;
          err.textContent = "Couldn't upload the poster. You may not have permission, or the image couldn't be read.";
          err.hidden = false;
          return;
        }
      }
      var res = v
        ? await sb.from('vacancies').update(fields).eq('id', v.id).select('id').maybeSingle()
        : await sb.from('vacancies').insert(Object.assign({ status: 'draft', sort_order: 1000 }, fields)).select('id').maybeSingle();
      $('#vc-ok').disabled = false;
      if (res.error || !res.data) {
        if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded);
        err.textContent = /closing date|vacancies_stamp/i.test(res.error && res.error.message || '') ? 'The closing date is before the opening date.' : "Couldn't save that. You may not have permission.";
        err.hidden = false;
        return;
      }
      if (v && uploaded.length) {
        // the poster that was replaced is removed from storage (the site's own starting posters are not in the bucket)
        var old = [v.poster_path, v.thumb_path].filter(function (p) { return p && !/^assets\//.test(p); });
        if (old.length) await sb.storage.from(BUCKET).remove(old);
      }
      dlg.close();
      logAction(v ? 'vacancy.edit' : 'vacancy.add', title, { id: res.data.id });
      toast(v ? 'Saved.' : 'Added as a draft. Publish it when it is ready.', 'ok');
      load();
    };
    $('#vc-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#vc-name').focus();
  }

  async function setStatus(v, status, message, action) {
    busy('Saving…');
    var res = await sb.from('vacancies').update({ status: status }).eq('id', v.id).select('id').maybeSingle();
    busy('');
    if (res.error || !res.data) { toast("Couldn't save that. You may not have permission.", 'bad'); return; }
    logAction(action, v.title, { id: v.id });
    toast(message, 'ok');
    await load();
  }

  async function remove(v) {
    var ok = await ask({ title: 'Delete This Vacancy?', text: '"' + v.title + '" will be permanently deleted. Applications are not affected because none exist yet.', ok: 'Delete', danger: true });
    if (!ok) return;
    busy('Deleting…');
    var res = await sb.from('vacancies').delete().eq('id', v.id).select('id');
    if (res.error || !(res.data || []).length) { busy(''); toast("Couldn't delete that. You may not have permission.", 'bad'); return; }
    var own = [v.poster_path, v.thumb_path].filter(function (p) { return p && !/^assets\//.test(p); });
    if (own.length) await sb.storage.from(BUCKET).remove(own);
    busy('');
    logAction('vacancy.delete', v.title, { id: v.id });
    toast('Deleted.', 'ok');
    await load();
  }

  function onClick(e) {
    var pill = e.target.closest('[data-show]');
    if (pill) { V.show = pill.dataset.show; render(); return; }
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'back') { V.ctx.back(); return; }
    if (a === 'add') { openDialog(null); return; }
    if (a === 'site') { window.open('../careers/', '_blank', 'noopener'); return; }
    var li = e.target.closest('li.lrow'), row = li && V.rows.filter(function (x) { return x.id === li.dataset.id; })[0];
    if (!row) return;
    if (a === 'edit') openDialog(row);
    else if (a === 'preview') window.open(imgUrl(row.poster_path), '_blank', 'noopener');
    else if (a === 'publish') setStatus(row, 'published', 'Published. It shows on Careers while it is inside its dates.', 'vacancy.publish');
    else if (a === 'unpublish') setStatus(row, 'draft', 'Back to a draft. Careers no longer shows it.', 'vacancy.unpublish');
    else if (a === 'close') setStatus(row, 'closed', 'Closed. Careers no longer shows it.', 'vacancy.close');
    else if (a === 'archive') setStatus(row, 'archived', 'Archived.', 'vacancy.archive');
    else if (a === 'del') remove(row);
  }

  window.MembersVacancies = {
    open: function (box, ctx) {
      V.box = box;
      V.ctx = ctx;
      V.q = '';
      V.show = 'all';
      V.dept = 'all';
      if (!canManage()) {
        box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') + '<div class="ph-main"><h2>Vacancies</h2></div></div>' +
          '<div class="list-card"><div class="es"><span class="eic">' + I('lock') + '</span><b>Staffing and Recruitment only</b><p>Vacancies can be managed by Staffing and Recruitment.</p></div></div>';
        box.onclick = onClick;
        return;
      }
      shell();
      box.onclick = onClick;
      box.oninput = function (e) { if (e.target.id === 'vc-q') { V.q = e.target.value; render(); } };
      box.onchange = function (e) { if (e.target.id === 'vc-dept-filter') { V.dept = e.target.value; render(); } };
      return load();
    }
  };
})();
