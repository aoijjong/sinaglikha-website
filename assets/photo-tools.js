/*
  Photo helpers for replies and comments (Employee Portal).

    SngPhotoTools.picker({ add: <button>, thumbs: <ul>, max: 3, onError: fn })   a small "pick photos" control: the button opens the
        phone's picker, each chosen photo is shrunk and shown as a thumbnail with a remove button. Returns { blobs(), count(), clear() }.
    SngPhotoTools.upload(blobs, reserve, confirm)   sends photos one at a time: reserve(blob) asks the server for a one-time upload
        address, the file goes straight to storage, confirm(id) tells the server it arrived. Returns how many failed.

  A photo is redrawn onto a canvas and saved as a JPEG no bigger than 1600 px, which keeps uploads small and drops the hidden camera
  details (such as the location) that a photo file can carry.
*/
(function (root) {
  'use strict';
  var MAX_BYTES = 3 * 1024 * 1024;

  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { if (b && b.size <= MAX_BYTES) resolve(b); else reject(new Error('large')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('read')); };
      img.src = url;
    });
  }

  function picker(o) {
    var max = o.max || 3, items = [];
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif'; input.multiple = true; input.hidden = true;
    o.add.parentNode.insertBefore(input, o.add.nextSibling);
    function draw() {
      o.thumbs.innerHTML = '';
      items.forEach(function (p, i) {
        var li = document.createElement('li'), im = document.createElement('img'), x = document.createElement('button');
        im.src = p.url; im.alt = 'Photo ' + (i + 1) + ' to attach';
        x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove photo ' + (i + 1)); x.dataset.rm = String(i);
        li.appendChild(im); li.appendChild(x); o.thumbs.appendChild(li);
      });
      o.add.hidden = items.length >= max;
    }
    o.add.addEventListener('click', function () { input.click(); });
    o.thumbs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rm]');
      if (!b) return;
      var gone = items.splice(Number(b.dataset.rm), 1)[0];
      if (gone) URL.revokeObjectURL(gone.url);
      draw();
    });
    input.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(input.files || []), bad = 0, over = false;
      input.value = '';
      for (var i = 0; i < files.length; i++) {
        if (items.length >= max) { over = true; break; }
        if (files[i].size > 25 * 1024 * 1024) { bad++; continue; }
        try { var b = await shrink(files[i]); items.push({ blob: b, url: URL.createObjectURL(b) }); } catch (e) { bad++; }
      }
      draw();
      if (o.onError) o.onError(over ? 'You can attach up to ' + max + ' photos.' : bad ? (bad === 1 ? "One photo couldn't be used. Try a JPG, PNG or WEBP photo." : bad + " photos couldn't be used. Try JPG, PNG or WEBP photos.") : '');
    });
    draw();
    return {
      blobs: function () { return items.map(function (p) { return p.blob; }); },
      count: function () { return items.length; },
      clear: function () { items.forEach(function (p) { URL.revokeObjectURL(p.url); }); items = []; draw(); }
    };
  }

  async function upload(blobs, reserve, confirm) {
    var failed = 0;
    for (var i = 0; i < blobs.length; i++) {
      var ok = false, r = await reserve(blobs[i]);
      if (r && r.upload_url) {
        try {
          var fd = new FormData();
          fd.append('cacheControl', '3600');
          fd.append('', blobs[i]);
          var up = await fetch(r.upload_url, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } });
          if (up.ok) ok = await confirm(r.image_id);
        } catch (e) { ok = false; }
      }
      if (!ok) failed++;
    }
    return failed;
  }

  root.SngPhotoTools = { shrink: shrink, picker: picker, upload: upload, MAX_BYTES: MAX_BYTES };
})(window);
