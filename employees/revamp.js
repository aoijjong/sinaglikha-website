/*
  Employee Portal touches (portal.js is not changed except for two data attributes):
    - on desktop (1025px and wider) the greeting becomes a hero banner with an illustration
    - announcements and community posts are drawn as cards; each gets a heart you can tap (kept on this browser only)
    - the "Start a discussion" button reads like a post box: "What's up, Maria?"
*/
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var home = $('#v-home');
  if (!home) return;

  /* ---- the hero banner (drawn by the stylesheet on desktop only) ---- */
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
    hello.appendChild(text);
    hello.appendChild(art);
  }

  /* ---- "What's up, Maria?" on the post box ---- */
  var open = $('#fc-open');
  function paintOpen() {
    var h = ($('#h-hello') || {}).textContent || '', first = h.replace(/^Hello,?\s*/, '').trim();
    var t = $('#fc-open-t');
    if (t) t.textContent = first ? 'What’s up, ' + first + '?' : 'What’s up?';
  }
  if (open && $('#h-hello')) {
    new MutationObserver(paintOpen).observe($('#h-hello'), { childList: true, characterData: true, subtree: true });
    paintOpen();
  }

  /* ---- the heart on every announcement and community post ---- */
  var KEY = 'sng-likes';
  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  function loadLikes() { try { var v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  function saveLikes(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage may be blocked */ } }
  function keyOf(card) {
    if (card.dataset.aid) return 'a:' + card.dataset.aid;
    if (card.dataset.thread) return 't:' + card.dataset.thread;
    return '';
  }
  function decorate(feed) {
    var likes = loadLikes();
    [].forEach.call(feed.querySelectorAll('article.post'), function (card) {
      var k = keyOf(card);
      if (!k || card.querySelector('.p-like')) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'p-like';
      b.setAttribute('aria-pressed', likes[k] ? 'true' : 'false');
      b.innerHTML = HEART + '<span>' + (likes[k] ? 'Liked' : 'Like') + '</span>';
      b.dataset.key = k;
      if (card.dataset.aid) card.appendChild(b);
      else { var foot = card.querySelector('.post-foot'); if (foot) foot.insertBefore(b, foot.firstChild); }
      // announcements posted in the last three days are marked New
      if (card.dataset.aid && !card.querySelector('.ann-new')) {
        var when = (card.querySelector('.who span') || {}).textContent || '';
        if (/just now|min ago|\bh ago|^[1-3] d ago|·\s*[1-3] d ago/.test(when)) {
          var n = document.createElement('span'); n.className = 'ann-new'; n.textContent = 'New'; card.appendChild(n);
        }
      }
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.p-like');
    if (!b) return;
    var likes = loadLikes(), k = b.dataset.key, on = b.getAttribute('aria-pressed') !== 'true';
    if (on) likes[k] = 1; else delete likes[k];
    saveLikes(likes);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.lastChild.textContent = on ? 'Liked' : 'Like';
  });
  ['#ann-feed', '#forum-feed'].forEach(function (s) {
    var feed = $(s);
    if (!feed) return;
    new MutationObserver(function () { decorate(feed); }).observe(feed, { childList: true });
    decorate(feed);
  });
})();
