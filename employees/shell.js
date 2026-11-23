/*
  Employee Portal shell. On desktop the dashboard opens on Home and the Quick Access cards lead to the other sections, with a Back to Home
  button on each; the avatar and Sign out stay in the top bar. Phones and tablets get a floating bar at the bottom.
  The dashboard stays one page in portal.js; this file splits it into sections:
    Home    greeting, Quick Access cards, a "share" bar, and the latest announcements and community posts side by side
    Feeds   announcements and the community
    My Work attendance, evaluations, learning and compensation records
    Files   the file search and the department folders
  portal.js is only asked for one thing: window.EmpPortal.show, to return to the dashboard from a sub-page.
*/
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var home = $('#v-home');
  if (!home) return;

  var SVG = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + d + '</svg>'; };
  var ICON = {
    home: SVG('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
    feeds: SVG('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
    work: SVG('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>'),
    files: SVG('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    profile: SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    clip: SVG('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12l2 2 4-4"/>'),
    book: SVG('<path d="M12 6c-1.8-1.2-4.2-1.7-8-1.7V18c3.8 0 6.2.5 8 1.7 1.8-1.2 4.2-1.7 8-1.7V4.3c-3.8 0-6.2.5-8 1.7z"/><path d="M12 6v13.7"/>'),
    lock: SVG('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    send: SVG('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
    heart: SVG('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>')
  };
  var NAV = [['home', 'Home'], ['feeds', 'Feeds'], ['work', 'My Work'], ['files', 'Files']];
  var HEAD = {
    feeds: ['Feeds', 'Announcements from the Senior Managers, and conversations with your colleagues.'],
    work: ['My Work', 'Your attendance, evaluations, learning and compensation records.'],
    files: ['Files', 'Search documents, or open the folders of each department.']
  };
  var SEC_IMG = { feeds: ['feeds', 344, 330], work: ['evaluations', 349, 363], files: ['files', 327, 333] };
  var QA = [
    ['feeds', 'Feeds', 'Announcements and community', 'feeds', '#ann-panel', 'feeds', 'qa-6', 344, 330],
    ['att', 'Attendance', 'Time in and out', 'attendance', '#att-panel', 'work', 'qa-1', 383, 247],
    ['evl', 'Evaluations', 'Forms to fill in', 'evaluations', '#evl-panel', 'work', 'qa-2', 349, 363],
    ['learn', 'Learning', 'Courses and modules', 'learning', '#learn-panel', 'work', 'qa-3', 358, 303],
    ['files', 'Files', 'Department folders', 'files', '#dept-panel', 'files', 'qa-4', 327, 333],
    ['rec', 'My records', 'Only you see these', 'records', '#rec-panel', 'work', 'qa-5', 332, 334]
  ];

  /* setting "hidden" to the value it already has still counts as a change to the observers below, so only touch it when it differs */
  function setHidden(el, v) { v = !!v; if (el && el.hidden !== v) el.hidden = v; }

  var sec = 'home';
  try { sec = sessionStorage.getItem('sng-emp-sec') || 'home'; } catch (e) { /* no storage */ }
  if (sec !== 'home' && !HEAD[sec]) sec = 'home';
  var feed = 'ann';

  document.body.classList.add('sh');
  document.body.dataset.sec = sec;
  document.body.dataset.feed = feed;

  /* ---- the navigation: a floating bar on phones and tablets (desktop uses the Quick Access cards) ---- */
  var nav = document.createElement('nav');
  nav.className = 'emp-nav';
  nav.id = 'emp-nav';
  nav.setAttribute('aria-label', 'Sections');
  nav.hidden = true;
  nav.innerHTML = '<span class="nv-pill" aria-hidden="true"></span>' + NAV.map(function (n) {
    return '<button type="button" data-go="' + n[0] + '"><span class="nv-ic">' + ICON[n[0]] + '</span><span class="nv-t">' + n[1] + '</span></button>';
  }).join('');
  document.body.appendChild(nav);

  /* ---- the pieces that only the Home section shows ---- */
  var hello = $('.hello', home);
  var share = document.createElement('div');
  share.className = 'hs';
  share.id = 'home-share';
  share.innerHTML = '<h2>Share something with the team</h2><button class="hs-bar" type="button" data-go="post" aria-label="Write a post in the community">' +
    '<span class="hs-t">Write here…</span><span class="hs-btn">' + ICON.send + 'Post now</span></button>';
  var quick = document.createElement('section');
  quick.className = 'qa';
  quick.id = 'home-quick';
  quick.innerHTML = '<div class="sh-h"><h2>Quick Access</h2></div><div class="qa-row">' + QA.map(function (q) {
    return '<button class="qa-c ' + q[6] + '" type="button" data-qa="' + q[0] + '"><span class="qa-t"><b>' + q[1] + '</b><small>' + q[2] + '</small></span><img class="qa-img" src="../assets/quick/' + q[3] + '.webp" alt="" width="' + q[7] + '" height="' + q[8] + '" decoding="async"></button>';
  }).join('') + '</div>';
  var recent = document.createElement('section');
  recent.className = 'rc';
  recent.id = 'home-recent';
  recent.hidden = true;
  var head = document.createElement('div');
  head.className = 'sec-head';
  head.id = 'sec-head';
  head.innerHTML = '<button class="sec-back" type="button" data-go="home" aria-label="Back to Home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>' + ICON.home + '</button>' +
    '<div class="sec-bn"><div class="sec-tx"><h1 id="sec-t"></h1><p id="sec-d"></p></div><img class="sec-img" id="sec-img" alt="" decoding="async"></div>' +
    '<div class="seg" id="feeds-seg" role="group" aria-label="Show"><button type="button" data-feed="ann">Announcements</button><button type="button" data-feed="forum">Community</button></div>';
  var after = hello || home.firstChild;
  after.after(quick, share, recent, head);
  /* a tap on a page banner plays the hover effect (touch screens have no hover), like the greeting banner on Home */
  var tapTimer;
  head.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    var bn = e.target.closest('.sec-bn');
    if (!bn) return;
    bn.classList.add('tapped');
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function () { bn.classList.remove('tapped'); }, 1200);
  });
  var qbox = $('#q', home) && $('#q', home).closest('.sbox');
  if (qbox) qbox.id = 'q-wrap';

  /* ---- what is drawn depends on the section ---- */
  function paint() {
    document.body.dataset.sec = sec;
    document.body.dataset.feed = feed;
    var h = HEAD[sec];
    $('#sec-t').textContent = h ? h[0] : '';
    $('#sec-d').textContent = h ? h[1] : '';
    var si = SEC_IMG[sec], im = $('#sec-img');
    if (si && im && im.getAttribute('data-k') !== si[0]) {
      im.setAttribute('data-k', si[0]);
      im.width = si[1]; im.height = si[2];
      im.src = '../assets/quick/' + si[0] + '.webp';
    }
    Array.prototype.forEach.call($('#feeds-seg').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.feed === feed)); });
    // quick cards for things that are switched off (no courses, no records, attendance not set up) are left out
    QA.forEach(function (q) {
      var card = $('[data-qa="' + q[0] + '"]', quick), panel = $(q[4]);
      if (card) setHidden(card, panel && panel.hidden);
    });
    var forum = $('#forum-panel');
    setHidden(share, !isLoading() && forum && forum.hidden);   // while loading its placeholder shows, so nothing pops in later
    // the bar marks where you are, even on a sub-page (a folder, a course, an evaluation)
    var at = !$('#v-profile').hidden ? 'profile' : !$('#v-dept').hidden ? 'files' : (!$('#v-learn').hidden || !$('#v-eval').hidden) ? 'work' : sec;
    [].slice.call(nav.querySelectorAll('[data-go]')).forEach(function (b) {
      if (b.dataset.go === at) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    placePill();
    setHidden(nav, $('#top-right').hidden);
  }

  /* the round highlight glides to the open page's button (the circle itself is drawn by the stylesheet) */
  function placePill() {
    var cur = nav.querySelector('[aria-current]');
    if (!cur || !cur.offsetWidth) return;
    nav.style.setProperty('--x', (cur.offsetLeft + cur.offsetWidth / 2 - 26) + 'px');
    // the first placement is instant; after that it slides
    if (!nav.classList.contains('nv-ready')) requestAnimationFrame(function () { requestAnimationFrame(function () { nav.classList.add('nv-ready'); }); });
  }
  window.addEventListener('resize', placePill);

  function remember() { try { sessionStorage.setItem('sng-emp-sec', sec); } catch (e) { /* no storage */ } }

  function go(name, then) {
    if (name === 'profile') { var pb = $('#btn-profile'); if (pb) pb.click(); return; }
    if (name === 'post') { feed = 'forum'; name = 'feeds'; then = function () { var o = $('#fc-open'); if (o && !o.hidden) o.click(); }; }
    if (name !== 'home' && !HEAD[name]) name = 'home';
    // a search left open in Files would keep the other sections hidden
    var q = $('#q');
    if (q && q.value) { q.value = ''; q.dispatchEvent(new Event('input')); }
    sec = name;
    remember();
    if (home.hidden && window.EmpPortal) window.EmpPortal.show('home');
    paint();
    window.scrollTo(0, 0);
    if (then) setTimeout(then, 60);
  }

  nav.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  });
  home.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) { go(g.dataset.go); return; }
    var f = e.target.closest('button[data-feed]');   // not any [data-feed]: the page itself carries one
    if (f) { feed = f.dataset.feed; paint(); return; }
    var c = e.target.closest('[data-qa]');
    if (c) {
      var q = QA.filter(function (x) { return x[0] === c.dataset.qa; })[0];
      go(q[5], function () { var p = $(q[4]); if (p) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      return;
    }
    if (e.target.closest('.rc-c a')) return;          // a web address in a card opens the link; the rest of the card goes to Feeds
    var rc = e.target.closest('[data-recent]');
    if (rc) { feed = rc.dataset.recent === 'forum' ? 'forum' : 'ann'; go('feeds'); }
  });

  /* ---- the latest announcements and community posts, side by side on Home ---- */
  var timer;
  function cards(sel, kind) {
    return [].slice.call(document.querySelectorAll(sel)).slice(0, 3).map(function (p) {
      var av = $('.av-sm', p), who = $('.who b', p), when = $('.who span', p), title = $('.post-title', p), body = $('.post-body', p);
      var like = $('.p-like span', p), com = $('[data-replies] span, .p-com span', p), cat = $('.chip', p);
      var pics = [].slice.call(p.querySelectorAll('.ann-img img')).filter(function (i) { return i.getAttribute('src'); }).map(function (i) {
        return '<img src="' + i.getAttribute('src').replace(/"/g, '&quot;') + '" alt="' + (i.getAttribute('alt') || '').replace(/"/g, '&quot;') + '">';
      }).join('');
      var files = [].slice.call(p.querySelectorAll('.fchip')).map(function (f) { return '<span class="rc-file">' + f.innerHTML + '</span>'; }).join('');
      var n = like && /\d/.test(like.textContent) ? like.textContent.replace(/\D+/g, '') : '';
      var c = com && /\d/.test(com.textContent) ? com.textContent.trim() : '';
      return '<article class="rc-c" data-recent="' + kind + '" tabindex="0"><div class="rc-top">' + (av ? av.outerHTML : '') + '<div class="who"><b>' + (who ? who.innerHTML : '') + '</b><span>' + (when ? when.innerHTML : '') + '</span></div>' +
        (kind === 'forum' && cat ? '<span class="chip plain ' + (cat.className.match(/\bcat-[a-z]+\b/) || [''])[0] + '">' + cat.innerHTML + '</span>' : '') + '</div>' +
        (title ? '<h3>' + title.innerHTML + '</h3>' : '') + '<p>' + (body ? body.innerHTML : '') + '</p>' +
        (pics ? '<div class="rc-pics">' + pics + '</div>' : '') + (files ? '<div class="rc-files">' + files + '</div>' : '') +
        (n || c ? '<div class="rc-foot">' + (c ? '<span class="rc-com">' + c + '</span>' : '') + (n ? '<span>' + ICON.heart + n + '</span>' : '') + '</div>' : '') + '</article>';
    });
  }
  function column(title, kind, list) {
    return '<div class="rc-col"><div class="sh-h"><h2>' + title + '</h2><button class="sh-all" type="button" data-recent="' + kind + '">View all</button></div>' +
      (list.length ? '<div class="rc-list">' + list.join('') + '</div>' : '<p class="rc-none">Nothing here yet.</p>') + '</div>';
  }
  /* while the dashboard is still loading, Home shows calm placeholder boxes instead of parts that pop in one by one */
  function isLoading() { return !!$('#ann-feed .skel'); }
  function syncLoading() { home.classList.toggle('is-loading', isLoading()); }
  var SK = '<div class="rc-cols"><div class="rc-col rc-sk"><div class="sk-h"></div><div class="sk-c"></div></div><div class="rc-col rc-sk"><div class="sk-h"></div><div class="sk-c"></div></div></div>';
  function setRecent(html) {
    // the same markup again is left alone, so the boxes do not flash when nothing changed
    if (recent.dataset.sig === html) return;
    recent.dataset.sig = html;
    recent.innerHTML = html;
  }
  function buildRecent() {
    syncLoading();
    if (isLoading()) { setRecent(SK); setHidden(recent, false); return; }
    var anns = cards('#ann-feed article.post', 'ann'), posts = cards('#forum-feed article.post', 'forum');
    var forumOn = !$('#forum-panel').hidden;
    if (!anns.length && !posts.length) { setHidden(recent, true); return; }
    setRecent('<div class="rc-cols' + (forumOn ? '' : ' one') + '">' + column('Recent announcements', 'ann', anns) + (forumOn ? column('Recent posts', 'forum', posts) : '') + '</div>');
    setHidden(recent, false);
  }
  ['#ann-feed', '#forum-feed'].forEach(function (s) {
    var el = $(s);
    if (el) new MutationObserver(function () { syncLoading(); clearTimeout(timer); timer = setTimeout(buildRecent, 120); }).observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
  });
  buildRecent();
  recent.addEventListener('keydown', function (e) {
    if (e.target.closest('a')) return;
    var c = e.target.closest('.rc-c');
    if ((e.key === 'Enter' || e.key === ' ') && c) { e.preventDefault(); feed = c.dataset.recent === 'forum' ? 'forum' : 'ann'; go('feeds'); }
  });

  /* ---- a file with two or more actions (preview, download) gets one dotted menu instead of round buttons ---- */
  var fmenu = document.createElement('ul');
  fmenu.className = 'at-menu am';
  fmenu.setAttribute('role', 'menu');
  fmenu.hidden = true;
  document.body.appendChild(fmenu);
  var fFor = null, fBtn = null, fTimer;
  function decorateFiles() {
    [].forEach.call(document.querySelectorAll('#dept-body .dacts'), function (box) {
      var acts = [].filter.call(box.children, function (x) { return x.classList.contains('dact') && !x.classList.contains('dmore'); });
      if (acts.length < 2 || box.querySelector('.dmore')) return;
      acts.forEach(function (a) { a.classList.add('dorig'); });
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'dact dmore';
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      var name = (box.closest('.dfile') && box.closest('.dfile').querySelector('.dtext b') || {}).textContent || 'file';
      more.setAttribute('aria-label', 'Actions for ' + name);
      more.innerHTML = window.SngIcon ? window.SngIcon('more') : '...';
      box.appendChild(more);
    });
  }
  function closeFMenu() {
    fmenu.hidden = true;
    if (fBtn) fBtn.setAttribute('aria-expanded', 'false');
    fBtn = fFor = null;
  }
  document.addEventListener('click', function (e) {
    var li = e.target.closest('.at-menu.am li[data-fi]');
    if (li && fFor) { var a = fFor[Number(li.dataset.fi)]; closeFMenu(); if (a) a.click(); return; }
    var more = e.target.closest('.dmore');
    if (!more) { if (!fmenu.hidden) closeFMenu(); return; }
    if (fBtn === more) { closeFMenu(); return; }
    closeFMenu();
    fBtn = more;
    fFor = [].filter.call(more.parentNode.children, function (x) { return x.classList.contains('dorig'); });
    fmenu.innerHTML = fFor.map(function (a, i) {
      var label = (a.getAttribute('data-tip') || a.getAttribute('aria-label') || '').replace(/ .*$/, '') || 'Open';
      if (/^open/i.test(a.getAttribute('data-tip') || '')) label = a.getAttribute('data-tip');
      return '<li role="menuitem" tabindex="-1" data-fi="' + i + '"><span>' + label + '</span>' + a.innerHTML + '</li>';
    }).join('');
    fmenu.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    var r = more.getBoundingClientRect(), mw = fmenu.offsetWidth, mh = fmenu.offsetHeight;
    fmenu.style.top = (r.bottom + mh + 12 > window.innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
    fmenu.style.left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8) + 'px';
    if (fmenu.firstChild) fmenu.firstChild.focus();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !fmenu.hidden) { var b2 = fBtn; closeFMenu(); if (b2) b2.focus(); } });
  window.addEventListener('scroll', function () { if (!fmenu.hidden) closeFMenu(); }, { passive: true });
  window.addEventListener('resize', closeFMenu);
  var depBody = $('#dept-body');
  if (depBody) new MutationObserver(function () { clearTimeout(fTimer); fTimer = setTimeout(decorateFiles, 20); }).observe(depBody, { childList: true, subtree: true });

  /* ---- keep the navigation in step with whichever page is showing ---- */
  var watch = new MutationObserver(function () {
    // opening a folder, a course or an evaluation leaves you in the section it belongs to, so Back returns there
    if (!$('#v-dept').hidden) sec = 'files';
    else if (!$('#v-learn').hidden || !$('#v-eval').hidden) sec = 'work';
    paint();
  });
  watch.observe($('#main'), { attributes: true, attributeFilter: ['hidden'], subtree: true });
  watch.observe($('#top-right'), { attributes: true, attributeFilter: ['hidden'] });
  ['#att-panel', '#learn-panel', '#evl-panel', '#rec-panel', '#forum-panel'].forEach(function (s) {
    var el = $(s);
    if (el) watch.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });
  paint();
})();
