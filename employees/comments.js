/*
  Comments on announcements (Employee Portal).
  Every announcement card gets a "Comment" button next to its heart. Tapping it opens the comments under
  the post, with a box to write one. Comments are kept on the server (api/employee-comments.js); the
  count shows on the button. Text is always shown as plain text, never as HTML.
*/
(function () {
  'use strict';
  var feed = document.getElementById('ann-feed');
  if (!feed) return;

  var CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.7 8.7 0 0 1-3.6-.8L3 21l1.9-5.3A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/></svg>';
  var SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';
  var TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>';
  var FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/></svg>';
  var TINTS = ['#FFE7A8', '#FBD2B0', '#F6C9C0', '#D8E6C4', '#CFE3F1', '#E4D6F0'];
  var PHOTO_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
  var counts = {};      // announcement id -> number of comments

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function initials(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] ? Array.from(w[0])[0] : '?') + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
  }
  function avatar(name, photo) {
    if (photo && PHOTO_OK.test(photo)) return '<span class="av-sm has-pic"><img src="' + photo + '" alt=""></span>';
    var h = 0;
    String(name).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return '<span class="av-sm" style="background:' + TINTS[h % TINTS.length] + '" aria-hidden="true">' + esc(initials(name)) + '</span>';
  }
  function ago(iso) {
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
    var x = new Date(iso);
    return isNaN(x) ? '' : x.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  async function api(method, path, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    try { var r = await fetch(path, opts); return { ok: r.ok, status: r.status, data: await r.json().catch(function () { return {}; }) }; }
    catch (e) { return { ok: false, status: 0, data: {} }; }
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.className = 'toast'; }, 4200);
  }

  function label(n) { return n > 0 ? n + (n === 1 ? ' comment' : ' comments') : 'Comment'; }
  function paintCount(id) {
    var b = feed.querySelector('.p-com[data-acom="' + id + '"]');
    if (!b) return;
    // only when the words change: writing the same text again would count as a change and wake the observer below for ever
    var n = counts[id] || 0, s = b.lastChild;
    if (s.textContent !== label(n)) s.textContent = label(n);
    if (b.dataset.n !== String(n)) b.dataset.n = String(n);
  }

  /* ---- the button row and the comment box under each announcement ---- */
  function decorate() {
    var fresh = [];
    [].forEach.call(feed.querySelectorAll('article.post[data-aid]'), function (card) {
      var id = card.dataset.aid, foot = card.querySelector(':scope > .ann-foot');
      if (!foot) {
        foot = document.createElement('div');
        foot.className = 'ann-foot';
        foot.innerHTML = '<button class="p-com" type="button" data-acom="' + esc(id) + '" aria-expanded="false" data-n="0">' + CHAT + '<span>Comment</span></button>';
        card.appendChild(foot);
        var box = document.createElement('div');
        box.className = 'ann-cm';
        box.hidden = true;
        card.appendChild(box);
        card.classList.add('has-cm');
        fresh.push(id);
      }
      // the heart lives in the same row, so it stays beside the comment button when the box opens
      var like = card.querySelector(':scope > .p-like');
      if (like) foot.appendChild(like);
      if (counts[id] !== undefined) paintCount(id);
    });
    if (fresh.length) loadCounts(fresh);
  }
  async function loadCounts(ids) {
    ids = ids.slice(0, 60);
    var r = await api('GET', '/api/employee-comments?counts=' + encodeURIComponent(ids.join(',')));
    if (!r.ok || !r.data.counts) return;
    ids.forEach(function (id) { counts[id] = r.data.counts[id] || 0; paintCount(id); });
  }

  function commentHtml(c, photos) {
    return '<div class="reply" data-cid="' + esc(c.id) + '"><div class="post-top">' + avatar(c.author, photos[c.pic]) +
      '<div class="who"><b>' + esc(c.author) + (c.mine ? ' (you)' : '') + '</b><span>' + esc(ago(c.created_at)) + '</span></div>' +
      (c.mine ? '<button class="pbtn push" type="button" data-cdel="' + esc(c.id) + '">' + TRASH + '<span>Delete</span></button>'
        : '<button class="pbtn push" type="button" data-crep="' + esc(c.id) + '">' + FLAG + '<span>Report</span></button>') +
      '</div><p>' + esc(c.body).replace(/\n/g, '<br>') + '</p></div>';
  }
  function formHtml(id) {
    return '<form class="rcmp" data-cform="' + esc(id) + '" novalidate><label class="sr-only" for="ac-' + esc(id) + '">Your comment</label>' +
      '<textarea id="ac-' + esc(id) + '" maxlength="1000" rows="1" placeholder="Write a comment…"></textarea>' +
      '<button class="btn btn-primary btn-sm ac-send" type="submit" aria-label="Send comment">' + SEND + '<span>Send</span></button></form>' +
      '<p class="msg bad" role="alert" hidden style="margin-top:8px"></p>';
  }

  async function openBox(card) {
    var id = card.dataset.aid, box = card.querySelector(':scope > .ann-cm'), btn = card.querySelector('.p-com');
    box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    box.innerHTML = '<div class="skel" style="width:60%;margin:8px 0"></div>';
    var r = await api('GET', '/api/employee-comments?announcement=' + encodeURIComponent(id));
    if (r.status === 401) { location.reload(); return; }
    if (!r.ok) { box.innerHTML = '<p class="fine">' + esc(r.data.error || "Couldn't load the comments.") + '</p>'; return; }
    var photos = r.data.photos || [], list = r.data.comments || [];
    counts[id] = list.length;
    paintCount(id);
    box.innerHTML = (list.length ? list.map(function (c) { return commentHtml(c, photos); }).join('') : '<p class="fine ac-none">No comments yet. Be the first to comment.</p>') + formHtml(id);
  }
  function closeBox(card) {
    card.querySelector(':scope > .ann-cm').hidden = true;
    card.querySelector('.p-com').setAttribute('aria-expanded', 'false');
  }

  async function send(form) {
    var id = form.dataset.cform, ta = form.querySelector('textarea'), msg = form.nextElementSibling, btn = form.querySelector('button');
    var text = ta.value.trim();
    if (!text) { msg.textContent = 'Write a comment first.'; msg.hidden = false; return; }
    msg.hidden = true;
    btn.disabled = true;
    var r = await api('POST', '/api/employee-comments', { action: 'add', announcement_id: id, body: text });
    btn.disabled = false;
    if (r.status === 401) { location.reload(); return; }
    if (!r.ok) { msg.textContent = r.data.error || "Couldn't post that."; msg.hidden = false; return; }
    toast('Comment posted.');
    var card = feed.querySelector('article.post[data-aid="' + id + '"]');
    if (card) openBox(card);
  }
  async function remove(cid, btn) {
    var row = btn.closest('.reply'), card = btn.closest('article.post');
    btn.disabled = true;
    var r = await api('POST', '/api/employee-comments', { action: 'delete', comment_id: cid });
    if (!r.ok) { btn.disabled = false; toast(r.data.error || "Couldn't delete that."); return; }
    toast('Comment deleted.');
    var id = card.dataset.aid;
    counts[id] = Math.max(0, (counts[id] || 1) - 1);
    paintCount(id);
    row.remove();
    var box = card.querySelector(':scope > .ann-cm');
    if (!box.querySelector('.reply') && !box.querySelector('.ac-none')) box.insertAdjacentHTML('afterbegin', '<p class="fine ac-none">No comments yet. Be the first to comment.</p>');
  }

  async function report(cid, btn) {
    if (!window.confirm('Report this comment to the moderators?')) return;
    btn.disabled = true;
    var r = await api('POST', '/api/employee-comments', { action: 'report', comment_id: cid });
    if (!r.ok) { btn.disabled = false; toast(r.data.error || "Couldn't send that report."); return; }
    btn.querySelector('span').textContent = 'Reported';
    toast('Thanks. A moderator will take a look.');
  }

  feed.addEventListener('click', function (e) {
    var rp = e.target.closest('[data-crep]');
    if (rp) { report(rp.dataset.crep, rp); return; }
    var b = e.target.closest('.p-com');
    if (b) {
      var card = b.closest('article.post');
      if (b.getAttribute('aria-expanded') === 'true') closeBox(card); else openBox(card);
      return;
    }
    var d = e.target.closest('[data-cdel]');
    if (d) remove(d.dataset.cdel, d);
  });
  feed.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-cform]');
    if (!f) return;
    e.preventDefault();
    send(f);
  });

  new MutationObserver(decorate).observe(feed, { childList: true, subtree: true });
  decorate();
})();
