/*
  Senior Manager portal sidebar (desktop, 1025px and wider).
  The five section buttons (#tabs) move into a sidebar that is always anchored on the left, with the person's card on top and
  profile settings and sign out at the bottom. On narrower screens the buttons go back to the original place at the top and
  nothing here does anything. The sections themselves are still switched by members.js (it listens to the same buttons).
*/
(function () {
  'use strict';
  var tabs = document.getElementById('tabs');
  if (!tabs || !window.matchMedia) return;
  var home = tabs.parentNode, homeNext = tabs.nextSibling;
  var DESK = window.matchMedia('(min-width:1025px)');
  var ICON = { library: 'folder', content: 'clipboard', employees: 'users', records: 'book', people: 'key' };

  /* ---- build the sidebar once ---- */
  var sb = document.createElement('aside');
  sb.className = 'sb';
  sb.id = 'sb';
  sb.setAttribute('aria-label', 'Menu');
  sb.innerHTML = '<button class="sb-me" id="sb-prof" type="button" aria-label="Profile settings"><span class="sb-av" id="sb-av"></span><b id="sb-name">Profile</b><small id="sb-mail"></small><em>Senior Manager</em></button>' +
    '<div class="sb-foot"><button class="sb-item" id="sb-set" type="button"><span class="tic">' + (window.SngIcon ? window.SngIcon('pencil') : '') + '</span>Profile settings</button>' +
    '<button class="sb-item sb-out" id="sb-out" type="button"><span class="tic">' + (window.SngIcon ? window.SngIcon('logout') : '') + '</span>Sign out</button></div>';
  document.body.appendChild(sb);
  var foot = sb.querySelector('.sb-foot');

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

  /* up and down arrows move between the sections (members.js already handles left and right) */
  tabs.addEventListener('keydown', function (e) {
    if (!DESK.matches || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    tabs.dispatchEvent(new KeyboardEvent('keydown', { key: e.key === 'ArrowDown' ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
  });

  /* ---- the person's card, profile settings and sign out ---- */
  function refreshProfile() {
    var av = document.getElementById('btn-profile'), who = document.getElementById('who');
    var nm = (who && who.textContent.trim()) || '', st = window.MembersApp && window.MembersApp.state;
    var prof = st && st.profile, em = (prof && prof.email) || '';
    var ini = (av && av.textContent.trim()) || (nm || em).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return Array.from(w)[0]; }).join('').toUpperCase();
    document.getElementById('sb-av').textContent = ini;
    document.getElementById('sb-name').textContent = nm || (prof && prof.full_name) || em.split('@')[0] || 'Profile';
    document.getElementById('sb-mail').textContent = em;
  }
  function openProfile() { document.getElementById('btn-profile').click(); }
  document.getElementById('sb-prof').addEventListener('click', openProfile);
  document.getElementById('sb-set').addEventListener('click', openProfile);
  document.getElementById('sb-out').addEventListener('click', function () { document.getElementById('btn-signout').click(); });
  // the header's name and initial are filled in after sign-in; keep the card in step with them
  if (window.MutationObserver) {
    var mo = new MutationObserver(refreshProfile);
    ['who', 'btn-profile'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    });
  }
  refreshProfile();

  /* ---- desktop: the buttons live in the sidebar; narrower: back at the top ---- */
  function place() {
    if (DESK.matches) { if (tabs.parentNode !== sb) sb.insertBefore(tabs, foot); }
    else if (tabs.parentNode !== home) home.insertBefore(tabs, homeNext && homeNext.parentNode === home ? homeNext : null);
    refreshProfile();
  }
  place();
  if (DESK.addEventListener) DESK.addEventListener('change', place); else if (DESK.addListener) DESK.addListener(place);
})();
