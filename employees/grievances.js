/*
  Grievances (Employee Portal, My Work). An employee raises a grievance with Legal Compliance, follows it, and replies.
  Everything is kept on the server (api/_grievance.js, reached through /api/employee-evaluate?gr=1). The panel stays
  hidden until supabase/grievances.sql has been run.
    Confidential  stored with the employee; only Legal Compliance can reveal who, and every reveal is logged.
    Anonymous     no employee is stored; the ticket number and the access code are the only way back in.
  Text is always shown as plain text, never as HTML.
*/
(function () {
  'use strict';
  var panel = document.getElementById('grv-panel'), body = document.getElementById('grv-body');
  var G = window.SngGrievance;
  if (!panel || !body || !G) return;

  var S = { available: false, mine: [], view: 'list', cur: null, access: null, done: null, error: '', loading: false, files: [], uploading: '' };
  var toastTimer;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function icon(name) { return window.SngIcon ? window.SngIcon(name) : ''; }
  function when(iso) { return window.SngCommentTime ? window.SngCommentTime.stamp(iso) : ''; }
  function dateOnly(d) {
    if (!d) return '';
    var t = new Date(d + 'T00:00:00Z');
    return isNaN(t) ? '' : t.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  }
  function today() {   // the Philippine date, for the "not in the future" limit on the date field
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 4200);
  }
  async function api(method, query, data) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (data) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(data); }
    var r;
    try { r = await fetch('/api/employee-evaluate?gr=1' + (query || ''), opts); }
    catch (e) { return { ok: false, status: 0, data: { error: "Couldn't reach the server. Check your connection and try again." } }; }
    var json = {};
    try { json = await r.json(); } catch (e) { json = {}; }
    return { ok: r.ok, status: r.status, data: json };
  }
  function chip(status) { return '<span class="gv-chip gv-' + G.statusTone(status) + '">' + esc(G.statusLabel(status)) + '</span>'; }
  function err() { return S.error ? '<p class="msg bad" role="alert">' + esc(S.error) + '</p>' : ''; }

  /* ---------- the screens ---------- */
  function sec(title, html) { return '<section class="gv-sec"><h4 class="gv-h">' + esc(title) + '</h4>' + html + '</section>'; }
  function back(label) { return '<button class="gv-back" type="button" data-gv="list">' + icon('back') + esc(label || 'Back') + '</button>'; }

  function listView() {
    var rows = S.mine.length ? '<ul class="gv-list">' + S.mine.map(function (g) {
      return '<li><button class="gv-row" type="button" data-gv-open="' + esc(g.id) + '"><span class="gv-t"><b>' + esc(g.ticket_no) + '</b> &middot; ' + esc(g.subject) + '</span>' +
        '<span class="gv-m">' + esc(G.categoryLabel(g.category)) + ' &middot; ' + esc(when(g.created_at)) + '</span>' + chip(g.status) + '</button></li>';
    }).join('') + '</ul>' : '<div class="gv-none">You have not raised any.</div>';
    return '<p class="gv-lead">Raise a concern privately with Legal Compliance.</p>' +
      '<div class="gv-actions"><button class="btn btn-primary btn-sm" type="button" data-gv="new">' + icon('plus') + 'Raise a grievance</button>' +
      '<button class="gv-link" type="button" data-gv="find">Check an anonymous one</button></div>' + sec('My grievances', rows);
  }

  function newView() {
    var cats = G.CATEGORIES.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>'; }).join('');
    return back() + err() + '<form class="gv-form" id="gv-form" novalidate>' +
      sec('What happened',
        '<label class="gv-l" for="gv-cat">Topic</label><select id="gv-cat"><option value="">Choose one</option>' + cats + '</select>' +
        '<label class="gv-l" for="gv-sub">Title</label><input id="gv-sub" type="text" maxlength="' + G.LIMITS.subject + '" autocomplete="off">' +
        '<label class="gv-l" for="gv-body">Details</label><textarea id="gv-body" maxlength="' + G.LIMITS.body + '" placeholder="What happened?"></textarea>' +
        '<details class="gv-more"><summary>When, where and who <span class="gv-opt">(optional)</span></summary>' +
        '<label class="gv-l" for="gv-date">When</label><input id="gv-date" type="date" max="' + today() + '">' +
        '<label class="gv-l" for="gv-loc">Where</label><input id="gv-loc" type="text" maxlength="' + G.LIMITS.location + '" autocomplete="off">' +
        '<label class="gv-l" for="gv-inv">Who was involved</label><input id="gv-inv" type="text" maxlength="' + G.LIMITS.involved + '" autocomplete="off"></details>') +
      sec('Who can see it',
        '<label class="gv-l" for="gv-involves">Does it involve Legal Compliance or the Administrator?</label><select id="gv-involves">' +
        G.INVOLVES.map(function (o) { return '<option value="' + esc(o.key) + '">' + esc(o.label) + '</option>'; }).join('') + '</select>' +
        '<p class="gv-fine">If yes, it skips the person it is about.</p>' +
        '<div class="gv-choices" role="radiogroup" aria-label="Your name">' +
        '<label class="gv-choice"><input type="radio" name="gv-who" value="confidential" checked><b>Confidential</b><span>Only Legal Compliance can see your name.</span></label>' +
        '<label class="gv-choice"><input type="radio" name="gv-who" value="anonymous"><b>Anonymous</b><span>No name is recorded. You get a ticket number and access code to follow it.</span></label></div>') +
      sec('Files (optional)', fileBox('gv-files')) +
      '<div class="gv-foot"><button class="btn btn-primary" type="submit" id="gv-send">Send grievance</button><button class="btn btn-ghost" type="button" data-gv="list">Cancel</button></div></form>';
  }

  /* the file picker, shared by the form and by an open case */
  function fileBox(id) {
    var accept = Object.keys(G.FILES.types).join(',');
    return '<input class="sr-only" type="file" id="' + id + '" multiple accept="' + esc(accept) + '">' +
      '<label class="btn btn-ghost btn-sm" for="' + id + '">' + icon('upload') + 'Choose files</label>' +
      '<ul class="gv-files" id="' + id + '-list" aria-live="polite"></ul><p class="msg bad" id="' + id + '-err" role="alert" hidden></p>' +
      '<p class="gv-fine">Up to ' + G.FILES.max + ' files, 10 MB each (PDF, image, TXT or DOCX). Files can hide details such as an author\'s name, so check them if you send anonymously.</p>';
  }
  function fileRows() {
    return S.files.map(function (f, i) {
      return '<li><span class="gv-fn">' + esc(f.name) + '</span><span class="gv-fs">' + esc(G.fileSize(f.size)) + '</span><button class="gv-copy" type="button" data-rmfile="' + i + '" aria-label="Remove ' + esc(f.name) + '">Remove</button></li>';
    }).join('');
  }
  function showFiles(listId) { var el = document.getElementById(listId + '-list'); if (el) el.innerHTML = fileRows(); }
  function fileError(listId, msg) { var el = document.getElementById(listId + '-err'); if (!el) return; el.textContent = msg || ''; el.hidden = !msg; }
  function pickFiles(input, already) {
    var errs = [];
    Array.prototype.forEach.call(input.files, function (f) {
      var mime = G.mimeFor(f);
      if (S.files.length + already >= G.FILES.max) { errs.push('You can attach up to ' + G.FILES.max + ' files.'); return; }
      if (!G.fileExt(mime)) { errs.push(f.name + ': that kind of file is not allowed.'); return; }
      if (f.size < 1 || f.size > G.FILES.maxBytes) { errs.push(f.name + ': each file must be 10 MB or smaller.'); return; }
      S.files.push({ file: f, name: f.name, size: f.size, mime: mime });
    });
    input.value = '';
    showFiles(input.id);
    fileError(input.id, errs.filter(function (e, i) { return errs.indexOf(e) === i; }).join(' '));
  }
  /* sends the chosen files one at a time: reserve a place, upload straight to storage, then confirm it arrived */
  async function uploadAll(access, label) {
    var failed = [], total = S.files.length;
    for (var i = 0; i < total; i++) {
      var f = S.files[i], ok = false;
      S.uploading = 'Uploading file ' + (i + 1) + ' of ' + total + '…';
      if (label) label.textContent = S.uploading;
      var r = await api('POST', '', Object.assign({ action: 'file_url', name: f.name, size: f.size, mime: f.mime }, access));
      if (r.ok && r.data.upload_url) {
        try {
          var fd = new FormData();
          fd.append('cacheControl', '3600');
          fd.append('', f.file);
          var up = await fetch(r.data.upload_url, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } });
          if (up.ok) { var d = await api('POST', '', Object.assign({ action: 'file_done', file_id: r.data.file_id }, access)); ok = d.ok; }
        } catch (e) { ok = false; }
      }
      if (!ok) failed.push(f.name);
    }
    S.files = []; S.uploading = '';
    return { total: total, failed: failed };
  }
  function doneView() {
    var d = S.done, anon = !!d.access_code;
    var up = d.upload && d.upload.total ? '<p class="' + (d.upload.failed.length ? 'gv-warn' : 'gv-lead') + '">' + (d.upload.failed.length
      ? 'These files did not upload: ' + esc(d.upload.failed.join(', ')) + '. Your grievance was saved. Open it to add them again.'
      : (d.upload.total === 1 ? 'Your file was attached.' : 'Your ' + d.upload.total + ' files were attached.')) + '</p>' : '';
    var box = function (id, label, val) { return '<div class="gv-keys"><span class="gv-kl">' + label + '</span><div class="gv-ticket"><span id="' + id + '">' + esc(val) + '</span><button class="gv-copy" type="button" data-copy="' + esc(val) + '">Copy</button></div></div>'; };
    return '<div class="gv-done"><h3>Grievance sent</h3><p class="gv-lead">Quote the ticket number if you contact Legal Compliance.</p>' +
      box('gv-tn', 'Ticket number', d.ticket_no) + (anon ? box('gv-ac', 'Access code', d.access_code) : '') + up +
      (anon ? '<p class="gv-warn"><b>Save both now.</b> You need them to see replies, and they cannot be recovered.</p>' : '<p class="gv-lead">Follow it here under My Work.</p>') +
      '<div class="gv-foot" style="justify-content:center"><button class="btn btn-primary btn-sm" type="button" data-gv="' + (anon ? 'find' : 'list') + '">' + (anon ? 'Check an anonymous one' : 'My grievances') + '</button>' +
      (anon ? '<button class="btn btn-ghost btn-sm" type="button" data-gv="list">Done</button>' : '') + '</div></div>';
  }

  function findView() {
    return back() + err() + '<p class="gv-lead">Enter the ticket number and access code you were given.</p>' +
      '<form class="gv-find" id="gv-find" novalidate><input id="gv-ft" type="text" placeholder="Ticket number, e.g. GRV-2026-0001" autocomplete="off" aria-label="Ticket number">' +
      '<input id="gv-fc" type="text" placeholder="Access code, e.g. ABCD-2345" autocomplete="off" aria-label="Access code">' +
      '<div class="gv-foot" style="margin-top:4px"><button class="btn btn-primary btn-sm" type="submit" id="gv-fgo">Open</button></div></form>';
  }

  function caseView() {
    var c = S.cur.case, m = S.cur.messages, files = S.cur.files || [], closed = c.status === 'closed';
    var facts = [['Topic', G.categoryLabel(c.category)], ['Sent', when(c.created_at)], ['Date', dateOnly(c.incident_date)], ['Place', c.location], ['Involved', c.involved],
      ['Privacy', c.confidentiality === 'anonymous' ? 'Anonymous' : 'Confidential']].filter(function (f) { return f[1]; });
    return back() + err() +
      '<div class="gv-head"><h3>' + esc(c.subject) + '</h3>' + chip(c.status) + '</div><div class="gv-tn">' + esc(c.ticket_no) + '</div>' +
      (c.outcome ? '<div class="gv-outcome"><b>Outcome</b>' + esc(c.outcome) + '</div>' : '') +
      sec('Details', '<dl class="gv-facts">' + facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + '</dl><p class="gv-text">' + esc(c.body) + '</p>') +
      (files.length ? sec('Files', '<ul class="gv-files gv-attached" aria-label="Files you attached">' + files.map(function (f) {
        return '<li><span class="gv-fn">' + icon('file') + esc(f.name) + '</span><span class="gv-fs">' + esc(G.fileSize(f.size)) + '</span></li>';
      }).join('') + '</ul>') : '') +
      sec('Messages', '<div class="gv-thread" aria-live="polite">' + (m.length ? m.map(function (x) {
        return '<div class="gv-msg ' + (x.from === 'you' ? 'you' : 'legal') + '"><span class="gv-who">' + (x.from === 'you' ? 'You' : 'Legal Compliance') + '</span>' + esc(x.body) + '<small>' + esc(when(x.created_at)) + '</small></div>';
      }).join('') : '<p class="gv-fine">No replies yet.</p>') + '</div>' +
        (closed ? '<p class="gv-fine">This grievance is closed.</p>'
          : '<form class="gv-reply" id="gv-reply" novalidate><label class="sr-only" for="gv-rb">Your message</label><textarea id="gv-rb" maxlength="' + G.LIMITS.message + '" rows="1" placeholder="Add a message…"></textarea>' +
            '<button class="btn btn-primary btn-sm" type="submit" id="gv-rs">Send</button></form>')) +
      (closed || files.length >= G.FILES.max ? '' : '<details class="gv-more gv-attach"><summary>Attach files</summary><div class="gv-add">' + fileBox('gv-more') +
        '<button class="btn btn-ghost btn-sm" type="button" data-gv="attach" id="gv-attach">Attach these files</button></div></details>') +
      '<div class="gv-foot"><button class="btn btn-ghost btn-sm" type="button" data-gv="refresh">Refresh</button></div>';
  }

  function render() {
    var v = S.view;
    body.innerHTML = v === 'new' ? newView() : v === 'done' ? doneView() : v === 'find' ? findView() : v === 'case' ? caseView() : listView();
    var f;
    if (v === 'new' && (f = document.getElementById('gv-cat'))) f.focus();
    if (v === 'find' && (f = document.getElementById('gv-ft'))) f.focus();
  }
  function go(view, keepError) { S.view = view; if (!keepError) S.error = ''; if (view !== 'new' && view !== 'case') S.files = []; render(); panel.scrollIntoView({ block: 'nearest' }); }

  /* ---------- actions ---------- */
  async function load() {
    if (S.loading) return;
    S.loading = true;
    var r = await api('GET', '');
    S.loading = false;
    if (!r.ok || !r.data || !r.data.available) { S.available = false; panel.hidden = true; return; }
    S.available = true;
    S.mine = r.data.mine || [];
    panel.hidden = false;
    if (S.view === 'list') render();
  }
  async function openCase(id) {
    var r = await api('GET', '&id=' + encodeURIComponent(id));
    if (!r.ok) { S.error = r.data.error || "Couldn't open that grievance."; return go('list', true); }
    S.cur = r.data; S.access = { id: id };
    go('case');
  }
  async function reloadCase() {
    var a = S.access || {};
    var r = await api('GET', a.id ? '&id=' + encodeURIComponent(a.id) : '&ticket=' + encodeURIComponent(a.ticket) + '&code=' + encodeURIComponent(a.code));
    if (!r.ok) { S.error = r.data.error || "Couldn't refresh."; return go('case', true); }
    S.cur = r.data; render();
  }
  async function submitNew(e) {
    e.preventDefault();
    var v = function (id) { return document.getElementById(id).value; };
    var who = document.querySelector('input[name="gv-who"]:checked');
    var form = { action: 'submit', category: v('gv-cat'), subject: v('gv-sub').trim(), body: v('gv-body').trim(), incident_date: v('gv-date'), location: v('gv-loc').trim(), involved: v('gv-inv').trim(), anonymous: !!(who && who.value === 'anonymous'), involves: v('gv-involves') };
    var bad = !G.validCategory(form.category) ? 'Choose what it is about.' : !form.subject ? 'Give your grievance a short title.' : !form.body ? 'Describe what happened.' : '';
    if (bad) { S.error = bad; return keepForm(form); }
    var btn = document.getElementById('gv-send');
    btn.disabled = true;
    var r = await api('POST', '', form);
    if (!r.ok) { btn.disabled = false; S.error = r.data.error || "Couldn't send that. Try again."; return keepForm(form); }
    S.done = r.data; S.error = '';
    // the grievance is saved; now any files, using the ticket and code (anonymous) or the case id (confidential)
    if (S.files.length) S.done.upload = await uploadAll(r.data.access_code ? { ticket: r.data.ticket_no, code: r.data.access_code } : { id: r.data.id }, btn);
    btn.disabled = false;
    if (!form.anonymous) { var l = await api('GET', ''); if (l.ok && l.data.available) S.mine = l.data.mine || []; }
    go('done');
  }
  function keepForm(f) {   // show the error and put back what was typed
    render();
    var set = function (id, val) { var el = document.getElementById(id); if (el) el.value = val; };
    set('gv-involves', f.involves); showFiles('gv-files');
    set('gv-cat', f.category); set('gv-sub', f.subject); set('gv-body', f.body); set('gv-date', f.incident_date); set('gv-loc', f.location); set('gv-inv', f.involved);
    var r = document.querySelector('input[name="gv-who"][value="' + (f.anonymous ? 'anonymous' : 'confidential') + '"]');
    if (r) r.checked = true;
  }
  async function submitFind(e) {
    e.preventDefault();
    var ticket = G.normalizeTicket(document.getElementById('gv-ft').value), code = document.getElementById('gv-fc').value.trim();
    if (!ticket || !code) { S.error = 'Enter both the ticket number and the access code.'; return go('find', true); }
    var r = await api('GET', '&ticket=' + encodeURIComponent(ticket) + '&code=' + encodeURIComponent(code));
    if (!r.ok) { S.error = r.data.error || "Couldn't open that grievance."; return go('find', true); }
    S.cur = r.data; S.access = { ticket: ticket, code: code };
    go('case');
  }
  async function submitReply(e) {
    e.preventDefault();
    var ta = document.getElementById('gv-rb'), text = ta.value.trim();
    if (!text) return;
    var a = S.access || {}, btn = document.getElementById('gv-rs');
    btn.disabled = true;
    var r = await api('POST', '', Object.assign({ action: 'reply', body: text }, a.id ? { id: a.id } : { ticket: a.ticket, code: a.code }));
    btn.disabled = false;
    if (!r.ok) { S.error = r.data.error || "Couldn't send that."; return go('case', true); }
    toast('Message sent.');
    await reloadCase();
  }
  async function attachMore() {
    if (!S.files.length) { fileError('gv-more', 'Choose a file first.'); return; }
    var btn = document.getElementById('gv-attach'), a = S.access || {};
    btn.disabled = true;
    var res = await uploadAll(a.id ? { id: a.id } : { ticket: a.ticket, code: a.code }, btn);
    btn.disabled = false;
    toast(res.failed.length ? 'Did not upload: ' + res.failed.join(', ') : res.total === 1 ? 'File attached.' : res.total + ' files attached.');
    await reloadCase();
  }
  function copy(text, btn) {
    var done = function () { var old = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = old; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast('Press and hold to copy.'); });
    else toast('Press and hold to copy.');
  }

  body.addEventListener('click', function (e) {
    var t = e.target.closest('[data-gv],[data-gv-open],[data-copy],[data-rmfile]');
    if (!t) return;
    if (t.hasAttribute('data-rmfile')) { S.files.splice(Number(t.getAttribute('data-rmfile')), 1); showFiles(S.view === 'new' ? 'gv-files' : 'gv-more'); return; }
    if (t.hasAttribute('data-copy')) return copy(t.getAttribute('data-copy'), t);
    if (t.hasAttribute('data-gv-open')) return openCase(t.getAttribute('data-gv-open'));
    var a = t.getAttribute('data-gv');
    if (a === 'refresh') return reloadCase();
    if (a === 'attach') return attachMore();
    if (a === 'list') { load(); return go('list'); }
    go(a);
  });
  body.addEventListener('change', function (e) {
    if (e.target.id === 'gv-files') pickFiles(e.target, 0);
    else if (e.target.id === 'gv-more') pickFiles(e.target, (S.cur && S.cur.files || []).length);
  });
  body.addEventListener('submit', function (e) {
    if (e.target.id === 'gv-form') submitNew(e);
    else if (e.target.id === 'gv-find') submitFind(e);
    else if (e.target.id === 'gv-reply') submitReply(e);
  });

  /* The panel follows the sign-in: shown (once the SQL is in) when someone is signed in, emptied when they sign out. */
  var top = document.getElementById('top-right');
  function sync() {
    if (top && !top.hidden) load();
    else { S = { available: false, mine: [], view: 'list', cur: null, access: null, done: null, error: '', loading: false, files: [], uploading: '' }; panel.hidden = true; body.innerHTML = ''; }
  }
  if (top && window.MutationObserver) new MutationObserver(sync).observe(top, { attributes: true, attributeFilter: ['hidden'] });
  sync();
})();
