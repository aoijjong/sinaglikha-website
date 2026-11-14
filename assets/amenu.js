/* One dotted menu for every row that has two or more action buttons.
   It reads the row's own buttons (their icon and label), hides them, and shows a single "..." button instead.
   Choosing an item clicks the original button, so each screen's existing code keeps working unchanged.
   Rows that already have their own dotted menu (a button with aria-haspopup="menu") are left alone. */
(function () {
  'use strict';
  var menu = null, openBtn = null, queued = false;

  function labelOf(b) { return b.getAttribute('aria-label') || b.getAttribute('data-tip') || b.title || 'Action'; }

  function convert(box) {
    if (box.dataset.am) return;
    var btns = [].slice.call(box.children).filter(function (c) { return c.classList && c.classList.contains('ib'); });
    if (btns.length < 2 || box.querySelector('[aria-haspopup="menu"]')) return;
    box.dataset.am = '1';
    btns.forEach(function (b) { b.classList.add('am-orig'); });
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'ib am-more';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-label', 'More actions');
    more.setAttribute('data-tip', 'More actions');
    more.innerHTML = window.SngIcon ? window.SngIcon('more') : '&hellip;';
    box.appendChild(more);
  }

  function scan(root) {
    var list = [];
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('.lacts')) list.push(root);
    [].forEach.call(root.querySelectorAll ? root.querySelectorAll('.lacts') : [], function (x) { list.push(x); });
    list.forEach(convert);
  }

  function closeMenu(focusBack) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    var b = openBtn; openBtn = null;
    if (b) { b.setAttribute('aria-expanded', 'false'); if (focusBack && document.body.contains(b)) b.focus(); }
  }

  function openMenu(btn) {
    var box = btn.closest('.lacts');
    var origs = [].slice.call(box.querySelectorAll('.am-orig'));
    if (!menu) {
      menu = document.createElement('ul');
      menu.className = 'at-menu am';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;
      document.body.appendChild(menu);
    }
    if (!menu.hidden && openBtn === btn) { closeMenu(true); return; }
    closeMenu(false);
    menu.innerHTML = '';
    origs.forEach(function (o, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'menuitem');
      li.tabIndex = -1;
      if (o.classList.contains('danger')) li.className = 'danger';
      var svg = o.querySelector('svg');
      li.innerHTML = (svg ? svg.outerHTML : '') + '<span></span>';
      li.lastChild.textContent = labelOf(o);
      li._orig = o;
      menu.appendChild(li);
    });
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openBtn = btn;
    menu.style.maxHeight = '';
    var r = btn.getBoundingClientRect(), mh = menu.offsetHeight, mw = menu.offsetWidth, need = mh + 20;
    if (window.innerHeight - r.bottom < need) { window.scrollBy({ top: need - (window.innerHeight - r.bottom), behavior: 'instant' }); r = btn.getBoundingClientRect(); }
    var below = window.innerHeight - r.bottom - 14;
    if (mh > below) menu.style.maxHeight = Math.max(140, below) + 'px';
    menu.style.top = Math.max(8, r.bottom + 6) + 'px';
    menu.style.left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8) + 'px';
    menu.firstChild.focus();
  }

  function pick(li) {
    var o = li._orig;
    closeMenu(false);
    if (o && document.body.contains(o)) o.click();
  }

  document.addEventListener('click', function (e) {
    var li = e.target.closest && e.target.closest('.at-menu.am li');
    if (li && menu && menu.contains(li) && li._orig) { pick(li); return; }
    var more = e.target.closest && e.target.closest('.am-more');
    if (more) { e.stopPropagation(); openMenu(more); return; }
    if (!e.target.closest || !e.target.closest('.at-menu.am')) closeMenu(false);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!menu || menu.hidden || !e.target.closest || !e.target.closest('.at-menu.am')) return;
    var its = [].slice.call(menu.querySelectorAll('li')), k = its.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); its[(k + 1) % its.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); its[(k - 1 + its.length) % its.length].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (its[k]) pick(its[k]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  window.addEventListener('scroll', function () { closeMenu(false); }, true);
  window.addEventListener('resize', function () { closeMenu(false); });

  function run() {
    queued = false;
    scan(document.body);
  }
  new MutationObserver(function (muts) {
    if (queued) return;
    for (var i = 0; i < muts.length; i++) if (muts[i].addedNodes.length) { queued = true; requestAnimationFrame(run); return; }
  }).observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
