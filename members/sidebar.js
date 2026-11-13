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
    '<button class="sb-bump" id="sb-bump" type="button" aria-label="Open the menu" aria-expanded="false" aria-controls="sb"></button>';
  var scrim = document.createElement('div');
  scrim.className = 'sb-scrim';
  var sb = document.createElement('aside');
  sb.className = 'sb';
  sb.id = 'sb';
  sb.setAttribute('aria-label', 'Menu');
  sb.innerHTML = '<button class="sb-me" id="sb-prof" type="button" aria-label="Profile settings"><span class="sb-av" id="sb-av"></span><b id="sb-name">Profile</b><small id="sb-mail"></small><em>Senior Manager</em></button>' +
    '<div class="sb-foot"><button class="sb-item" id="sb-set" type="button"><span class="tic">' + (window.SngIcon ? window.SngIcon('pencil') : '') + '</span>Profile settings</button>' +
    '<button class="sb-item sb-out" id="sb-out" type="button"><span class="tic">' + (window.SngIcon ? window.SngIcon('logout') : '') + '</span>Sign out</button></div>';
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

  /* ---- open and close ----
     Hovering the bar only peeks: the sidebar slides over the page and goes away when the mouse leaves.
     Clicking the handle anchors it to the left: the page makes room for it and it stays until the handle is clicked again. */
  var KEY = 'sng-sb-docked', docked = false, peek = false, timer = null;
  try { docked = sessionStorage.getItem(KEY) === '1'; } catch (e) { docked = false; }
  function render() {
    var open = (docked || peek) && DESK.matches;
    document.body.classList.toggle('sb-open', open);
    document.body.classList.toggle('sb-docked', docked && DESK.matches);
    bump.setAttribute('aria-expanded', String(open));
    bump.setAttribute('aria-label', docked ? 'Close the menu' : (open ? 'Keep the menu open' : 'Open the menu'));
    if (open) refreshProfile();
  }
  function setDocked(on) {
    docked = on;
    peek = false;
    try { sessionStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* the choice just is not remembered */ }
    render();
  }
  function closePeek() { if (!docked) { peek = false; render(); } }
  function hoverOpen() { clearTimeout(timer); if (DESK.matches && SIGNED() && !docked) { peek = true; render(); } }
  function hoverClose() { clearTimeout(timer); if (docked) return; timer = setTimeout(closePeek, 320); }

  rail.addEventListener('mouseenter', hoverOpen);
  rail.addEventListener('mouseleave', hoverClose);
  sb.addEventListener('mouseenter', function () { clearTimeout(timer); });
  sb.addEventListener('mouseleave', hoverClose);
  bump.addEventListener('click', function () { clearTimeout(timer); setDocked(!docked); });
  scrim.addEventListener('click', closePeek);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (docked || peek) && DESK.matches) { setDocked(false); bump.focus(); } });
  tabs.addEventListener('click', function (e) { if (e.target.closest('.tab') && DESK.matches) setTimeout(closePeek, 160); });

  /* up and down arrows move between the sections (members.js already handles left and right) */
  tabs.addEventListener('keydown', function (e) {
    if (!DESK.matches || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    tabs.dispatchEvent(new KeyboardEvent('keydown', { key: e.key === 'ArrowDown' ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
  });

  /* ---- profile settings and sign out ---- */
  function refreshProfile() {
    var av = document.getElementById('btn-profile'), who = document.getElementById('who');
    var nm = (who && who.textContent.trim()) || '', st0 = window.MembersApp && window.MembersApp.state, em = st0 && st0.profile && st0.profile.email || '';
    var ini = (av && av.textContent.trim()) || (nm || em).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return Array.from(w)[0]; }).join('').toUpperCase();
    document.getElementById('sb-av').textContent = ini;
    document.getElementById('sb-name').textContent = (who && who.textContent.trim()) || (st0 && st0.profile && st0.profile.full_name) || em.split('@')[0] || 'Profile';
    var st = window.MembersApp && window.MembersApp.state, mail = st && st.profile && st.profile.email;
    document.getElementById('sb-mail').textContent = mail || '';
  }
  function openProfile() { closePeek(); document.getElementById('btn-profile').click(); }
  document.getElementById('sb-prof').addEventListener('click', openProfile);
  document.getElementById('sb-set').addEventListener('click', openProfile);
  document.getElementById('sb-out').addEventListener('click', function () { closePeek(); document.getElementById('btn-signout').click(); });

  /* ---- desktop: the buttons live in the sidebar; narrower: back at the top ---- */
  function place() {
    if (DESK.matches) { if (tabs.parentNode !== sb) sb.insertBefore(tabs, foot); }
    else {
      if (tabs.parentNode !== home) home.insertBefore(tabs, homeNext && homeNext.parentNode === home ? homeNext : null);
    }
    render();
  }
  place();
  if (DESK.addEventListener) DESK.addEventListener('change', place); else if (DESK.addListener) DESK.addListener(place);
})();
