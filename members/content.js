/*
  SINAGLIKHA Content Manager.
  One folder-style browser for every deliverable outside the 201 Files. Each file, link and
  folder is a row in public.content_items (see supabase/content_manager.sql); the files
  themselves sit in the private "content" bucket. The database rules decide who can read or
  change what; this page only presents it. It shares the sign-in, dialogs and toasts of
  members.js through window.MembersApp.
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var BUCKET = 'content';
  /* Only the file types the deliverables expect. There is no virus scanning, so nothing else goes in. */
  var ALLOWED = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|txt|csv)$/i;
  var STATUS = { draft: 'Draft', published: 'Published', unpublished: 'Unpublished', archived: 'Archived' };
  var AUDIENCE = { managers: 'Managers only', employees: 'Employees', public: 'Public' };
  /* Publishing these keeps them for managers only until someone picks another audience. */
  var MANAGEMENT_DEFAULT = ['risk_plan'];
  var DEPT_ORDER = ['staffing', 'training', 'engagement', 'rewards', 'legal'];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var ICON_FOLDER = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

  var cs = { ready: false, loading: null, deliverables: [], key: '', path: [], items: [], q: '', token: 0, timer: null, failed: false };

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

  /* ---------- the deliverable picker ---------- */
  async function loadDeliverables() {
    var res = await sb.from('deliverables').select('key,name,department,kind,allow_public').order('name');
    if (res.error || !res.data || !res.data.length) {
      cs.failed = true;
      cs.deliverables = [];
      return false;
    }
    cs.failed = false;
    cs.deliverables = res.data;
    var html = '';
    DEPT_ORDER.forEach(function (dep) {
      var list = cs.deliverables.filter(function (d) { return d.department === dep; });
      if (!list.length) return;
      html += '<optgroup label="' + esc(app.depts[dep] || dep) + '">' + list.map(function (d) {
        var special = d.kind === 'special';
        return '<option value="' + esc(d.key) + '"' + (special ? ' disabled' : '') + '>' + esc(d.name) + (special ? ' (own screen, coming soon)' : '') + '</option>';
      }).join('') + '</optgroup>';
    });
    $('#cm-deliv').innerHTML = html;
    var usable = cs.deliverables.filter(function (d) { return d.kind !== 'special'; });
    var mine = usable.filter(function (d) { return d.department === (state.profile && state.profile.department); })[0];
    cs.key = (mine || usable[0] || {}).key || '';
    $('#cm-deliv').value = cs.key;
    return !!cs.key;
  }

  /* ---------- loading and drawing the list ---------- */
  async function load() {
    if (!cs.key) { render(); return; }
    var token = ++cs.token;
    busy('Loading…');
    var term = cs.q.trim().replace(/[\\%_]/g, '');
    var q = sb.from('content_items').select('*').eq('deliverable', cs.key);
    q = term ? q.ilike('title', '%' + term + '%') : q.eq('folder_path', folderPath());
    var res = await q.order('title', { ascending: true }).limit(500);
    if (token !== cs.token) return;
    busy('');
    if (res.error) {
      toast("Couldn't load this deliverable. " + (res.error.message || ''), 'bad');
      cs.items = [];
    } else {
      cs.items = res.data || [];
    }
    render();
    summarize();
  }

  async function summarize() {
    var key = cs.key;
    var res = await sb.from('content_items').select('status').eq('deliverable', key).neq('kind', 'folder').limit(5000);
    if (key !== cs.key) return;
    var el = $('#cm-sum');
    if (res.error) { el.textContent = ''; return; }
    var n = { draft: 0, published: 0, unpublished: 0, archived: 0 };
    (res.data || []).forEach(function (r) { if (n[r.status] !== undefined) n[r.status]++; });
    var parts = Object.keys(n).filter(function (k) { return n[k]; }).map(function (k) { return n[k] + ' ' + STATUS[k].toLowerCase(); });
    el.textContent = parts.length ? parts.join(' · ') : 'No items yet';
  }

  function renderCrumbs() {
    var d = deliverable(cs.key);
    var html = '<button type="button" data-go="0"' + (cs.path.length || cs.q.trim() ? '' : ' aria-current="true"') + '>' + esc(d ? d.name : 'Content') + '</button>';
    cs.path.forEach(function (seg, i) {
      var last = i === cs.path.length - 1 && !cs.q.trim();
      html += '<span class="sep" aria-hidden="true">/</span><button type="button" data-go="' + (i + 1) + '"' + (last ? ' aria-current="true"' : '') + '>' + esc(seg) + '</button>';
    });
    $('#cm-crumbs').innerHTML = html;
  }

  function rowHtml(it) {
    var n = esc(it.title);
    var searching = !!cs.q.trim();
    if (it.kind === 'folder') {
      return '<li class="row cm-row" data-id="' + esc(it.id) + '">' +
        '<button class="row-main" type="button" data-act="open"><span class="ico folder">' + ICON_FOLDER + '</span>' +
        '<span class="row-text"><span class="row-name">' + n + '</span><span class="row-meta">Folder' + (searching && it.folder_path ? ' in ' + esc(it.folder_path) : '') + '</span></span></button>' +
        '<div class="cm-side"><div class="cm-acts"><button class="btn btn-ghost" type="button" data-act="delete">Delete</button></div></div></li>';
    }
    var meta = [];
    if (it.kind === 'file' && it.extra && it.extra.size) meta.push(app.fmtSize(it.extra.size));
    if (it.kind === 'link') meta.push('Link');
    meta.push(app.fmtDate(it.updated_at));
    if (it.version) meta.push('Version ' + it.version);
    if (searching && it.folder_path) meta.push('in ' + it.folder_path);
    var s = it.status;
    var acts = '<button class="btn btn-ghost" type="button" data-act="edit">Edit</button>';
    if (s === 'draft') acts += '<button class="btn btn-primary" type="button" data-act="publish">Publish</button><button class="btn btn-ghost" type="button" data-act="delete">Delete</button>';
    else if (s === 'published') acts += '<button class="btn btn-ghost" type="button" data-act="unpublish">Unpublish</button><button class="btn btn-ghost" type="button" data-act="archive">Archive</button>';
    else if (s === 'unpublished') acts += '<button class="btn btn-primary" type="button" data-act="publish">Publish</button><button class="btn btn-ghost" type="button" data-act="archive">Archive</button>';
    else acts += '<button class="btn btn-ghost" type="button" data-act="restore">Restore</button><button class="btn btn-ghost" type="button" data-act="delete">Delete</button>';
    return '<li class="row cm-row" data-id="' + esc(it.id) + '">' +
      '<button class="row-main" type="button" data-act="preview" title="' + (it.kind === 'link' ? 'Open the link' : 'Open in a new tab') + '"><span class="ico">' + esc(it.kind === 'link' ? 'LINK' : app.extOf(it.title)) + '</span>' +
      '<span class="row-text"><span class="row-name">' + n + '</span><span class="row-meta">' + esc(meta.filter(Boolean).join(' · ')) + '</span></span></button>' +
      '<div class="cm-side"><span class="chip s-' + esc(s) + '">' + esc(STATUS[s] || s) + '</span>' +
      '<span class="chip a-' + esc(it.audience) + '">' + esc(AUDIENCE[it.audience] || it.audience) + '</span>' +
      '<div class="cm-acts">' + acts + '</div></div></li>';
  }

  function render() {
    renderCrumbs();
    $('#cm-back').hidden = !cs.path.length;
    var fs = $('#cm-status').value, fa = $('#cm-aud').value;
    var items = cs.items.filter(function (it) {
      if (it.kind === 'folder') return !fs && !fa;
      return (!fs || it.status === fs) && (!fa || it.audience === fa);
    }).sort(function (a, b) {
      if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    });
    $('#cm-rows').innerHTML = items.map(rowHtml).join('');
    var empty = $('#cm-empty');
    if (cs.failed) {
      empty.textContent = "The Content Manager isn't set up in the database yet. Run supabase/content_manager.sql in the Supabase SQL editor.";
      empty.hidden = false;
    } else if (!cs.items.length) {
      empty.textContent = cs.q.trim() ? 'Nothing in this deliverable matches "' + cs.q.trim() + '".' : 'This folder is empty. Upload files, add a link, or drag files here.';
      empty.hidden = false;
    } else if (!items.length) {
      empty.textContent = 'Nothing here matches the filters.';
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
    var special = !cs.key;
    ['#cm-folder', '#cm-link', '#cm-upload'].forEach(function (id) { $(id).disabled = special; });
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
      return '<option value="' + k + '"' + (k === 'public' && !(d && d.allow_public) ? ' disabled' : '') + '>' + AUDIENCE[k] + (k === 'public' && !(d && d.allow_public) ? ' (not for this deliverable)' : '') + '</option>';
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
  $('#cm-deliv').addEventListener('change', function () {
    cs.key = this.value;
    cs.path = [];
    cs.q = '';
    $('#cm-search').value = '';
    load();
  });
  $('#cm-status').addEventListener('change', render);
  $('#cm-aud').addEventListener('change', render);
  $('#cm-search').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(cs.timer);
    cs.timer = setTimeout(function () { cs.q = v; load(); }, 250);
  });
  $('#cm-crumbs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (!b || b.getAttribute('aria-current')) return;
    cs.path = cs.path.slice(0, Number(b.dataset.go));
    cs.q = '';
    $('#cm-search').value = '';
    load();
  });
  $('#cm-back').addEventListener('click', function () {
    if (!cs.path.length) return;
    cs.path.pop();
    cs.q = '';
    $('#cm-search').value = '';
    load();
  });
  $('#cm-rows').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    var li = e.target.closest('li.row');
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
      await load();
    },
    /* called when someone signs out, so the next person starts clean */
    reset: function () {
      cs.ready = false; cs.loading = null; cs.key = ''; cs.path = []; cs.items = []; cs.q = '';
      $('#cm-search').value = '';
      $('#cm-rows').innerHTML = '';
      $('#cm-sum').textContent = '';
    }
  };
})();
