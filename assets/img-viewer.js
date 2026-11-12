/*
  SINAGLIKHA file viewer: one full-screen viewer for uploaded images, PDFs and text files, used by the Senior
  Manager Content and 201 Files tabs and by the Employee Portal. Files open on the page itself instead of in a
  new tab. Arrows (and the keyboard) move through the other files in the same list, and there are buttons to
  download the file or open it in its own tab.

  SngViewer.kindOf(name)             'image' (png, jpg, jpeg, gif, webp), 'pdf', 'text' (txt), or '' for anything
                                     the page can't show (Word, Excel and so on: those are downloaded)
  SngViewer.isImage(name)            true for images
  SngViewer.open(items, index)       items = [{ name, sub, kind, src, download, onView }]
    name      the title shown on top
    sub       a short line under it (a folder or department)
    kind      'image', 'pdf' or 'text'; when missing it is worked out from the name (a title may have no extension,
              so callers that know the stored file's type pass it)
    src       a function that returns (or resolves to) the file's web address; it is called only when that file is
              shown, so short-lived links are made on demand and nothing is fetched in advance
    download  optional, the same but for a link that saves the file
    onView    optional, called each time the file is shown (used for the activity log)

  PDFs are drawn page by page with pdf.js, loaded from the same pinned, integrity-checked file the 201 Files
  viewer uses, and only the first time a PDF is opened.
*/
(function () {
  'use strict';
  var KINDS = [[/\.(png|jpe?g|gif|webp)$/i, 'image'], [/\.pdf$/i, 'pdf'], [/\.txt$/i, 'text']];
  var PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
  var PDFJS_SRI = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';
  var ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  var MAX_TEXT = 1048576;
  var el = null, pdfjsReady = null;
  var S = { items: [], i: 0, token: 0, back: null, kind: '', zoom: 2, doc: null, pages: [], io: null };

  function $(s) { return el.querySelector(s); }
  function kindOf(name) {
    name = String(name || '');
    for (var k = 0; k < KINDS.length; k++) if (KINDS[k][0].test(name)) return KINDS[k][1];
    return '';
  }

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsReady) {
      pdfjsReady = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = PDFJS_BASE + 'pdf.min.js';
        sc.integrity = PDFJS_SRI;
        sc.crossOrigin = 'anonymous';
        sc.onload = function () {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        sc.onerror = function () { pdfjsReady = null; reject(new Error('The PDF viewer could not load')); };
        document.head.appendChild(sc);
      });
    }
    return pdfjsReady;
  }

  function build() {
    el = document.createElement('dialog');
    el.className = 'sv';
    el.setAttribute('aria-label', 'File viewer');
    el.innerHTML =
      '<div class="sv-in">' +
        '<div class="sv-top">' +
          '<button class="sv-btn" type="button" data-sv="prev" aria-label="Previous file"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>' +
          '<div class="sv-t"><b id="sv-title"></b><span id="sv-sub"></span></div>' +
          '<button class="sv-btn" type="button" data-sv="next" aria-label="Next file"><svg class="flip" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>' +
          '<button class="sv-btn" type="button" data-sv="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div class="sv-stage" id="sv-stage">' +
          '<span class="sv-msg" id="sv-msg" role="status"></span>' +
          '<img id="sv-img" alt="" hidden>' +
          '<div class="sv-doc" id="sv-doc" hidden></div>' +
          '<pre class="sv-text" id="sv-text" hidden></pre>' +
        '</div>' +
        '<div class="sv-foot">' +
          '<span id="sv-count"></span>' +
          '<span class="sv-zoomer" id="sv-zoomer" hidden>' +
            '<button class="sv-link" type="button" data-sv="zout" aria-label="Zoom out">−</button>' +
            '<button class="sv-link" type="button" data-sv="zreset" id="sv-zlabel" aria-label="Fit to width">100%</button>' +
            '<button class="sv-link" type="button" data-sv="zin" aria-label="Zoom in">+</button>' +
          '</span>' +
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
    // a late "closed" signal must not wipe a viewer that was opened again in the meantime
    el.addEventListener('close', function () { if (!el.open) release(); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    $('#sv-img').addEventListener('click', function () { act('zoom'); });
    $('#sv-doc').addEventListener('scroll', function () {
      if (S.ticking) return;
      S.ticking = true;
      requestAnimationFrame(function () { S.ticking = false; pageCount(); });
    }, { passive: true });
    window.addEventListener('resize', function () {
      if (!el.open || S.kind !== 'pdf' || !S.pages.length) return;
      clearTimeout(S.rt);
      S.rt = setTimeout(layoutPdf, 150);
    });
  }

  // let the page scroll again and hand the focus back; safe to run twice (the close button and the dialog's own
  // close event both call it, and Escape reaches it only through the event)
  function release() {
    document.documentElement.style.overflow = '';
    S.token++;
    clearDoc();
    var b = S.back;
    S.back = null;
    if (b && b.focus) { try { b.focus(); } catch (x) { /* the opener may be gone */ } }
  }

  function close() {
    if (el && el.open) el.close();
    release();
  }

  function clearDoc() {
    if (S.io) { S.io.disconnect(); S.io = null; }
    S.pages.forEach(function (p) { if (p.task) { try { p.task.cancel(); } catch (e) { /* already done */ } } });
    if (S.doc) { try { S.doc.destroy(); } catch (e) { /* already gone */ } }
    S.doc = null;
    S.pages = [];
    if (el) { $('#sv-doc').innerHTML = ''; $('#sv-text').textContent = ''; }
  }

  function resolve(item) {
    if (item._url) return Promise.resolve(item._url);
    return Promise.resolve().then(function () { return item.src(); }).then(function (u) {
      if (!u) throw new Error('no address');
      item._url = u;
      return u;
    });
  }

  /* ---------- PDFs ---------- */
  function zoomLabel() {
    $('#sv-zlabel').textContent = Math.round(ZOOMS[S.zoom] * 100) + '%';
    el.querySelector('[data-sv=zout]').disabled = S.zoom <= 0;
    el.querySelector('[data-sv=zin]').disabled = S.zoom >= ZOOMS.length - 1;
  }
  function unrender(p) {
    if (p.task) { try { p.task.cancel(); } catch (e) { /* already done */ } p.task = null; }
    p.canvas.width = 0;
    p.canvas.height = 0;
    p.drawnW = 0;
  }
  async function renderPage(p) {
    var cssW = p.cssW;
    if (p.drawnW === cssW || p.drawing === cssW) return;
    var token = S.token;
    p.drawing = cssW;
    if (p.task) { try { p.task.cancel(); } catch (e) { /* already done */ } }
    try {
      var page = await S.doc.getPage(p.num);
      if (token !== S.token) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      dpr = Math.min(dpr, 4096 / cssW, 4096 / p.cssH);
      var vp = page.getViewport({ scale: (cssW / p.baseW) * dpr });
      p.canvas.width = Math.floor(vp.width);
      p.canvas.height = Math.floor(vp.height);
      p.task = page.render({ canvasContext: p.canvas.getContext('2d'), viewport: vp });
      await p.task.promise;
      p.drawnW = cssW;
    } catch (err) {
      /* a cancelled draw (zoomed or scrolled away) is expected; anything else leaves the page blank */
    } finally {
      if (p.drawing === cssW) p.drawing = 0;
    }
  }
  function layoutPdf() {
    var host = $('#sv-doc'), avail = Math.max(160, host.clientWidth - (window.innerWidth <= 560 ? 16 : 32));
    var w = avail * ZOOMS[S.zoom];
    S.pages.forEach(function (p) {
      p.cssW = Math.round(w);
      p.cssH = Math.round(w * p.baseH / p.baseW);
      p.box.style.width = p.cssW + 'px';
      p.box.style.height = p.cssH + 'px';
      if (p.drawnW && p.drawnW !== p.cssW) unrender(p);
      if (p.visible) renderPage(p);
    });
    zoomLabel();
    pageCount();
  }
  function setZoom(i) {
    i = Math.max(0, Math.min(ZOOMS.length - 1, i));
    if (i === S.zoom) return;
    var host = $('#sv-doc'), ratio = host.scrollTop / (host.scrollHeight || 1);
    S.zoom = i;
    layoutPdf();
    host.scrollTop = ratio * host.scrollHeight;
  }
  function pageCount() {
    if (!S.pages.length) return;
    var host = $('#sv-doc'), top = host.getBoundingClientRect().top + host.clientHeight * 0.35, cur = S.pages.length;
    for (var n = 0; n < S.pages.length; n++) {
      if (S.pages[n].box.getBoundingClientRect().bottom > top) { cur = n + 1; break; }
    }
    var files = S.items.length > 1 ? (S.i + 1) + ' of ' + S.items.length + ' · ' : '';
    $('#sv-count').textContent = files + (S.pages.length === 1 ? '1 page' : 'Page ' + cur + ' of ' + S.pages.length);
  }
  async function showPdf(url, token) {
    var msg = $('#sv-msg'), host = $('#sv-doc');
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('fetch');
      var buf = await res.arrayBuffer();
      if (token !== S.token) return;
      var lib = await loadPdfJs();
      var doc = await lib.getDocument({ data: buf }).promise;
      if (token !== S.token) { doc.destroy(); return; }
      S.doc = doc;
      var frag = document.createDocumentFragment();
      for (var n = 1; n <= doc.numPages; n++) {
        var page = await doc.getPage(n);
        if (token !== S.token) return;
        var vp = page.getViewport({ scale: 1 });
        var box = document.createElement('div');
        box.className = 'sv-pg';
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', 'Page ' + n + ' of ' + doc.numPages);
        var canvas = document.createElement('canvas');
        box.appendChild(canvas);
        frag.appendChild(box);
        S.pages.push({ num: n, box: box, canvas: canvas, baseW: vp.width, baseH: vp.height, cssW: 0, cssH: 0, drawnW: 0, drawing: 0, task: null, visible: false });
      }
      host.appendChild(frag);
      S.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var p = S.pages.filter(function (x) { return x.box === en.target; })[0];
          if (!p) return;
          p.visible = en.isIntersecting;
          if (en.isIntersecting) renderPage(p); else unrender(p);
        });
      }, { root: host, rootMargin: '1200px 0px' });
      S.pages.forEach(function (p) { S.io.observe(p.box); });
      msg.hidden = true;
      host.hidden = false;
      host.scrollTop = 0;
      layoutPdf();
    } catch (err) {
      if (token !== S.token) return;
      msg.textContent = err && err.name === 'PasswordException'
        ? "This PDF is password-protected, so it can't be previewed. Download it to open it."
        : "This PDF couldn't be displayed. You can still download it.";
      msg.hidden = false;
    }
  }

  /* ---------- text, images, and the switch between them ---------- */
  async function showText(url, token) {
    var msg = $('#sv-msg'), pre = $('#sv-text');
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('fetch');
      var text = await res.text();
      if (token !== S.token) return;
      pre.textContent = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n\n[Only the first part is shown. Download the file to read all of it.]' : text;
      msg.hidden = true;
      pre.hidden = false;
      pre.scrollTop = 0;
    } catch (err) {
      if (token === S.token) { msg.textContent = "Couldn't show that file. You can still download it."; msg.hidden = false; }
    }
  }

  function show(i) {
    var n = S.items.length;
    if (!n) return;
    S.i = (i + n) % n;
    var it = S.items[S.i], token = ++S.token;
    S.kind = it.kind || kindOf(it.name);
    clearDoc();
    $('#sv-title').textContent = it.name || 'File';
    $('#sv-sub').textContent = it.sub || '';
    $('#sv-count').textContent = n > 1 ? (S.i + 1) + ' of ' + n : '';
    el.querySelector('[data-sv=prev]').hidden = el.querySelector('[data-sv=next]').hidden = n < 2;
    el.querySelector('[data-sv=save]').hidden = !it.download;
    var img = $('#sv-img'), msg = $('#sv-msg'), stage = $('#sv-stage');
    stage.classList.remove('zoom');
    $('[data-sv=zoom]').textContent = 'Actual size';
    $('[data-sv=zoom]').hidden = S.kind !== 'image';
    $('#sv-zoomer').hidden = S.kind !== 'pdf';
    S.zoom = 2;
    img.hidden = true;
    $('#sv-doc').hidden = true;
    $('#sv-text').hidden = true;
    msg.textContent = 'Loading…';
    msg.hidden = false;
    resolve(it).then(function (url) {
      if (token !== S.token) return;
      if (it.onView) { try { it.onView(); } catch (x) { /* logging must never stop the viewer */ } }
      if (S.kind === 'pdf') { showPdf(url, token); return; }
      if (S.kind === 'text') { showText(url, token); return; }
      img.onload = function () { if (token === S.token) { msg.hidden = true; img.hidden = false; } };
      img.onerror = function () { if (token === S.token) { msg.textContent = "Couldn't show that image."; } };
      img.alt = it.name || '';
      img.src = url;
      // the next image is prepared in the background so the arrow feels instant
      if (n > 1) {
        var nx = S.items[(S.i + 1) % n];
        if ((nx.kind || kindOf(nx.name)) === 'image') resolve(nx).then(function (u) { new Image().src = u; }, function () { /* tried again when shown */ });
      }
    }, function () {
      if (token === S.token) msg.textContent = "Couldn't open that file. You may not have permission.";
    });
  }

  function go(d) { if (S.items.length > 1) show(S.i + d); }

  function act(a) {
    var it = S.items[S.i];
    if (a === 'close') close();
    else if (a === 'prev') go(-1);
    else if (a === 'next') go(1);
    else if (a === 'zin') setZoom(S.zoom + 1);
    else if (a === 'zout') setZoom(S.zoom - 1);
    else if (a === 'zreset') setZoom(2);
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
      }, function () { $('#sv-msg').textContent = "Couldn't download that file."; $('#sv-msg').hidden = false; });
    }
  }

  window.SngViewer = {
    kindOf: kindOf,
    isImage: function (name) { return kindOf(name) === 'image'; },
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
