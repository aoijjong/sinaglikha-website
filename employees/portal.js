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
  var VIEWS = ['loading', 'signin', 'activate', 'home', 'dept', 'profile'];
  var SIGNED_IN = ['home', 'dept', 'profile'];
  var DEPTS = [
    ['staffing', 'Staffing and Recruitment', 'users'], ['training', 'Training and Development', 'book'], ['engagement', 'Employee Engagement', 'chat'],
    ['rewards', 'Total Rewards', 'award'], ['legal', 'Legal Compliance', 'scale']
  ];
  var me = null;
  var content = { deliverables: [], items: [] };
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
    var r = await call('GET', '/api/employee-profile');
    if (r.ok && me) { me.avatar = r.data.avatar || null; paintMe(); }
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
    if (!r.ok) { note('#h-err', r.data.error || "Couldn't load the portal content."); content = { deliverables: [], items: [] }; }
    else { note('#h-err', ''); content = { deliverables: r.data.deliverables || [], items: r.data.items || [] }; }
    renderHome();
    loadRecords();
  }

  /* the employee's own compensation records, if Total Rewards has uploaded any */
  async function loadRecords() {
    var r = await call('GET', '/api/employee-records');
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
    var open = e.target.closest('[data-open]'), tile = e.target.closest('[data-dept]'), rec = e.target.closest('[data-rec]');
    if (open) openUrl('/api/employee-file?id=' + encodeURIComponent(open.dataset.open));
    else if (rec) openUrl('/api/employee-record-file?id=' + encodeURIComponent(rec.dataset.rec));
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
    var r = await call('POST', '/api/employee-profile', { avatar: data });
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
    var res = await call('POST', '/api/employee-pin', { current: cur, next: next });
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
    await call('POST', '/api/employee-logout');
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
