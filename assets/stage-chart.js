/*
  SINAGLIKHA applicant stage chart: one horizontal bar for each of the ten recruitment stages, drawn with plain
  HTML and CSS (no chart library). Used by the Recruitment card on the Staffing page (view only) and by the
  Applicant Tracking System screen, where each bar is a button that filters the list to that stage.

  SngStageChart.stages                         [[key, label, color], ...] in recruitment order
  SngStageChart.html(counts, options)          returns the chart as an HTML string
    counts        { new: 3, screening: 2, ... }  the number of applicants in each stage
    options.total        the number to show in the heading (defaults to the sum of the counts)
    options.interactive  true: the bars and the heading are buttons with data-status="<key>" ("all" for the heading)
    options.active       an array of stage keys to show as chosen (interactive charts)
    options.allActive    true: the heading shows as chosen
    options.note         a short line under the heading (for example "4 open positions")
*/
(function () {
  'use strict';
  var STAGES = [
    ['new', 'New', '#E0A21B'],
    ['screening', 'Screening', '#8DBBEA'],
    ['shortlisted', 'Shortlisted', '#6AA5E2'],
    ['interview', 'Interview', '#468FDA'],
    ['work_sample', 'Work sample', '#2F7BC8'],
    ['final_review', 'Final review', '#2465A9'],
    ['selected', 'Selected', '#3E9A4D'],
    ['not_selected', 'Not selected', '#D45050'],
    ['placed', 'Placed', '#2D7A3B'],
    ['withdrawn', 'Withdrawn', '#B9AEA4']
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function html(counts, o) {
    o = o || {};
    counts = counts || {};
    var sum = 0, max = 1;
    STAGES.forEach(function (s) { var n = counts[s[0]] || 0; sum += n; if (n > max) max = n; });
    var total = typeof o.total === 'number' ? o.total : sum;
    var active = o.active || [];
    var head = o.interactive
      ? '<button type="button" class="sc-total" data-status="all" aria-pressed="' + !!o.allActive + '"><b>' + total + '</b><span>' + (total === 1 ? 'applicant' : 'applicants') + '</span></button>'
      : '<span class="sc-total"><b>' + total + '</b><span>' + (total === 1 ? 'applicant' : 'applicants') + '</span></span>';
    var rows = STAGES.map(function (s) {
      var n = counts[s[0]] || 0, w = n ? Math.max(3, Math.round(n / max * 100)) : 0;
      var inner = '<span class="sc-l">' + esc(s[1]) + '</span><span class="sc-track"><i style="width:' + w + '%;background:' + s[2] + '"></i></span><b class="sc-n">' + n + '</b>';
      var label = s[1] + ': ' + n + (n === 1 ? ' applicant' : ' applicants');
      return o.interactive
        ? '<button type="button" class="sc-row" data-status="' + s[0] + '" aria-pressed="' + (active.indexOf(s[0]) !== -1) + '" aria-label="' + esc(label + '. Show only these') + '">' + inner + '</button>'
        : '<div class="sc-row" role="img" aria-label="' + esc(label) + '">' + inner + '</div>';
    }).join('');
    return '<div class="sc"><div class="sc-head">' + head + (o.note ? '<span class="sc-note">' + esc(o.note) + '</span>' : '') + '</div><div class="sc-rows">' + rows + '</div></div>';
  }

  window.SngStageChart = { stages: STAGES, html: html };
})();
