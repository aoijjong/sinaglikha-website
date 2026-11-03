/*
  SINAGLIKHA Attendance Tracker: the review screen for Staffing and Recruitment and the Administrator.
  Employees record their own time in and time out in the Employee Portal (through
  /api/employee-attendance). Here a manager sees one day at a time, corrects a time or adds a missed
  record, and downloads a month as a spreadsheet. The database rules in supabase/phase2.sql decide who
  can read or change records; this screen only shows what those rules allow.
  Statuses, with no schedule to compare against: Complete (in and out), Timed in (today, still
  working), No time out (an earlier day), Not yet in (today) and No record (an earlier day).
  Opened from the Attendance Tracker card in the Content tab (see content.js).
*/
(function () {
  'use strict';

  var app = window.MembersApp;
  if (!app) return;

  var sb = app.sb, state = app.state, esc = app.esc, toast = app.toast, logAction = app.logAction;
  var I = window.SngIcon, IB = window.SngIconButton;
  var TZ = { timeZone: 'Asia/Manila' };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var at = { box: null, ctx: null, date: '', people: [], recs: [], failed: false, token: 0 };

  function canReview() { return state.isAdmin || (state.profile && state.profile.department === 'staffing'); }
  function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function addDays(d, n) {
    var x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  }
  function fmtTime(iso) {
    return iso ? new Date(iso).toLocaleTimeString('en-PH', Object.assign({ hour: 'numeric', minute: '2-digit' }, TZ)) : '';
  }
  function hhmm(iso) {
    return iso ? new Date(iso).toLocaleTimeString('en-GB', Object.assign({ hour: '2-digit', minute: '2-digit', hour12: false }, TZ)) : '';
  }
  function stamp(date, hm) { return new Date(date + 'T' + hm + ':00+08:00').toISOString(); }
  function longDate(d) {
    return new Date(d + 'T00:00:00+08:00').toLocaleDateString('en-PH', Object.assign({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, TZ));
  }
  function hours(r) {
    if (!r || !r.time_in || !r.time_out) return '';
    return (Math.round((new Date(r.time_out) - new Date(r.time_in)) / 360000) / 10).toFixed(1);
  }
  function statusOf(r, date) {
    if (r && r.time_in && r.time_out) return ['complete', 'Complete'];
    if (r && r.time_in) return date === today() ? ['working', 'Timed in'] : ['incomplete', 'No time out'];
    if (date === today()) return ['none', 'Not yet in'];
    return date < today() ? ['none', 'No record'] : ['none', 'Not yet'];
  }
  function initials(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] ? Array.from(w[0])[0] : '?') + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
  }
  function busy(text) {
    var b = $('#ad-busy', at.box);
    if (!b) return;
    b.textContent = text || 'Loading…';
    b.hidden = !text;
  }

  /* ---------- the screen ---------- */
  function shell() {
    at.box.innerHTML =
      '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') +
      '<div class="ph-main"><h2>Attendance Tracker</h2><p class="sub" id="ad-sub"></p></div>' +
      '<div class="ph-actions">' + IB('download', 'Download this month as a spreadsheet', { 'data-a': 'export' }) + '</div></div>' +
      '<div class="sp-controls">' + IB('back', 'Previous day', { 'data-a': 'prev' }, 'line') +
      '<input type="date" id="ad-pick" aria-label="Choose a day">' + IB('chevron', 'Next day', { 'data-a': 'next' }, 'line') +
      '<button class="pill" type="button" data-a="today" aria-pressed="false">Today</button></div>' +
      '<div class="sp-sum" id="ad-sum"></div>' +
      '<div class="list-card"><ul class="rows" id="ad-rows"></ul><div class="es" id="ad-empty" hidden></div><div class="busy" id="ad-busy" hidden role="status">Loading…</div></div>' +
      '<p class="fine">Employees clock themselves. Edits are logged. UTC+8.</p>';
    $('#ad-pick', at.box).value = at.date;
  }

  async function load() {
    var token = ++at.token;
    $('#ad-sub', at.box).textContent = longDate(at.date);
    $('#ad-pick', at.box).value = at.date;
    busy('Loading…');
    var res = await sb.from('attendance_records').select('id,employee_id,work_date,time_in,time_out,note').eq('work_date', at.date).limit(2000);
    if (token !== at.token) return;
    busy('');
    if (res.error) { at.failed = true; at.recs = []; }
    else { at.failed = false; at.recs = res.data || []; }
    render();
  }

  function person(id) { return at.people.filter(function (p) { return p.id === id; })[0] || null; }

  function render() {
    var box = at.box, rows = $('#ad-rows', box), empty = $('#ad-empty', box);
    var list = at.people.filter(function (p) { return p.active || at.recs.some(function (r) { return r.employee_id === p.id; }); })
      .sort(function (a, b) { return a.employee_no.localeCompare(b.employee_no); });
    var counts = { complete: 0, working: 0, incomplete: 0, none: 0 };
    rows.innerHTML = list.map(function (p) {
      var r = at.recs.filter(function (x) { return x.employee_id === p.id; })[0] || null;
      var st = statusOf(r, at.date);
      counts[st[0]]++;
      var meta = [p.employee_no];
      if (r && r.time_in) meta.push(fmtTime(r.time_in) + ' to ' + (r.time_out ? fmtTime(r.time_out) : 'no time out'));
      if (hours(r)) meta.push(hours(r) + ' h');
      if (r && r.note) meta.push('Note: ' + r.note);
      return '<li class="lrow" data-emp="' + esc(p.id) + '">' +
        '<div class="lmain" style="cursor:default"><span class="lico">' + esc(initials(p.full_name)) + '</span>' +
        '<span class="ltext"><span class="lname">' + esc(p.full_name) + '</span><span class="lmeta">' + esc(meta.join(' · ')) + '</span></span></div>' +
        '<div class="lside"><span class="chip t-' + st[0] + '">' + esc(st[1]) + '</span><div class="lacts">' +
        IB('pencil', r ? 'Correct this record' : 'Add a record for this day', { 'data-a': 'edit' }) + '</div></div></li>';
    }).join('');
    $('#ad-sum', box).innerHTML =
      '<span class="chip t-complete">' + counts.complete + ' complete</span>' +
      '<span class="chip t-working">' + counts.working + ' timed in</span>' +
      '<span class="chip t-incomplete">' + counts.incomplete + ' no time out</span>' +
      '<span class="chip t-none">' + counts.none + (at.date === today() ? ' not yet in' : ' no record') + '</span>';
    $('[data-a=today]', box).setAttribute('aria-pressed', String(at.date === today()));
    if (at.failed) {
      empty.innerHTML = '<span class="eic">' + I('clock') + '</span><b>Not set up yet</b><p>Run supabase/phase2.sql in the Supabase SQL editor, then reload this page.</p>';
      empty.hidden = false;
    } else if (!list.length) {
      empty.innerHTML = '<span class="eic">' + I('users') + '</span><b>No employees yet</b><p>Add people in the Employees tab first.</p>';
      empty.hidden = false;
    } else empty.hidden = true;
  }

  /* ---------- correcting or adding a record ---------- */
  function openDialog(p) {
    var r = at.recs.filter(function (x) { return x.employee_id === p.id; })[0] || null;
    var dlg = $('#att-dlg'), form = $('#att-form'), err = $('#at-err');
    $('#at-title').textContent = r ? 'Correct Attendance' : 'Add Attendance';
    $('#at-who').textContent = p.full_name + ' (' + p.employee_no + ')';
    $('#at-date').value = at.date;
    $('#at-date').readOnly = true;
    $('#at-in').value = r ? hhmm(r.time_in) : '';
    $('#at-out').value = r ? hhmm(r.time_out) : '';
    $('#at-note').value = r ? r.note || '' : '';
    err.hidden = true;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var tin = $('#at-in').value, tout = $('#at-out').value, problem = '';
      if (!tin && tout) problem = 'Enter a time in before a time out.';
      else if (tin && tout && stamp(at.date, tout) < stamp(at.date, tin)) problem = 'The time out is earlier than the time in.';
      else if (!r && !tin) problem = 'Enter at least a time in.';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      var fields = { time_in: tin ? stamp(at.date, tin) : null, time_out: tout ? stamp(at.date, tout) : null, note: $('#at-note').value.trim() };
      $('#at-ok').disabled = true;
      var res = r
        ? await sb.from('attendance_records').update(fields).eq('id', r.id).select('id').maybeSingle()
        : await sb.from('attendance_records').insert(Object.assign({ employee_id: p.id, work_date: at.date }, fields)).select('id').maybeSingle();
      $('#at-ok').disabled = false;
      if (res.error || !res.data) {
        err.textContent = res.error && /duplicate|unique|23505/i.test(res.error.code + ' ' + res.error.message)
          ? 'A record already exists for that day. Reload and correct it instead.' : "Couldn't save that. You may not have permission.";
        err.hidden = false;
        return;
      }
      dlg.close();
      logAction('attendance.correct', p.employee_no + ' ' + at.date, { id: res.data.id, added: !r });
      toast(r ? 'Record corrected.' : 'Record added.', 'ok');
      load();
    };
    $('#at-cancel').onclick = function () { dlg.close(); };
    dlg.showModal();
    $('#at-in').focus();
  }

  /* ---------- export: the month of the chosen day, as a spreadsheet ---------- */
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // keep a spreadsheet from running typed text as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  async function exportMonth() {
    var start = at.date.slice(0, 8) + '01';
    var y = Number(at.date.slice(0, 4)), m = Number(at.date.slice(5, 7));
    var next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    busy('Preparing the spreadsheet…');
    var res = await sb.from('attendance_records').select('work_date,employee_id,time_in,time_out,note').gte('work_date', start).lt('work_date', next).order('work_date').limit(10000);
    busy('');
    if (res.error) { toast("Couldn't prepare the spreadsheet.", 'bad'); return; }
    var lines = [['Date', 'Employee ID', 'Name', 'Time in', 'Time out', 'Hours', 'Status', 'Note'].map(csvCell).join(',')];
    (res.data || []).sort(function (a, b) {
      var pa = person(a.employee_id), pb = person(b.employee_id);
      return a.work_date.localeCompare(b.work_date) || String(pa && pa.employee_no).localeCompare(String(pb && pb.employee_no));
    }).forEach(function (r) {
      var p = person(r.employee_id);
      lines.push([r.work_date, p ? p.employee_no : '', p ? p.full_name : '', hhmm(r.time_in), hhmm(r.time_out), hours(r), statusOf(r, r.work_date)[1], r.note].map(csvCell).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'attendance-' + start.slice(0, 7) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    logAction('attendance.export', start.slice(0, 7), { rows: (res.data || []).length });
    toast('Spreadsheet downloaded.', 'ok');
  }

  /* ---------- wiring ---------- */
  function onClick(e) {
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'back') { at.ctx.back(); return; }
    if (a === 'prev') { at.date = addDays(at.date, -1); load(); }
    else if (a === 'next') { at.date = addDays(at.date, 1); load(); }
    else if (a === 'today') { at.date = today(); load(); }
    else if (a === 'export') exportMonth();
    else if (a === 'edit') {
      var li = e.target.closest('li.lrow'), p = li && person(li.dataset.emp);
      if (p) openDialog(p);
    }
  }

  window.MembersAttendance = {
    open: async function (box, ctx) {
      at.box = box;
      at.ctx = ctx;
      if (!canReview()) {
        box.innerHTML = '<div class="ph">' + IB('back', 'Back to the deliverables', { 'data-a': 'back' }, 'line') + '<div class="ph-main"><h2>Attendance Tracker</h2></div></div>' +
          '<div class="list-card"><div class="es"><span class="eic">' + I('lock') + '</span><b>Staffing and Recruitment only</b><p>Attendance records can be reviewed by Staffing and Recruitment.</p></div></div>';
        box.onclick = onClick;
        return;
      }
      at.date = today();
      shell();
      box.onclick = onClick;
      $('#ad-pick', box).onchange = function () { if (this.value) { at.date = this.value; load(); } };
      var res = await sb.rpc('employee_options');
      at.people = res.error || !Array.isArray(res.data) ? [] : res.data;
      await load();
    }
  };
})();
