/*
  SINAGLIKHA Employee Portal.
  Employees sign in with an Employee ID and a 6-digit PIN they chose themselves. This page only
  talks to the /api/employee-* functions; the PIN is never stored in the browser, and the
  signed-in state is a server cookie this script can't read.
*/
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var VIEWS = ['loading', 'signin', 'activate', 'home', 'dept', 'pin'];
  var DEPTS = [
    ['staffing', 'Staffing and Recruitment'], ['training', 'Training and Development'], ['engagement', 'Employee Engagement'],
    ['rewards', 'Total Rewards'], ['legal', 'Legal Compliance']
  ];
  var content = { deliverables: [], items: [] };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };

  $('#year').textContent = new Date().getFullYear();

  function show(name) {
    VIEWS.forEach(function (v) { $('#v-' + v).hidden = v !== name; });
    $('#btn-out').hidden = !(name === 'home' || name === 'dept' || name === 'pin');
    var first = { signin: '#s-no', activate: '#a-no', pin: '#p-cur' }[name];
    if (first) $(first).focus();
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

  function enter(employee) {
    var name = employee.full_name || '';
    var w = name.trim().split(/\s+/).filter(Boolean);
    $('#h-av').textContent = ((w[0] ? Array.from(w[0])[0] : '?') + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
    $('#h-name').textContent = name;
    $('#h-pos').textContent = [employee.position, employee.employee_no].filter(Boolean).join(' · ');
    ['#f-signin', '#f-activate', '#f-pin'].forEach(function (f) { $(f).reset(); });
    $('#q').value = '';
    note('#h-err', '');
    show('home');
    loadContent();
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
    return '<li class="item"><div><b>' + esc(it.title) + '</b><span class="meta">' + esc(meta.join(' · ')) + '</span>' +
      (it.description ? '<p class="desc">' + esc(it.description.length > 220 ? it.description.slice(0, 220) + '…' : it.description) + '</p>' : '') +
      '</div><button class="btn btn-ghost btn-sm" type="button" data-open="' + esc(it.id) + '">Open</button></li>';
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
      return '<button class="tile" type="button" data-dept="' + d[0] + '"><b>' + esc(d[1]) + '</b><span>' +
        (n ? n + (n === 1 ? ' item' : ' items') + ' published' : 'Nothing published yet') + '</span></button>';
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
      html += '<div class="panel dept-sec"><h2>' + esc(d.name) + '</h2><ul class="items">' + listHtml(items, 'Nothing published yet.', false) + '</ul></div>';
    });
    $('#dept-body').innerHTML = html || '<p class="none">Nothing published yet.</p>';
    show('dept');
    window.scrollTo(0, 0);
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
      return '<li class="item"><div><b>' + esc(x.title) + '</b><span class="meta">' + esc([x.period, fmtDate(x.created_at)].filter(Boolean).join(' · ')) +
        '</span></div><button class="btn btn-ghost btn-sm" type="button" data-rec="' + esc(x.id) + '">Open</button></li>';
    }).join('');
  }

  async function openRecord(id) {
    var w = window.open('', '_blank');
    var r = await call('GET', '/api/employee-record-file?id=' + encodeURIComponent(id));
    if (r.status === 401) { if (w) w.close(); show('signin'); return; }
    if (!r.ok || !r.data.url) { if (w) w.close(); toast(r.data.error || "Couldn't open that."); return; }
    if (w) { w.opener = null; w.location.href = r.data.url; } else window.location.href = r.data.url;
  }

  async function openItem(id) {
    var w = window.open('', '_blank');
    var r = await call('GET', '/api/employee-file?id=' + encodeURIComponent(id));
    if (r.status === 401) { if (w) w.close(); show('signin'); return; }
    if (!r.ok || !r.data.url) { if (w) w.close(); toast(r.data.error || "Couldn't open that."); return; }
    if (w) { w.opener = null; w.location.href = r.data.url; } else window.location.href = r.data.url;
  }

  document.addEventListener('click', function (e) {
    var open = e.target.closest('[data-open]'), tile = e.target.closest('[data-dept]'), rec = e.target.closest('[data-rec]');
    if (open) openItem(open.dataset.open);
    else if (rec) openRecord(rec.dataset.rec);
    else if (tile) openDept(tile.dataset.dept);
  });
  $('#q').addEventListener('input', renderSearch);
  $('#dept-back').addEventListener('click', function () { show('home'); });

  function busy(btn, on, label) {
    btn.disabled = on;
    if (label) btn.textContent = on ? 'Please wait…' : label;
  }

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
    busy(btn, true, 'Save PIN and Sign In');
    var res = await call('POST', '/api/employee-activate', { employee_no: no, code: code, pin: pin });
    busy(btn, false, 'Save PIN and Sign In');
    $('#a-pin').value = $('#a-pin2').value = '';
    if (!res.ok) { note('#a-msg', res.data.error || "That didn't work. Ask Staffing and Recruitment for a new code."); return; }
    /* Activating only sets the PIN. The employee signs in with it, so the first sign-in proves they remember it. */
    ['#f-signin', '#f-activate'].forEach(function (f) { $(f).reset(); });
    show('signin');
    $('#s-no').value = no;
    note('#s-msg', 'Your PIN is saved. Now sign in with your Employee ID and your new PIN.', 'ok');
    $('#s-pin').focus();
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
    note('#s-msg', '');
    show('signin');
  }
  $('#btn-out').addEventListener('click', signOut);
  $('#to-activate').addEventListener('click', function () { note('#a-msg', ''); show('activate'); });
  $('#to-signin').addEventListener('click', function () { note('#s-msg', ''); show('signin'); });
  $('#to-pin').addEventListener('click', function () { note('#p-msg', ''); show('pin'); });
  $('#p-back').addEventListener('click', function () { show('home'); });

  (async function boot() {
    var res = await call('GET', '/api/employee-me');
    if (res.ok && res.data.employee) enter(res.data.employee); else show('signin');
  })();
})();
