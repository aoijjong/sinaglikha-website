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
  sb.innerHTML = '<button class="sb-me" id="sb-prof" type="button" aria-label="Open my profile settings" title="Profile settings"><span class="sb-avw"><span class="sb-av" id="sb-av"></span><span class="sb-edit" aria-hidden="true">' + (window.SngIcon ? window.SngIcon('pencil') : '') + '</span></span><b id="sb-name">Profile</b><small id="sb-mail"></small><em>Senior Manager</em><span class="sb-go" aria-hidden="true">My profile<span>' + (window.SngIcon ? window.SngIcon('chevron') : '') + '</span></span></button>' +
    '<div class="sb-foot"><button class="sb-item sb-out" id="sb-out" type="button"><span class="tic">' + (window.SngIcon ? window.SngIcon('logout') : '') + '</span>Sign out</button></div>';
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

  /* ---- a banner at the top of every section ---- */
  var SECTION = {
    library: ['folder', '201 Files', 'Employee 201 files, open only to Staffing and Legal.'],
    content: ['clipboard', 'Content Manager', 'Everything employees see on the portal, by department.'],
    employees: ['users', 'Employees', 'People who sign in to the Employee Portal with their ID and a PIN.'],
    records: ['book', 'Restricted Records', 'Every open, upload and delete is written to the activity log.'],
    people: ['key', 'Accounts', 'Senior Manager accounts: who can sign in and what they can do.']
  };
  var app = document.getElementById('view-app'), appHead = app && app.querySelector('.app-head');
  var banner = document.createElement('section');
  banner.className = 'sb-banner';
  banner.setAttribute('aria-label', 'Section');
  // a friendly flat illustration: a person at a laptop, with a few floating cards (one carries the section's icon)
  var ART = '<svg class="bn-svg" viewBox="0 0 220 132" aria-hidden="true">' +
    '<defs><linearGradient id="bnJ" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9743A"/><stop offset="1" stop-color="#B94F22"/></linearGradient>' +
    '<linearGradient id="bnL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F6E7D3"/></linearGradient></defs>' +
    '<ellipse cx="116" cy="124" rx="84" ry="6" fill="rgba(150,80,30,.16)"/>' +
    /* a small plant on the right */
    '<path d="M176 124l-3-20h22l-3 20z" fill="#E7A26B"/><path d="M174 104h26" stroke="#CB7C45" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M186 102c-12-4-16-16-12-28 10 4 15 14 12 28z" fill="#6FB07A"/><path d="M188 102c8-6 16-6 22-16-12-2-22 6-22 16z" fill="#4F9A63"/><path d="M187 102c-2-10 2-22 9-30 4 12 2 24-9 30z" fill="#8CC595"/>' +
    /* the person */
    '<path d="M80 120c0-27 13-40 32-40s32 13 32 40z" fill="url(#bnJ)"/>' +
    '<path d="M101 80l11 14 11-14z" fill="#FFF6EA"/>' +
    '<path d="M104 76h16v12a8 8 0 0 1-16 0z" fill="#E7B08A"/>' +
    '<circle cx="112" cy="56" r="20" fill="#F6CBA6"/>' +
    '<path d="M91 56c-3-18 9-29 22-28 14 1 21 12 19 27-4-9-11-14-21-14-9 0-15 4-20 15z" fill="#3B2118"/>' +
    '<path d="M130 40c9 3 13 12 10 22-2-9-5-15-10-22z" fill="#3B2118"/>' +
    '<circle cx="105" cy="59" r="2" fill="#3B2118"/><circle cx="119" cy="59" r="2" fill="#3B2118"/>' +
    '<circle cx="100" cy="65" r="3.4" fill="#F29A86" opacity=".55"/><circle cx="124" cy="65" r="3.4" fill="#F29A86" opacity=".55"/>' +
    '<path d="M107 66c3 3.4 7 3.4 10 0" stroke="#B5573A" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    /* the laptop, seen from behind, with a soft glow */
    '<rect x="76" y="86" width="72" height="36" rx="6" fill="url(#bnL)"/>' +
    '<circle cx="112" cy="104" r="9" fill="#FFE2A8" opacity=".6"/><circle cx="112" cy="104" r="5" fill="#F7A21B"/>' +
    '<rect x="68" y="122" width="88" height="5" rx="2.5" fill="#F1DEC4"/>' +
    '<ellipse cx="83" cy="106" rx="7.5" ry="5.5" fill="#F6CBA6"/><ellipse cx="141" cy="106" rx="7.5" ry="5.5" fill="#F6CBA6"/>' +
    /* a few sparkles */
    '<path d="M44 40l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#fff" opacity=".9"/><circle cx="60" cy="96" r="2.6" fill="#fff" opacity=".8"/><circle cx="196" cy="48" r="2.4" fill="#fff" opacity=".85"/>' +
    '</svg>';
  var DEFAULT_ART = ART + '<span class="bn-card bn-c1"><span class="bn-ic" id="bn-ic"></span></span><span class="bn-card bn-c2"></span><span class="bn-card bn-c3"></span>';
  // the Content banner: three hands, one holding a dot, one a photo, one a card, with a few small shapes around them
  var HANDS = '<svg class="bn-svg bn-hands" viewBox="0 0 340 150" aria-hidden="true">' +
    /* small shapes */
    '<path d="M150 14l17 9-17 9z" fill="none" stroke="#E8701A" stroke-width="2.6" stroke-linejoin="round"/>' +
    '<path d="M92 34h11M97.5 28.5v11" stroke="#4A2E22" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M268 22l8 8m0-8l-8 8" stroke="#4A2E22" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M44 124a13 13 0 0 1 26 0" fill="none" stroke="#E8701A" stroke-width="2.8" stroke-linecap="round"/>' +
    '<circle cx="124" cy="22" r="3" fill="#F7B02C"/><circle cx="302" cy="64" r="3.2" fill="#E8701A"/>' +
    /* a white hand reaching in from the top, holding a dot */
    '<g transform="translate(212 -8) rotate(22)"><rect x="8" y="-48" width="38" height="56" rx="8" fill="#fff"/>' +
    '<rect x="0" y="0" width="56" height="46" rx="19" fill="#fff"/>' +
    '<rect x="4" y="40" width="12" height="36" rx="6" fill="#fff"/><rect x="20" y="42" width="12" height="43" rx="6" fill="#fff"/><rect x="36" y="40" width="12" height="34" rx="6" fill="#fff"/>' +
    '<rect x="-12" y="12" width="26" height="13" rx="6.5" fill="#fff" transform="rotate(-20 1 18)"/><circle cx="26" cy="92" r="7" fill="#4A2E22"/></g>' +
    /* an orange hand coming up from the bottom, holding a photo */
    '<rect x="116" y="62" width="64" height="64" rx="7" fill="#3A2018"/><rect x="122" y="68" width="52" height="52" rx="4" fill="#F9D79A"/>' +
    '<circle cx="158" cy="84" r="7" fill="#fff"/><path d="M122 120V102l16-14 14 12 10-8 12 10v18z" fill="#E8701A"/>' +
    '<g transform="rotate(-24 96 128)"><rect x="40" y="104" width="86" height="46" rx="18" fill="#EC7A2A"/></g>' +
    '<rect x="108" y="76" width="26" height="11" rx="5.5" fill="#EC7A2A"/><rect x="106" y="90" width="28" height="11" rx="5.5" fill="#EC7A2A"/><rect x="108" y="104" width="26" height="11" rx="5.5" fill="#EC7A2A"/>' +
    '<rect x="136" y="56" width="13" height="30" rx="6.5" fill="#EC7A2A" transform="rotate(14 142 70)"/>' +
    /* a deep-brown hand from the right, holding a white card with lines */
    '<g transform="rotate(-12 270 104)"><rect x="226" y="82" width="78" height="46" rx="7" fill="#fff"/>' +
    '<rect x="234" y="92" width="34" height="5" rx="2.5" fill="#F7B02C"/><rect x="234" y="102" width="52" height="5" rx="2.5" fill="#E8701A"/><rect x="234" y="112" width="26" height="5" rx="2.5" fill="#D9C2A8"/>' +
    '<rect x="296" y="86" width="64" height="40" rx="16" fill="#4A2E22"/>' +
    '<rect x="290" y="84" width="26" height="11" rx="5.5" fill="#4A2E22"/><rect x="292" y="98" width="26" height="11" rx="5.5" fill="#4A2E22"/><rect x="290" y="112" width="26" height="11" rx="5.5" fill="#4A2E22"/></g>' +
    '</svg>';
  banner.innerHTML = '<div class="bn-art" aria-hidden="true">' + DEFAULT_ART + '</div>' +
    '<div class="bn-text"><h2 id="bn-hi">Hi</h2><p id="bn-msg"></p></div>';
  if (app && appHead) app.insertBefore(banner, appHead);
  function currentKey() {
    var sel = tabs.querySelector('.tab[aria-selected="true"]');
    return sel ? (sel.id || '').replace('tab-', '') : 'library';
  }
  function updateBanner() {
    var d = SECTION[currentKey()] || SECTION.library;
    var st = window.MembersApp && window.MembersApp.state, prof = st && st.profile;
    var nm = (prof && (prof.full_name || '')) || (document.getElementById('who') && document.getElementById('who').textContent.trim()) || '';
    var first = nm.trim().split(/\s+/)[0] || (prof && prof.email ? prof.email.split('@')[0] : '');
    document.getElementById('bn-hi').textContent = first ? 'Hi, ' + first : 'Hello';
    var msg = document.getElementById('bn-msg');
    msg.textContent = '';
    var strong = document.createElement('b');
    strong.textContent = d[1];
    msg.appendChild(strong);
    msg.appendChild(document.createTextNode('. ' + d[2]));
    var key = currentKey(), art = banner.querySelector('.bn-art'), hands = key === 'content';
    if (art.getAttribute('data-hands') !== String(hands)) { art.setAttribute('data-hands', String(hands)); art.innerHTML = hands ? HANDS : DEFAULT_ART; }
    var ic = document.getElementById('bn-ic');
    if (ic && ic.getAttribute('data-k') !== key && window.SngIcon) { ic.innerHTML = window.SngIcon(d[0]); ic.setAttribute('data-k', key); }
  }
  if (window.MutationObserver) new MutationObserver(updateBanner).observe(tabs, { attributes: true, attributeFilter: ['aria-selected'], subtree: true });

  /* ---- the person's card, profile settings and sign out ---- */
  function refreshProfile() {
    var av = document.getElementById('btn-profile'), who = document.getElementById('who');
    var nm = (who && who.textContent.trim()) || '', st = window.MembersApp && window.MembersApp.state;
    var prof = st && st.profile, em = (prof && prof.email) || '';
    var ini = (av && av.textContent.trim()) || (nm || em).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return Array.from(w)[0]; }).join('').toUpperCase();
    var avEl = document.getElementById('sb-av'), pic = av && av.querySelector('img');
    if (pic && pic.getAttribute('src')) {
      if (!avEl.firstChild || avEl.firstChild.tagName !== 'IMG') { avEl.textContent = ''; avEl.appendChild(document.createElement('img')); }
      if (avEl.firstChild.getAttribute('src') !== pic.getAttribute('src')) avEl.firstChild.setAttribute('src', pic.getAttribute('src'));
      avEl.firstChild.alt = '';
      avEl.classList.add('has-photo');
    } else {
      avEl.classList.remove('has-photo');
      avEl.textContent = ini;
    }
    updateBanner();
    document.getElementById('sb-name').textContent = nm || (prof && prof.full_name) || em.split('@')[0] || 'Profile';
    document.getElementById('sb-mail').textContent = em;
  }
  function openProfile() { document.getElementById('btn-profile').click(); }
  document.getElementById('sb-prof').addEventListener('click', openProfile);
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
