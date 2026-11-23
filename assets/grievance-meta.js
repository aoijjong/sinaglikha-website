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
    normalizeTicket: function (v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.SngGrievance = api;
})(typeof window !== 'undefined' ? window : this);
