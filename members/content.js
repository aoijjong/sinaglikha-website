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
  var DEPT_ICON = { staffing: 'users', training: 'book', engagement: 'chat', rewards: 'award', legal: 'scale' };
  var KIND_ICON = { document: 'file', program: 'calendar', module: 'book', evaluation: 'clipboard', special: 'clock' };
  var SHOW = [['all', 'All'], ['published', 'Published'], ['drafts', 'Drafts'], ['archived', 'Archived']];
  /* deliverables with a screen of their own: the module that draws it, and the line shown on its card */
  var SPECIAL = { attendance: ['MembersAttendance', 'Review and correct time records'], pms: ['MembersEvaluations', 'Evaluation forms for employees'] };

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
      cards.innerHTML = '<div class="es" style="grid-column:1/-1"><span class="eic">' + I('inbox') + '</span><b>Not set up yet</b><p>Run supabase/content_manager.sql in the Supabase SQL editor, then reload this page.</p></div>';
      return;
    }
    var mine = myDept();
    var order = DEPT_ORDER.slice();
    if (mine && order.indexOf(mine) > 0) { order.splice(order.indexOf(mine), 1); order.unshift(mine); }
    pills.innerHTML = order.map(function (d) {
      return '<button class="pill" type="button" data-dept="' + d + '" aria-pressed="' + (d === cs.dept) + '">' + I(DEPT_ICON[d]) + esc(app.depts[d] || d) + '</button>';
    }).join('');
    cards.innerHTML = '';
    var res = await sb.from('content_items').select('deliverable,status').neq('kind', 'folder').limit(10000);
    if (cs.view !== 'home') return;
    var counts = {};
    (res.data || []).forEach(function (r) {
      var c = counts[r.deliverable] || (counts[r.deliverable] = { published: 0, draft: 0, unpublished: 0, archived: 0 });
      if (c[r.status] !== undefined) c[r.status]++;
    });
    cards.innerHTML = cs.deliverables.filter(function (d) { return d.department === cs.dept; }).map(function (d) {
      var icon = '<span class="di">' + I(KIND_ICON[d.kind] || 'file') + '</span>';
      var sp = SPECIAL[d.key];
      if (sp && window[sp[0]]) {
        return '<button class="dcard" type="button" data-special="' + esc(d.key) + '">' + icon + '<span class="dt"><b>' + esc(d.name) +
          '</b><span class="dm">' + esc(sp[1]) + '</span></span>' + I('chevron', 'go') + '</button>';
      }
      if (d.kind === 'special') {
        return '<button class="dcard" type="button" disabled>' + icon + '<span class="dt"><b>' + esc(d.name) + '</b><span class="dm">Coming soon</span></span></button>';
      }
      var n = counts[d.key] || { published: 0, draft: 0, unpublished: 0, archived: 0 };
      var parts = [];
      if (n.published) parts.push(n.published + ' published');
      if (n.draft + n.unpublished) parts.push((n.draft + n.unpublished) + (n.draft + n.unpublished === 1 ? ' draft' : ' drafts'));
      return '<button class="dcard" type="button" data-open="' + esc(d.key) + '">' + icon + '<span class="dt"><b>' + esc(d.name) +
        '</b><span class="dm">' + esc(parts.length ? parts.join(' · ') : 'Nothing yet') + '</span></span>' + I('chevron', 'go') + '</button>';
    }).join('');
  }

  function openSpecial(key) {
    var sp = SPECIAL[key];
    if (!sp || !window[sp[0]]) return;
    cs.view = 'special';
    cs.special = key;
    $('#cm-home').hidden = true;
    $('#cm-browser').hidden = true;
    var box = $('#cm-special');
    box.hidden = false;
    window[sp[0]].open(box, { back: function () { cs.special = ''; showHome(); } });
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
      (it.kind === 'link' ? I('link') : esc(app.extOf(it.title))) + '</span>' +
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

  /* ---------- opening a file or a link ---------- */
  async function preview(it) {
    if (it.kind === 'link') {
      if (/^https?:\/\//i.test(it.external_url || '')) window.open(it.external_url, '_blank', 'noopener');
      else toast('That link is not a web address.', 'bad');
      return;
    }
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
  $('#cm-depts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dept]');
    if (!b) return;
    cs.dept = b.dataset.dept;
    showHome();
  });
  $('#cm-cards').addEventListener('click', function (e) {
    var s = e.target.closest('[data-special]');
    if (s) { openSpecial(s.dataset.special); return; }
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
