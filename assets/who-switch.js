/*
  The Senior Manager / Employee switch on the two sign-in pages. The highlighted pill slides to the other
  side, then the other page opens, and there the pill arrives sliding in from where it was, so the two
  pages feel like one switch. The switch itself is two ordinary links, so it still works without scripts.
  Markup: <div class="who-switch" data-on="sm|emp"> <first: Senior Manager> <second: Employee> </div>
*/
(function () {
  'use strict';
  var KEY = 'sng-who-from';
  var sw = document.querySelectorAll('.who-switch');
  if (!sw.length) return;
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var from = null;
  try { from = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch (e) { from = null; }

  Array.prototype.forEach.call(sw, function (el) {
    var cur = el.getAttribute('data-on');
    if (from && from !== cur && !still) {
      // start on the side we came from, then slide into place
      el.classList.add('no-anim');
      el.setAttribute('data-on', from);
      void el.offsetWidth;
      setTimeout(function () {
        el.classList.remove('no-anim');
        el.setAttribute('data-on', cur);
      }, 40);
    }
    var link = el.querySelector('a');
    if (!link) return;
    link.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault();
      if (still) { window.location.href = link.href; return; }
      try { sessionStorage.setItem(KEY, cur); } catch (x) { /* the slide just won't continue on the next page */ }
      el.setAttribute('data-on', cur === 'sm' ? 'emp' : 'sm');
      setTimeout(function () { window.location.href = link.href; }, 320);
    });
  });
})();
