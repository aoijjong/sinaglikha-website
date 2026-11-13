/*
  Senior Manager portal sidebar (desktop, 1025px and wider).
  The five section buttons (#tabs) move into a sidebar that is closed by default: a thin gradient bar with a bump and an arrow sits on
  the left edge. Hovering the bar or the sidebar opens it; clicking the arrow pins it open. Esc, the veil, or choosing a section closes it.
  On narrower screens the buttons go back to the original place at the top and nothing here does anything.
  The sections themselves are still switched by members.js (it listens to the same buttons), so nothing else changes.
*/
(function () {
  'use strict';
  var tabs = document.getElementById('tabs');
  if (!tabs || !window.matchMedia) return;
  var home = tabs.parentNode, homeNext = tabs.nextSibling;
  var DESK = window.matchMedia('(min-width:1025px)');
  var ICON = { library: 'folder', content: 'clipboard', employees: 'users', records: 'book', people: 'key' };
  var SIGNED = function () { var v = document.getElementById('view-app'); return !!v && !v.hidden; };

  /* ---- build the pieces once ---- */
  var rail = document.createElement('div');
  rail.className = 'sb-rail';
  rail.id = 'sb-rail';
  rail.innerHTML = '<span class="sb-bar" aria-hidden="true"></span>' +
    '<button class="sb-bump" id="sb-bump" type="button" aria-label="Open the menu" aria-expanded="false" aria-controls="sb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>';
  var scrim = document.createElement('div');
  scrim.className = 'sb-scrim';
  var sb = document.createElement('aside');
  sb.className = 'sb';
  sb.id = 'sb';
  sb.setAttribute('aria-label', 'Menu');
  sb.innerHTML = '<div class="sb-head"><img src="../assets/sinaglikha-logo-notag.png" alt="SINAGLIKHA" width="1487" height="212"><span>Senior Managers</span></div>' +
    '<div class="sb-foot"><button class="sb-prof" id="sb-prof" type="button" aria-label="Profile settings"><span class="sb-av" id="sb-av"></span>' +
    '<span><b id="sb-name">Profile</b><small>Profile settings</small></span></button>' +
    '<button class="sb-out" id="sb-out" type="button">Sign out</button></div>';
  document.body.appendChild(scrim);
  document.body.appendChild(sb);
  document.body.appendChild(rail);
  var foot = sb.querySelector('.sb-foot'), bump = document.getElementById('sb-bump');

  /* an icon in front of each section name (shown only inside the sidebar) */
  Array.prototype.forEach.call(tabs.querySelectorAll('.tab'), function (t) {
    var key = (t.id || '').replace('tab-', ''), name = ICON[key];
    if (!name || !window.SngIcon || t.querySelector('.tic')) return;
    var s = document.createElement('span');
    s.className = 'tic';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = window.SngIcon(name);
    t.insertBefore(s, t.firstChild);
  });

  /* ---- open and close ---- */
  var pinned = false, timer = null;
  function setOpen(on) {
    document.body.classList.toggle('sb-open', on);
    bump.setAttribute('aria-expanded', String(on));
    bump.setAttribute('aria-label', on ? 'Close the menu' : 'Open the menu');
    if (on) refreshProfile();
    if (!on) pinned = false;
  }
  function isOpen() { return document.body.classList.contains('sb-open'); }
  function hoverOpen() { clearTimeout(timer); if (DESK.matches && SIGNED()) setOpen(true); }
  function hoverClose() { clearTimeout(timer); if (pinned) return; timer = setTimeout(function () { if (!pinned) setOpen(false); }, 320); }

  rail.addEventListener('mouseenter', hoverOpen);
  rail.addEventListener('mouseleave', hoverClose);
  sb.addEventListener('mouseenter', function () { clearTimeout(timer); });
  sb.addEventListener('mouseleave', hoverClose);
  bump.addEventListener('click', function () {
    clearTimeout(timer);
    if (isOpen() && pinned) { setOpen(false); return; }
    pinned = true;
    setOpen(true);
  });
  scrim.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) { setOpen(false); bump.focus(); } });
  tabs.addEventListener('click', function (e) { if (e.target.closest('.tab') && DESK.matches) setTimeout(function () { setOpen(false); }, 160); });

  /* up and down arrows move between the sections (members.js already handles left and right) */
  tabs.addEventListener('keydown', function (e) {
    if (!DESK.matches || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    tabs.dispatchEvent(new KeyboardEvent('keydown', { key: e.key === 'ArrowDown' ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
  });

  /* ---- profile settings and sign out ---- */
  function refreshProfile() {
    var av = document.getElementById('btn-profile'), who = document.getElementById('who');
    document.getElementById('sb-av').textContent = (av && av.textContent.trim()) || '';
    document.getElementById('sb-name').textContent = (who && who.textContent.trim()) || 'Profile';
  }
  document.getElementById('sb-prof').addEventListener('click', function () { setOpen(false); document.getElementById('btn-profile').click(); });
  document.getElementById('sb-out').addEventListener('click', function () { setOpen(false); document.getElementById('btn-signout').click(); });

  /* ---- desktop: the buttons live in the sidebar; narrower: back at the top ---- */
  function place() {
    if (DESK.matches) { if (tabs.parentNode !== sb) sb.insertBefore(tabs, foot); }
    else {
      if (tabs.parentNode !== home) home.insertBefore(tabs, homeNext && homeNext.parentNode === home ? homeNext : null);
      setOpen(false);
    }
  }
  place();
  if (DESK.addEventListener) DESK.addEventListener('change', place); else if (DESK.addListener) DESK.addListener(place);
})();
