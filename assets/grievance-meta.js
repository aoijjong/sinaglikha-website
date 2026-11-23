/*
  Grievance system: the lists and rules every part shares (the server, the employee portal, the Senior Manager
  portal and the tests), so a category or status is only ever defined here.
  The database (supabase/grievances.sql) holds the same lists in its CHECK rules; the tests compare them.
*/
(function (root) {
  'use strict';
  var CATEGORIES = [
    { key: 'harassment',     label: 'Harassment or bullying' },
    { key: 'discrimination', label: 'Discrimination' },
    { key: 'pay_benefits',   label: 'Pay or benefits' },
    { key: 'safety',         label: 'Health and safety' },
    { key: 'supervisor',     label: 'Supervisor or manager conduct' },
    { key: 'policy',         label: 'Policy violation' },
    { key: 'other',          label: 'Other' }
  ];
  /* tone picks the chip colour: wait (new), work (being handled), done, alert */
  var STATUSES = [
    { key: 'submitted',    label: 'Submitted',    tone: 'wait' },
    { key: 'acknowledged', label: 'Acknowledged', tone: 'work' },
    { key: 'under_review', label: 'Under review', tone: 'work' },
    { key: 'resolved',     label: 'Resolved',     tone: 'done' },
    { key: 'escalated',    label: 'Escalated',    tone: 'alert' },
    { key: 'closed',       label: 'Closed',       tone: 'done' }
  ];
  /* "Does it involve someone in Legal Compliance, or the Administrator?" decides who may handle the case */
  var INVOLVES = [
    { key: 'none',          label: 'No',                                    routing: 'legal' },
    { key: 'legal_member',  label: 'Yes, a member of Legal Compliance',     routing: 'admin_only' },
    { key: 'administrator', label: 'Yes, the Administrator',                routing: 'legal_only' }
  ];
  /* attachments: at most 5 a grievance, 10 MB each, and only these kinds (also enforced by the storage bucket) */
  var FILES = {
    max: 5, maxBytes: 10 * 1024 * 1024,
    types: {
      'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'text/plain': 'txt',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
    }
  };
  var TICKET_RE = /^GRV-\d{4}-\d{4,}$/;
  var LIMITS = { subject: 120, body: 4000, location: 120, involved: 300, message: 3000, outcome: 2000 };

  function byKey(list) { var o = {}; list.forEach(function (x) { o[x.key] = x; }); return o; }
  var CAT = byKey(CATEGORIES), ST = byKey(STATUSES);
  var api = {
    CATEGORIES: CATEGORIES, STATUSES: STATUSES, TICKET_RE: TICKET_RE, LIMITS: LIMITS,
    categoryLabel: function (k) { return CAT[k] ? CAT[k].label : 'Other'; },
    statusLabel: function (k) { return ST[k] ? ST[k].label : String(k || ''); },
    statusTone: function (k) { return ST[k] ? ST[k].tone : 'wait'; },
    validCategory: function (k) { return Object.prototype.hasOwnProperty.call(CAT, k); },
    validStatus: function (k) { return Object.prototype.hasOwnProperty.call(ST, k); },
    INVOLVES: INVOLVES, FILES: FILES,
    routingFor: function (key) { var f = INVOLVES.filter(function (x) { return x.key === key; })[0]; return f ? f.routing : 'legal'; },
    fileExt: function (mime) { return Object.prototype.hasOwnProperty.call(FILES.types, mime) ? FILES.types[mime] : ''; },
    /* the name an employee gave a file, made safe to show and store: no path pieces, no control characters */
    cleanFileName: function (n) { return String(n || '').replace(/[\\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'file'; },
    mimeFor: function (file) {
      if (file && Object.prototype.hasOwnProperty.call(FILES.types, file.type)) return file.type;
      var ext = (String(file && file.name || '').split('.').pop() || '').toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
      var hit = Object.keys(FILES.types).filter(function (m) { return FILES.types[m] === ext; })[0];
      return hit || String(file && file.type || '');
    },
    fileSize: function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; },
    normalizeTicket: function (v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.SngGrievance = api;
})(typeof window !== 'undefined' ? window : this);
