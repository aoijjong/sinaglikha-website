/*
  SINAGLIKHA Employee Directory (Staffing and Recruitment and the Administrator).
  Adds and imports employees, shows who has signed in and who still needs a code, and issues
  one-time activation codes through /api/employee-code. The codes come back once and can't be
  shown again. PINs are chosen by the employees themselves and nobody can read them.
  Shares the sign-in, dialogs and toasts of members.js through window.MembersApp.
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, esc = app.esc, toast = app.toast, ask = app.ask, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var ID_RE = /^[A-Z]{3}-\d{4}$/;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var em = { rows: [], show: 'current', failed: false, photos: {} };
  // profile photos are small data: images that employees add in the portal; they reach this list through the
  // employee_photos() function (supabase/employee_photos.sql), the same one the Attendance Tracker uses
  var PHOTO_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/;

  function busy(text) {
    var b = $('#em-busy');
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }

  function statusOf(r) {
    var now = Date.now();
    if (!r.active) return ['inactive', 'Inactive'];
    if (r.locked_until && new Date(r.locked_until).getTime() > now) return ['locked', 'Locked'];
    if (r.pin_set) return ['active', 'Active'];
    if (r.code_expires_at) {
      return new Date(r.code_expires_at).getTime() > now ? ['pending', 'Code pending'] : ['expired', 'Code expired'];
    }
    return ['none', 'No code yet'];
  }

  /* ---------- the list ---------- */
  async function load() {
    busy('Loading…');
    var res = await sb.from('employees')
      .select('id,employee_no,full_name,position,active,pin_set,code_expires_at,locked_until,last_login_at,created_at')
      .order('employee_no', { ascending: true }).limit(2000);
    busy('');
    if (res.error) {
      toast("Couldn't load the Employee Directory. " + (res.error.message || ''), 'bad');
      em.rows = [];
      em.failed = true;
    } else {
      em.rows = res.data || [];
      em.failed = false;
    }
    render();
  }

  function initialsOf(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] ? Array.from(w[0])[0] : '?') + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
  }

  function rowHtml(r) {
    var st = statusOf(r);
    var meta = [r.employee_no, r.position].filter(Boolean).join(' · ');
    var last = r.last_login_at ? 'Last sign-in ' + app.fmtDate(r.last_login_at) : '';
    var acts = IB('pencil', 'Edit name and position', { 'data-act': 'edit' });
    if (r.active) {
      acts += IB('key', r.pin_set ? 'Reset PIN: issue a new activation code' : 'Issue an activation code', { 'data-act': 'code' }, r.pin_set ? '' : 'good');
      acts += IB('userX', 'Deactivate', { 'data-act': 'deactivate' }, 'danger');
    } else {
      acts += IB('userCheck', 'Reactivate', { 'data-act': 'reactivate' }, 'good');
    }
    return '<li class="lrow" data-id="' + esc(r.id) + '">' +
      '<div class="lmain"><span class="lico' + (em.photos[r.id] ? ' has-photo' : '') + '">' + (em.photos[r.id] ? '<img src="' + esc(em.photos[r.id]) + '" alt="" loading="lazy">' : esc(initialsOf(r.full_name))) + '</span>' +
      '<span class="ltext"><span class="lname">' + esc(r.full_name) + '</span><span class="lmeta">' + esc(meta) + (last ? ' · ' + esc(last) : '') + '</span></span></div>' +
      '<div class="lside"><span class="chip e-' + st[0] + '">' + esc(st[1]) + '</span><div class="lacts">' + acts + '</div></div></li>';
  }

  function drawPills() {
    var cur = em.rows.filter(function (r) { return r.active; }).length;
    var tabs = [['current', 'Current', cur], ['inactive', 'Inactive', em.rows.length - cur], ['all', 'Everyone', em.rows.length]];
    $('#em-show').innerHTML = tabs.map(function (t) {
      return '<button class="pill" type="button" data-show="' + t[0] + '" aria-pressed="' + (em.show === t[0]) + '">' + t[1] + ' <small>' + t[2] + '</small></button>';
    }).join('');
    var need = em.rows.filter(function (r) { return r.active && !r.pin_set; }).length;
    $('#em-sub').textContent = em.rows.length
      ? cur + ' current' + (need ? ' · ' + need + ' without a PIN yet' : '')
      : 'People who sign in to the Employee Portal with their ID and a PIN.';
  }

  function emptyHtml(icon, title, text) {
    return '<span class="eic">' + I(icon) + '</span><b>' + title + '</b><p>' + text + '</p>';
  }

  function render() {
    drawPills();
    var q = $('#em-search').value.trim().toLowerCase();
    var list = em.rows.filter(function (r) {
      if (em.show === 'current' && !r.active) return false;
      if (em.show === 'inactive' && r.active) return false;
      return !q || r.full_name.toLowerCase().indexOf(q) !== -1 || r.employee_no.toLowerCase().indexOf(q) !== -1;
    });
    $('#em-rows').innerHTML = list.map(rowHtml).join('');
    var empty = $('#em-empty');
    if (em.failed) {
      empty.innerHTML = emptyHtml('inbox', 'Not set up yet', 'Run supabase/employees.sql in the Supabase SQL editor, then reload this page.');
      empty.hidden = false;
    } else if (!em.rows.length) {
      empty.innerHTML = emptyHtml('users', 'No employees yet', 'Tap ' + I('userPlus', 'inline') + ' to add someone, or ' + I('fileUp', 'inline') + ' to import a CSV file with the columns Employee ID, Full Name and Position.');
      empty.hidden = false;
    } else if (!list.length) {
      empty.innerHTML = emptyHtml('search', 'Nobody matches', 'Try another search or filter.');
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }

  /* ---------- activation codes ---------- */
  async function requestCodes(ids) {
    var got = await sb.auth.getSession();
    var token = got.data && got.data.session && got.data.session.access_token;
    if (!token) throw new Error('Please sign in again.');
    var r = await fetch('/api/employee-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ employee_ids: ids })
    });
    var data = {};
    try { data = await r.json(); } catch (e) { data = {}; }
    if (!r.ok) throw new Error(data.error || "Couldn't issue the codes.");
    return data;
  }

  async function issue(list) {
    if (!list.length) { toast('Nobody to issue codes to.', 'bad'); return; }
    var withPin = list.filter(function (r) { return r.pin_set; }).length;
    var ok = await ask({
      title: list.length === 1 ? 'Issue a New Code?' : 'Issue ' + list.length + ' New Codes?',
      text: (withPin
        ? withPin + (withPin === 1 ? ' person already has' : ' people already have') + ' a PIN. A new code removes it, signs them out everywhere and clears any lock. '
        : '') + 'You will see each code once, on a page you can print.',
      ok: 'Issue'
    });
    if (!ok) return;
    busy('Issuing…');
    var codes = [], expires = '';
    try {
      for (var i = 0; i < list.length; i += 100) {
        var data = await requestCodes(list.slice(i, i + 100).map(function (r) { return r.id; }));
        codes = codes.concat(data.codes || []);
        expires = data.expires_at || expires;
      }
    } catch (err) {
      busy('');
      toast(err.message || "Couldn't issue the codes.", 'bad');
      if (codes.length) showSlips(codes, expires);
      await load();
      return;
    }
    busy('');
    showSlips(codes, expires);
    await load();
  }

  function showSlips(codes, expires) {
    var until = expires ? new Date(expires).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    $('#sl-grid').innerHTML = codes.map(function (c) {
      return '<div class="sl-card"><b>EMPLOYEE ID</b><div class="sl-id">' + esc(c.employee_no) + '</div>' +
        '<div class="sl-name">' + esc(c.full_name) + '</div><b>ACTIVATION CODE</b><div class="sl-code">' + esc(c.code) + '</div>' +
        '<div class="sl-exp">Works once. Valid until ' + esc(until) + '.</div></div>';
    }).join('');
    var dlg = $('#slips-dlg');
    if (!dlg.open) dlg.showModal();
  }

  $('#sl-print').addEventListener('click', function () { window.print(); });
  $('#sl-close').addEventListener('click', function () { $('#slips-dlg').close(); });
  $('#slips-dlg').addEventListener('close', function () { $('#sl-grid').innerHTML = ''; });

  /* ---------- add and edit ---------- */
  function openForm(r) {
    var dlg = $('#emp-dlg'), form = $('#emp-form'), err = $('#em-err');
    $('#em-title').textContent = r ? 'Edit Employee' : 'Add Employee';
    $('#em-no').value = r ? r.employee_no : '';
    $('#em-no').readOnly = !!r;
    $('#em-name').value = r ? r.full_name : '';
    $('#em-pos').value = r ? r.position || '' : '';
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var no = $('#em-no').value.trim().toUpperCase();
      var name = $('#em-name').value.trim();
      var pos = $('#em-pos').value.trim();
      var problem = '';
      if (!r && !ID_RE.test(no)) problem = 'The Employee ID looks like SNG-0001: three capital letters, a dash and four digits.';
      else if (!name) problem = 'Enter the full name.';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      $('#em-ok').disabled = true;
      var res;
      if (r) res = await sb.from('employees').update({ full_name: name, position: pos || null }).eq('id', r.id).select('id').maybeSingle();
      else res = await sb.from('employees').insert({ employee_no: no, full_name: name, position: pos || null }).select('id').maybeSingle();
      $('#em-ok').disabled = false;
      if (res.error || !res.data) {
        err.textContent = res.error && /duplicate|unique|23505/i.test(res.error.code + ' ' + res.error.message)
          ? 'That Employee ID already exists.' : "Couldn't save that. You may not have permission.";
        err.hidden = false;
        return;
      }
      dlg.close();
      logAction(r ? 'employee.edit' : 'employee.add', r ? r.employee_no : no);
      toast(r ? 'Saved.' : 'Employee added. Issue a code so they can sign in.', 'ok');
      load();
    };
    $('#em-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    (r ? $('#em-name') : $('#em-no')).focus();
  }

  async function setActive(r, active) {
    if (!active) {
      var ok = await ask({
        title: 'Deactivate This Employee?',
        text: r.full_name + ' (' + r.employee_no + ') will be signed out and can no longer sign in. You can reactivate them later; they will need a new code.',
        ok: 'Deactivate',
        danger: true
      });
      if (!ok) return;
    }
    busy('Saving…');
    var res = await sb.from('employees').update({ active: active }).eq('id', r.id).select('id').maybeSingle();
    busy('');
    if (res.error || !res.data) { toast("Couldn't save that. You may not have permission.", 'bad'); return; }
    logAction(active ? 'employee.reactivate' : 'employee.deactivate', r.employee_no);
    toast(active ? 'Reactivated. Issue a new code so they can sign in.' : 'Deactivated.', 'ok');
    await load();
  }

  /* ---------- CSV import ---------- */
  function parseCsv(text) {
    var rows = [], row = [], cell = '', quoted = false;
    text = String(text).replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
    return rows;
  }

  async function importCsv(file) {
    if (file.size > 1048576) { toast('That file is too large. Keep it under 1 MB.', 'bad'); return; }
    var table = parseCsv(await file.text());
    if (!table.length) { toast('That file has no rows.', 'bad'); return; }
    var col = { no: 0, name: 1, pos: 2 }, head = table[0].map(function (h) { return h.trim().toLowerCase(); });
    var hasHead = head.some(function (h) { return /^(employee[ _-]?(id|no|number)|id|full[ _-]?name|name|position|title)$/.test(h); });
    if (hasHead) {
      table.shift();
      head.forEach(function (h, i) {
        if (/^(employee[ _-]?(id|no|number)|id)$/.test(h)) col.no = i;
        else if (/^(full[ _-]?name|name)$/.test(h)) col.name = i;
        else if (/^(position|title)$/.test(h)) col.pos = i;
      });
    }
    var good = [], seen = {}, skipped = [];
    table.forEach(function (r, i) {
      var no = String(r[col.no] || '').trim().toUpperCase(), name = String(r[col.name] || '').trim().slice(0, 120);
      var pos = String(r[col.pos] || '').trim().slice(0, 120);
      var line = i + (hasHead ? 2 : 1);
      if (!ID_RE.test(no)) skipped.push('row ' + line + ': ID "' + no + '" is not like SNG-0001');
      else if (!name) skipped.push('row ' + line + ': no name');
      else if (seen[no]) skipped.push('row ' + line + ': ' + no + ' appears twice');
      else { seen[no] = 1; good.push({ employee_no: no, full_name: name, position: pos || null }); }
    });
    if (!good.length) { toast('Nothing to import. ' + (skipped[0] || ''), 'bad'); return; }
    var ok = await ask({
      title: 'Import ' + good.length + ' Employee' + (good.length === 1 ? '' : 's') + '?',
      text: (skipped.length ? skipped.length + ' row' + (skipped.length === 1 ? '' : 's') + ' will be skipped (' + skipped.slice(0, 3).join('; ') + (skipped.length > 3 ? '; …' : '') + '). ' : '') +
        'People whose ID already exists are left as they are.',
      ok: 'Import'
    });
    if (!ok) return;
    busy('Importing…');
    var added = 0;
    for (var i = 0; i < good.length; i += 200) {
      var res = await sb.from('employees').upsert(good.slice(i, i + 200), { onConflict: 'employee_no', ignoreDuplicates: true }).select('id');
      if (res.error) { busy(''); toast("Couldn't import. " + (res.error.message || ''), 'bad'); await load(); return; }
      added += (res.data || []).length;
    }
    busy('');
    logAction('employee.import', file.name, { rows: good.length, added: added });
    toast(added + ' added' + (good.length - added ? ', ' + (good.length - added) + ' already existed' : '') + '. Issue codes so they can sign in.', 'ok');
    await load();
  }

  /* ---------- wiring ---------- */
  $('#em-search').addEventListener('input', render);
  $('#em-show').addEventListener('click', function (e) {
    var b = e.target.closest('[data-show]');
    if (b) { em.show = b.dataset.show; render(); }
  });
  $('#em-add').addEventListener('click', function () { openForm(null); });
  $('#em-import').addEventListener('click', function () { $('#em-file').click(); });
  $('#em-file').addEventListener('change', function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (f) importCsv(f);
  });
  $('#em-bulk').addEventListener('click', function () {
    issue(em.rows.filter(function (r) { return r.active && !r.pin_set; }));
  });
  $('#em-rows').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]'), li = e.target.closest('li.lrow');
    if (!btn || !li) return;
    var r = em.rows.filter(function (x) { return x.id === li.dataset.id; })[0];
    if (!r) return;
    if (btn.dataset.act === 'edit') openForm(r);
    else if (btn.dataset.act === 'code') issue([r]);
    else if (btn.dataset.act === 'deactivate') setActive(r, false);
    else if (btn.dataset.act === 'reactivate') setActive(r, true);
  });

  window.MembersEmployees = {
    /* called each time the Employees tab opens */
    open: async function () {
      await load();
      // the list is already on screen; photos arrive a moment later, and initials stay for anyone without one
      var r = await sb.rpc('employee_photos');
      if (r.error || !Array.isArray(r.data)) return;
      r.data.forEach(function (x) { if (x && typeof x.avatar === 'string' && PHOTO_RE.test(x.avatar)) em.photos[x.id] = x.avatar; });
      render();
    },
    /* called when someone signs out, so the next person starts clean */
    reset: function () {
      em.rows = [];
      em.photos = {};
      $('#em-rows').innerHTML = '';
      $('#em-search').value = '';
      $('#sl-grid').innerHTML = '';
      if ($('#slips-dlg').open) $('#slips-dlg').close();
    }
  };
})();
