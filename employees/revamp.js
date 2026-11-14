/*
  Employee Portal revamp: the same look as the Senior Manager portal.
  Desktop (1025px and wider): a glass sidebar anchored on the left with the person's card, a jump menu to each panel of the
  dashboard, and Sign out. Everywhere: a hero banner on the dashboard. portal.js is untouched; this file only reads what it draws
  and clicks the buttons it already has.
*/
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var home = $('#v-home');
  if (!home) return;
  var IC = window.SngIcon || function () { return ''; };
  var HOUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5V14h4v5.5"/></svg>';

  /* ---- the hero banner on the dashboard ---- */
  var hello = $('.hello', home);
  if (hello && !hello.querySelector('.bn-art')) {
    hello.classList.add('sb-banner');
    var text = document.createElement('div');
    text.className = 'bn-text';
    while (hello.firstChild) text.appendChild(hello.firstChild);
    var lead = document.createElement('p');
    lead.className = 'bn-lead';
    lead.textContent = 'Your announcements, attendance, learning and files, all in one place.';
    text.appendChild(lead);
    var art = document.createElement('div');
    art.className = 'bn-art';
    art.setAttribute('aria-hidden', 'true');
    art.innerHTML = '<img class="bn-img" src="../assets/banners/employee.webp" alt="" width="233" height="220">';
    hello.appendChild(art);
    hello.insertBefore(text, art);
  }

  /* ---- the sidebar (only drawn on desktop by the stylesheet) ---- */
  var ITEMS = [
    ['top', 'Home', HOUSE, null],
    ['ann', 'Announcements', IC('chat'), '#ann-panel'],
    ['forum', 'Community', IC('users'), '#forum-panel'],
    ['att', 'My Attendance', IC('clock'), '#att-panel'],
    ['dept', 'Departments', IC('folder'), '#dept-panel'],
    ['learn', 'Learning', IC('book'), '#learn-panel'],
    ['evl', 'Evaluations', IC('clipboard'), '#evl-panel'],
    ['rec', 'My Records', IC('lock'), '#rec-panel']
  ];
  var sb = document.createElement('aside');
  sb.className = 'sb';
  sb.id = 'sb';
  sb.setAttribute('aria-label', 'Menu');
  sb.innerHTML = '<button class="sb-me" id="sb-prof" type="button" aria-label="Open my profile settings" title="Profile settings"><span class="sb-avw"><span class="sb-av" id="sb-av"></span><span class="sb-edit" aria-hidden="true">' + IC('pencil') +
    '</span></span><b id="sb-name"></b><small id="sb-mail"></small><span class="sb-go">My profile <span>' + IC('chevron') + '</span></span></button>' +
    '<nav class="sb-nav" id="sb-nav" aria-label="Dashboard">' + ITEMS.map(function (it) {
      return '<button class="sb-link" type="button" data-to="' + it[0] + '"><span class="tic">' + it[2] + '</span>' + it[1] + '</button>';
    }).join('') + '</nav>' +
    '<div class="sb-foot"><button class="sb-item sb-out" id="sb-out" type="button"><span class="tic">' + IC('logout') + '</span>Sign out</button></div>';
  document.body.appendChild(sb);
  var links = [].slice.call(sb.querySelectorAll('.sb-link'));

  function panelOf(key) {
    var it = ITEMS.filter(function (x) { return x[0] === key; })[0];
    return it && it[3] ? $(it[3]) : null;
  }
  // an entry only shows while its panel is on the page
  function syncLinks() {
    links.forEach(function (b) {
      var p = panelOf(b.dataset.to);
      b.hidden = b.dataset.to !== 'top' && (!p || p.hidden);
    });
    markActive();
  }
  function markActive() {
    var best = null, bestTop = -1e9;
    links.forEach(function (b) {
      if (b.hidden) return;
      var p = panelOf(b.dataset.to), top = p ? p.getBoundingClientRect().top : -1e8;
      if (b.dataset.to === 'top') top = -1e8 + 1;
      if (top <= 190 && top > bestTop) { best = b; bestTop = top; }
    });
    if (!best) best = links[0];
    links.forEach(function (b) {
      var on = b === best;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }
  sb.querySelector('#sb-nav').addEventListener('click', function (e) {
    var b = e.target.closest('.sb-link');
    if (!b) return;
    var p = panelOf(b.dataset.to);
    if (b.dataset.to === 'top' || !p) window.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: Math.max(0, p.getBoundingClientRect().top + window.pageYOffset - 24), behavior: 'smooth' });
  });
  $('#sb-prof', sb).addEventListener('click', function () { var b = $('#btn-profile'); if (b) b.click(); });
  $('#sb-out', sb).addEventListener('click', function () { var b = $('#btn-out'); if (b) b.click(); });

  /* ---- the person's card: photo or initials, name, position ---- */
  function refreshMe() {
    var av = $('#btn-profile'), box = $('#sb-av', sb);
    var img = av && av.querySelector('img');
    box.innerHTML = '';
    if (img) { var c = document.createElement('img'); c.src = img.src; c.alt = ''; box.appendChild(c); }
    else box.textContent = av ? av.textContent : '';
    var name = ($('#pf-name') || {}).textContent || '', pos = ($('#pf-pos') || {}).textContent || '';
    $('#sb-name', sb).textContent = name || 'My account';
    $('#sb-mail', sb).textContent = pos && pos !== 'Not set' ? pos : '';
  }
  ['#btn-profile', '#pf-name', '#pf-pos'].forEach(function (s) {
    var el = $(s);
    if (el) new MutationObserver(refreshMe).observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
  });
  refreshMe();

  /* keep the menu and the highlighted entry in step with the dashboard */
  [].forEach.call(home.querySelectorAll('.panel'), function (p) {
    new MutationObserver(syncLinks).observe(p, { attributes: true, attributeFilter: ['hidden'] });
  });
  window.addEventListener('scroll', function () { window.requestAnimationFrame(markActive); }, { passive: true });
  window.addEventListener('resize', markActive);
  syncLinks();
})();
