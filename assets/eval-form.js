/*
  SINAGLIKHA evaluation forms: the question types, shared by the Senior Manager area (members/evaluations.js)
  and the Employee Portal (employees/portal.js), so a form looks and works the same in both.
  A question is { id, type, title, description, required, options, scale, labels, rating, comment, picked }:
    short, paragraph, date, time    the answer is in "comment"
    choice, dropdown, checkbox      the options picked are in "picked"
    rating (linear scale), stars    the number is in "rating"; only these two add to the score
                                    a linear scale has its own length (scale, 3 to 10) and optional names for its
                                    points (labels); older questions without them use the form's scale_max and labels
  "text", used by the first version of the forms, means paragraph.
*/
(function () {
  'use strict';

  var TYPES = [
    ['short', 'Short answer'], ['paragraph', 'Paragraph'], ['choice', 'Multiple choice'], ['checkbox', 'Checkboxes'],
    ['dropdown', 'Dropdown'], ['rating', 'Linear scale'], ['stars', 'Rating (stars)'], ['date', 'Date'], ['time', 'Time']
  ];
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" stroke-linejoin="round"/></svg>';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function qType(q) {
    var t = q && q.type;
    if (t === 'text') return 'paragraph';
    return TYPES.some(function (x) { return x[0] === t; }) ? t : 'rating';
  }
  function isScored(t) { return t === 'rating' || t === 'stars'; }
  function hasOptions(t) { return t === 'choice' || t === 'checkbox' || t === 'dropdown'; }
  function isRequired(q) { return q.required === undefined ? isScored(qType(q)) : !!q.required; }
  function labelOf(f, n) { var l = f && f.labels ? f.labels[n - 1] : ''; return l ? String(l) : ''; }
  /* how long a linear scale is: its own length, else the form's */
  function scaleOf(q, f) { var n = Number(q && q.scale); return n >= 3 && n <= 10 ? n : Number((f && f.scale_max) || 5); }
  function maxOf(q, f) { return qType(q) === 'stars' ? 5 : scaleOf(q, f); }
  /* the name of point n on a linear scale: the question's own, else (older questions) the form's */
  function nameOf(q, f, n) {
    if (q && Array.isArray(q.labels)) return q.labels[n - 1] ? String(q.labels[n - 1]) : '';
    return labelOf(f, n);
  }
  function picked(q) { return Array.isArray(q.picked) ? q.picked : []; }

  /* the answering control for one question */
  function control(q, f, ro) {
    var t = qType(q), dis = ro ? ' disabled' : '', n, html = '';
    if (t === 'short') return '<div class="gf-ans"><input type="text" data-k="comment" maxlength="300" placeholder="Your answer" value="' + esc(q.comment) + '"' + dis + '></div>';
    if (t === 'paragraph') return '<div class="gf-ans"><textarea data-k="comment" maxlength="1000" rows="3" placeholder="Your answer"' + dis + '>' + esc(q.comment) + '</textarea></div>';
    if (t === 'date') return '<div class="gf-ans"><input type="date" data-k="comment" value="' + esc(q.comment) + '"' + dis + ' style="max-width:220px"></div>';
    if (t === 'time') return '<div class="gf-ans"><input type="time" data-k="comment" value="' + esc(q.comment) + '"' + dis + ' style="max-width:160px"></div>';
    if (t === 'choice' || t === 'checkbox') {
      var on = picked(q);
      return '<div class="gf-choices" role="group" aria-label="' + esc(q.title) + '">' + (q.options || []).map(function (o) {
        return '<button type="button" class="gf-ch' + (t === 'checkbox' ? ' sq' : '') + '" data-pick="' + esc(o) + '" aria-pressed="' + (on.indexOf(o) !== -1) + '"' + dis + '><i></i><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>';
    }
    if (t === 'dropdown') {
      var cur = picked(q)[0] || '';
      return '<div class="gf-ans"><select class="gf-sel" data-k="dropdown"' + dis + '><option value="">Choose</option>' + (q.options || []).map(function (o) {
        return '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select></div>';
    }
    if (t === 'stars') {
      for (n = 1; n <= 5; n++) html += '<button type="button" class="gf-star" data-n="' + n + '" aria-label="' + n + (n === 1 ? ' star' : ' stars') + '" aria-pressed="' + (Number(q.rating) >= n) + '"' + dis + '>' + STAR + '</button>';
      return '<div class="gf-stars" role="group" aria-label="' + esc(q.title) + '">' + html + '</div><div class="gf-ans"><input type="text" data-k="comment" maxlength="1000" placeholder="Comment (optional)" value="' + esc(q.comment) + '"' + dis + '></div>';
    }
    var sc = scaleOf(q, f), lo = nameOf(q, f, 1), hi = nameOf(q, f, sc);
    for (n = 1; n <= sc; n++) {
      html += '<div class="gf-opt"><span>' + n + '</span><button type="button" data-n="' + n + '" aria-label="' + n + (nameOf(q, f, n) ? ': ' + esc(nameOf(q, f, n)) : '') + '" aria-pressed="' + (Number(q.rating) === n) + '"' + dis + '></button></div>';
    }
    return '<div class="gf-scale" role="group" aria-label="' + esc(q.title) + '">' + (lo ? '<span class="gf-end">' + esc(lo) + '</span>' : '') + html +
      (hi ? '<span class="gf-end">' + esc(hi) + '</span>' : '') + '</div>' +
      '<div class="gf-pick">' + esc(q.rating ? nameOf(q, f, Number(q.rating)) : '') + '</div>' +
      '<div class="gf-ans"><input type="text" data-k="comment" maxlength="1000" placeholder="Comment (optional)" value="' + esc(q.comment) + '"' + dis + '></div>';
  }

  /* a whole question card for answering */
  function card(q, f, ro, i) {
    return '<div class="gf-card" data-q="' + esc(q.id) + '" data-i="' + i + '"><div class="gf-qt">' + esc(q.title) + (isRequired(q) && !ro ? '<span class="s">*</span>' : '') + '</div>' +
      (q.description ? '<div class="gf-qd">' + esc(q.description) + '</div>' : '') + control(q, f, ro) + '<div class="gf-err" hidden></div></div>';
  }

  /* a disabled sample of a question, for the form builder */
  function preview(q, f) {
    var t = qType(q), n, html = '';
    if (t === 'short') return '<div class="gf-ans gf-prev"><input type="text" disabled placeholder="Short answer"></div>';
    if (t === 'paragraph') return '<div class="gf-ans gf-prev"><textarea disabled rows="2" placeholder="Paragraph"></textarea></div>';
    if (t === 'date') return '<div class="gf-ans gf-prev"><input type="text" disabled placeholder="Month, day, year" style="max-width:220px"></div>';
    if (t === 'time') return '<div class="gf-ans gf-prev"><input type="text" disabled placeholder="Time" style="max-width:160px"></div>';
    if (t === 'choice' || t === 'checkbox') {
      return '<div class="gf-choices gf-prev">' + (q.options || []).map(function (o) { return '<span class="gf-ch' + (t === 'checkbox' ? ' sq' : '') + '"><i></i><span>' + esc(o || 'Option') + '</span></span>'; }).join('') + '</div>';
    }
    if (t === 'dropdown') return '<div class="gf-prev"><ol class="gf-dd">' + (q.options || []).map(function (o, k) { return '<li>' + (k + 1) + '. ' + esc(o || 'Option') + '</li>'; }).join('') + '</ol></div>';
    if (t === 'stars') { for (n = 1; n <= 5; n++) html += '<span class="gf-star">' + STAR + '</span>'; return '<div class="gf-stars gf-prev">' + html + '</div>'; }
    var psc = scaleOf(q, f), plo = nameOf(q, f, 1), phi = nameOf(q, f, psc);
    for (n = 1; n <= psc; n++) html += '<div class="gf-opt"><span>' + n + '</span><button type="button" disabled tabindex="-1" aria-hidden="true"></button></div>';
    return '<div class="gf-scale gf-prev">' + (plo ? '<span class="gf-end">' + esc(plo) + '</span>' : '') + html + (phi ? '<span class="gf-end">' + esc(phi) + '</span>' : '') + '</div>';
  }

  /* Wires up the answering controls inside root. Every change updates the question objects in place. */
  function bind(root, questionsOrFn, formOrFn, onChange) {
    var getQ = typeof questionsOrFn === 'function' ? questionsOrFn : function () { return questionsOrFn; };
    var getF = typeof formOrFn === 'function' ? formOrFn : function () { return formOrFn; };
    function find(el) {
      var questions = getQ();
      var c = el.closest('.gf-card[data-q]');
      if (!c) return null;
      var id = c.getAttribute('data-q');
      for (var k = 0; k < questions.length; k++) if (String(questions[k].id) === id) return { q: questions[k], card: c };
      return null;
    }
    function clearBad(card) { card.classList.remove('bad'); var e = card.querySelector('.gf-err'); if (e) e.hidden = true; }
    root.addEventListener('input', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-k');
      if (!k || k === 'dropdown') return;
      var h = find(e.target);
      if (!h) return;
      h.q.comment = e.target.value;
      clearBad(h.card);
      if (onChange) onChange(h.q);
    });
    root.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-k') !== 'dropdown') return;
      var h = find(e.target);
      if (!h) return;
      h.q.picked = e.target.value ? [e.target.value] : [];
      clearBad(h.card);
      if (onChange) onChange(h.q);
    });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled || !root.contains(b)) return;
      var h = find(b);
      if (!h) return;
      var t = qType(h.q);
      if (b.hasAttribute('data-n')) {
        var n = Number(b.getAttribute('data-n'));
        h.q.rating = Number(h.q.rating) === n ? null : n;
        Array.prototype.forEach.call(h.card.querySelectorAll('[data-n]'), function (x) {
          var m = Number(x.getAttribute('data-n'));
          x.setAttribute('aria-pressed', String(t === 'stars' ? Number(h.q.rating) >= m : Number(h.q.rating) === m));
        });
        var pk = h.card.querySelector('.gf-pick');
        if (pk) pk.textContent = h.q.rating ? nameOf(h.q, getF(), Number(h.q.rating)) : '';
      } else if (b.hasAttribute('data-pick')) {
        var o = b.getAttribute('data-pick'), on = picked(h.q).slice(), at = on.indexOf(o);
        if (t === 'checkbox') { if (at === -1) on.push(o); else on.splice(at, 1); }
        else on = at === -1 ? [o] : [];
        h.q.picked = on;
        Array.prototype.forEach.call(h.card.querySelectorAll('[data-pick]'), function (x) { x.setAttribute('aria-pressed', String(on.indexOf(x.getAttribute('data-pick')) !== -1)); });
      } else return;
      clearBad(h.card);
      if (onChange) onChange(h.q);
    });
  }

  function answered(q) {
    var t = qType(q);
    if (isScored(t)) return !!q.rating;
    if (hasOptions(t)) return picked(q).length > 0;
    return !!String(q.comment || '').trim();
  }
  /* the ids of required questions with no answer yet */
  function missing(questions) {
    return questions.filter(function (q) { return isRequired(q) && !answered(q); }).map(function (q) { return q.id; });
  }
  function markMissing(root, ids) {
    Array.prototype.forEach.call(root.querySelectorAll('.gf-card[data-q]'), function (c) {
      var bad = ids.indexOf(c.getAttribute('data-q')) !== -1;
      c.classList.toggle('bad', bad);
      var e = c.querySelector('.gf-err');
      if (e) { e.hidden = !bad; e.textContent = bad ? 'This is a required question' : ''; }
    });
    var first = root.querySelector('.gf-card.bad');
    if (first) first.scrollIntoView({ block: 'center' });
  }
  /* the answers, as the server takes them */
  function answers(questions) {
    return questions.map(function (q) {
      var t = qType(q);
      return { id: q.id, rating: isScored(t) && q.rating ? Number(q.rating) : null, comment: hasOptions(t) ? '' : String(q.comment || ''), picked: hasOptions(t) ? picked(q) : [] };
    });
  }
  /* the score: the rated questions count equally, as a percentage of the best possible; null until every required one is rated.
     (Evaluations written when questions still had weights keep theirs: a missing weight counts as 1.) */
  function score(questions, scaleMax) {
    var got = 0, tot = 0, blocked = false;
    questions.forEach(function (q) {
      var t = qType(q);
      if (!isScored(t)) return;
      var w = q.weight === undefined || q.weight === null ? 1 : Number(q.weight) || 0, mx = t === 'stars' ? 5 : scaleOf(q, { scale_max: scaleMax });
      if (q.rating) { got += (Number(q.rating) / mx) * w; tot += w; }
      else if (isRequired(q)) { blocked = true; tot += w; }
    });
    return blocked || !tot ? null : Math.round((got / tot) * 1000) / 10;
  }
  function scoredCount(questions) {
    var all = questions.filter(function (q) { return isScored(qType(q)); });
    return { rated: all.filter(function (q) { return q.rating; }).length, total: all.length };
  }
  /* an answer as plain text, for spreadsheets and printing */
  function text(q) {
    var t = qType(q);
    if (hasOptions(t)) return picked(q).join('; ');
    if (isScored(t)) return (q.rating ? String(q.rating) : '') + (q.comment ? (q.rating ? ' - ' : '') + q.comment : '');
    return String(q.comment || '');
  }

  window.SngEvalForm = {
    TYPES: TYPES, qType: qType, isScored: isScored, hasOptions: hasOptions, isRequired: isRequired, maxOf: maxOf, labelOf: labelOf, scaleOf: scaleOf, nameOf: nameOf,
    control: control, card: card, preview: preview, bind: bind, answered: answered, missing: missing, markMissing: markMissing,
    answers: answers, score: score, scoredCount: scoredCount, text: text
  };
})();
