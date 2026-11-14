/* Drag to reorder the folder cards and file pills of a list.
   The order is remembered on this browser only (localStorage), per list.
     SngReorder.sort(items, scope, keyOf, isFolder)   puts items in the saved order (folders stay before files)
     SngReorder.attach(ul, scopeFn, keyOfLi)          makes the rows of a list draggable; scopeFn() returns '' to turn it off */
(function () {
  'use strict';
  var PREFIX = 'sng-order:';

  function load(scope) {
    try { var v = JSON.parse(localStorage.getItem(PREFIX + scope) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function save(scope, list) {
    try { localStorage.setItem(PREFIX + scope, JSON.stringify(list)); } catch (e) { /* storage may be blocked */ }
  }

  function sort(items, scope, keyOf, isFolder) {
    if (!scope) return items;
    var saved = load(scope);
    if (!saved.length) return items;
    var idx = {};
    saved.forEach(function (k, i) { idx[k] = i; });
    var pos = items.map(function (it, i) { return { it: it, i: i, r: idx.hasOwnProperty(keyOf(it)) ? idx[keyOf(it)] : 1e9 }; });
    pos.sort(function (a, b) {
      if (isFolder && isFolder(a.it) !== isFolder(b.it)) return isFolder(a.it) ? -1 : 1;
      return a.r - b.r || a.i - b.i;
    });
    return pos.map(function (p) { return p.it; });
  }

  // the new order of the rows on screen, merged into the saved list so rows hidden by a filter keep their place
  function commit(scope, ul, keyOfLi) {
    var shown = [].slice.call(ul.children).map(keyOfLi).filter(Boolean);
    var full = load(scope);
    shown.forEach(function (k) { if (full.indexOf(k) === -1) full.push(k); });
    var slots = [];
    full.forEach(function (k, i) { if (shown.indexOf(k) !== -1) slots.push(i); });
    slots.forEach(function (slot, n) { full[slot] = shown[n]; });
    save(scope, full);
  }

  function attach(ul, scopeFn, keyOfLi) {
    if (!ul || ul.dataset.reorder) return;
    ul.dataset.reorder = '1';
    var d = null; // the drag in progress

    function kindOf(li) { return li.classList.contains('fcard') ? 'f' : 'p'; }

    function begin(e, li) {
      var r = li.getBoundingClientRect();
      d = { li: li, id: e.pointerId, x0: e.clientX, y0: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top,
            touch: e.pointerType === 'touch', live: false, timer: null, kind: kindOf(li) };
      if (d.touch) d.timer = setTimeout(function () { if (d && !d.live) start(); }, 320);
    }
    function start() {
      d.live = true;
      d.li.classList.add('rd-drag');
      document.body.classList.add('rd-busy');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (x) { /* not supported */ } }
    }
    function place(e) {
      var li = d.li;
      li.style.transform = 'none';
      var n = li.getBoundingClientRect();
      li.style.transform = 'translate(' + (e.clientX - d.gx - n.left) + 'px,' + (e.clientY - d.gy - n.top) + 'px)';
    }
    function over(e) {
      var sibs = [].slice.call(ul.children).filter(function (s) { return s !== d.li && kindOf(s) === d.kind; });
      for (var i = 0; i < sibs.length; i++) {
        var r = sibs[i].getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          var after = !!(d.li.compareDocumentPosition(sibs[i]) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (after) sibs[i].after(d.li); else sibs[i].before(d.li);
          return;
        }
      }
    }
    function end(commitIt) {
      if (!d) return;
      var cur = d; d = null;
      clearTimeout(cur.timer);
      document.body.classList.remove('rd-busy');
      if (!cur.live) return;
      var li = cur.li;
      li.style.transition = 'transform .22s cubic-bezier(.22,1,.36,1)';
      li.style.transform = '';
      setTimeout(function () { li.style.transition = ''; li.classList.remove('rd-drag'); }, 240);
      // the click that follows a drag must not open the row
      var block = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
      ul.addEventListener('click', block, true);
      setTimeout(function () { ul.removeEventListener('click', block, true); }, 60);
      var scope = scopeFn();
      if (commitIt && scope) commit(scope, ul, keyOfLi);
    }

    ul.addEventListener('pointerdown', function (e) {
      if (d || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (!scopeFn()) return;
      if (e.target.closest('.ib, [data-act="amenu"], a, input, select, textarea')) return;
      var li = e.target.closest('li.lrow');
      if (!li || li.parentNode !== ul || !keyOfLi(li)) return;
      begin(e, li);
    });
    document.addEventListener('pointermove', function (e) {
      if (!d || e.pointerId !== d.id) return;
      if (!d.live) {
        var dist = Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0);
        if (d.touch) { if (dist > 10) { clearTimeout(d.timer); d = null; } return; } // moved before the hold: it is a scroll
        if (dist < 7) return;
        start();
      }
      e.preventDefault();
      place(e);
      over(e);
      place(e);
    });
    document.addEventListener('pointerup', function (e) { if (d && e.pointerId === d.id) end(true); });
    document.addEventListener('pointercancel', function (e) { if (d && e.pointerId === d.id) end(false); });
    // once a touch drag has begun the page must not scroll
    document.addEventListener('touchmove', function (e) { if (d && d.live) e.preventDefault(); }, { passive: false });
    ul.addEventListener('dragstart', function (e) { if (d) e.preventDefault(); });
    ul.addEventListener('contextmenu', function (e) { if (d && d.live) e.preventDefault(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && d && d.live) end(false); });
  }

  window.SngReorder = { sort: sort, attach: attach };
})();
