/*
  SINAGLIKHA image viewer: one full-screen viewer for uploaded images, used by the Senior Manager Content and
  201 Files tabs and by the Employee Portal. It works like the poster viewer on the Careers page: the image
  fills the screen, arrows (and the keyboard) move through the other images in the same list, and there are
  buttons to download the image or open it in its own tab.

  SngViewer.isImage(name)            true for png, jpg, jpeg, gif and webp file names
  SngViewer.open(items, index)       items = [{ name, sub, src, download, onView }]
    name      the title shown on top
    sub       a short line under it (a folder or department)
    src       a function that returns (or resolves to) the image's web address; it is called only when that
              image is shown, so short-lived links are made on demand and nothing is fetched in advance
    download  optional, the same but for a link that saves the file
    onView    optional, called each time the image is shown (used for the activity log)
*/
(function () {
  'use strict';
  var IMG = /\.(png|jpe?g|gif|webp)$/i;
  var el = null, S = { items: [], i: 0, token: 0, back: null };

  function $(s) { return el.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function build() {
    el = document.createElement('dialog');
    el.className = 'sv';
    el.setAttribute('aria-label', 'Image viewer');
    el.innerHTML =
      '<div class="sv-in">' +
        '<div class="sv-top">' +
          '<button class="sv-btn" type="button" data-sv="prev" aria-label="Previous image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>' +
          '<div class="sv-t"><b id="sv-title"></b><span id="sv-sub"></span></div>' +
          '<button class="sv-btn" type="button" data-sv="next" aria-label="Next image"><svg class="flip" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>' +
          '<button class="sv-btn" type="button" data-sv="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div class="sv-stage" id="sv-stage"><span class="sv-msg" id="sv-msg" role="status"></span><img id="sv-img" alt="" hidden></div>' +
        '<div class="sv-foot">' +
          '<span id="sv-count"></span>' +
          '<button class="sv-link" type="button" data-sv="zoom">Actual size</button>' +
          '<button class="sv-link" type="button" data-sv="tab">Open in a new tab</button>' +
          '<button class="sv-link" type="button" data-sv="save">Download</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sv]');
      if (b) { act(b.dataset.sv); return; }
      if (e.target === el || e.target.classList.contains('sv-in') || e.target.id === 'sv-stage') close();
    });
    el.addEventListener('close', release);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    $('#sv-img').addEventListener('click', function () { act('zoom'); });
  }

  // let the page scroll again and hand the focus back; safe to run twice (the close button and the dialog's own
  // close event both call it, and Escape reaches it only through the event)
  function release() {
    document.documentElement.style.overflow = '';
    S.token++;
    var b = S.back;
    S.back = null;
    if (b && b.focus) { try { b.focus(); } catch (x) { /* the opener may be gone */ } }
  }

  function close() {
    if (el && el.open) el.close();
    release();
  }

  function resolve(item) {
    if (item._url) return Promise.resolve(item._url);
    return Promise.resolve().then(function () { return item.src(); }).then(function (u) {
      if (!u) throw new Error('no address');
      item._url = u;
      return u;
    });
  }

  function show(i) {
    var n = S.items.length;
    if (!n) return;
    S.i = (i + n) % n;
    var it = S.items[S.i], token = ++S.token;
    $('#sv-title').textContent = it.name || 'Image';
    $('#sv-sub').textContent = it.sub || '';
    $('#sv-count').textContent = n > 1 ? (S.i + 1) + ' of ' + n : '';
    el.querySelector('[data-sv=prev]').hidden = el.querySelector('[data-sv=next]').hidden = n < 2;
    el.querySelector('[data-sv=save]').hidden = !it.download;
    var img = $('#sv-img'), msg = $('#sv-msg'), stage = $('#sv-stage');
    stage.classList.remove('zoom');
    $('[data-sv=zoom]').textContent = 'Actual size';
    img.hidden = true;
    msg.textContent = 'Loading…';
    msg.hidden = false;
    resolve(it).then(function (url) {
      if (token !== S.token) return;
      img.onload = function () { if (token === S.token) { msg.hidden = true; img.hidden = false; } };
      img.onerror = function () { if (token === S.token) { msg.textContent = "Couldn't show that image."; } };
      img.alt = it.name || '';
      img.src = url;
      if (it.onView) { try { it.onView(); } catch (x) { /* logging must never stop the viewer */ } }
      // the next image is prepared in the background so the arrow feels instant
      if (n > 1) { var nx = S.items[(S.i + 1) % n]; resolve(nx).then(function (u) { new Image().src = u; }, function () { /* tried again when shown */ }); }
    }, function () {
      if (token === S.token) msg.textContent = "Couldn't open that image. You may not have permission.";
    });
  }

  function go(d) { if (S.items.length > 1) show(S.i + d); }

  function act(a) {
    var it = S.items[S.i];
    if (a === 'close') close();
    else if (a === 'prev') go(-1);
    else if (a === 'next') go(1);
    else if (a === 'zoom') {
      var z = $('#sv-stage').classList.toggle('zoom');
      $('[data-sv=zoom]').textContent = z ? 'Fit to screen' : 'Actual size';
    } else if (a === 'tab' && it) {
      resolve(it).then(function (u) { window.open(u, '_blank', 'noopener'); }, function () { /* the message is already on screen */ });
    } else if (a === 'save' && it && it.download) {
      Promise.resolve().then(function () { return it.download(); }).then(function (u) {
        if (!u) return;
        var l = document.createElement('a');
        l.href = u;
        l.download = it.name || '';
        document.body.appendChild(l);
        l.click();
        l.remove();
      }, function () { $('#sv-msg').textContent = "Couldn't download that image."; $('#sv-msg').hidden = false; });
    }
  }

  window.SngViewer = {
    isImage: function (name) { return IMG.test(String(name || '')); },
    open: function (items, index) {
      if (!items || !items.length) return;
      if (!el) build();
      S.items = items.map(function (x) { return Object.assign({}, x); });
      S.back = document.activeElement;
      document.documentElement.style.overflow = 'hidden';
      if (!el.open) el.showModal();
      show(Math.max(0, Math.min(index || 0, S.items.length - 1)));
      el.querySelector('[data-sv=close]').focus();
    }
  };
})();
