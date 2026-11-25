/*
  Photos on a reply or a comment (supabase/comment_images.sql). Shared by the forum replies (api/employee-forum.js) and the
  announcement comments (api/_comments.js), which are separate tables with their own photo table each.

  The page asks for a place for each photo ("image_url": a one-time upload address) and, once it has uploaded the file straight
  to private storage, confirms it ("image_done"). Only the author of the reply or comment can add photos, only soon after posting
  it, up to MAX per post, and only as JPG, PNG or WEBP of at most 3 MB. The stored name is random and sits in the post's own
  folder, so nothing in it says who wrote the post.
*/
const crypto = require('crypto');
const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 3, BYTES = 3 * 1024 * 1024, WINDOW_MIN = 30;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const OFF = { error: "Photo attachments aren't switched on yet. Ask your administrator." };
const gone = { error: "That isn't available any more." };
const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

/* how many photos the page said it is sending with a new reply or comment (0 when it said none, or something odd) */
const photoCount = (n) => (Number.isInteger(n) && n >= 1 && n <= MAX ? n : 0);

/*
  cfg: { eid, table: 'forum_post_images', parent: 'forum_posts', fk: 'post_id', prefix: 'r' }
  Returns true if it answered the request (body.action was one of the two image actions).
*/
async function handle(res, body, cfg) {
  const { eid, table, parent, fk, prefix } = cfg;
  if (body.action === 'image_url') {
    const pid = String(body.parent_id || ''), mime = String(body.mime || ''), size = Number(body.size);
    if (!UUID_RE.test(pid)) return E.send(res, 400, { error: 'Bad request.' }), true;
    if (!EXT[mime]) return E.send(res, 400, { error: 'Use a JPG, PNG or WEBP photo.' }), true;
    if (!Number.isInteger(size) || size < 1 || size > BYTES) return E.send(res, 400, { error: 'That photo is too large. The limit is 3 MB.' }), true;
    const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
    const mine = list(await E.rest('GET', `${parent}?id=eq.${pid}&employee_id=eq.${eid}&hidden=eq.false&created_at=gte.${encodeURIComponent(since)}&select=id`))[0];
    if (!mine) return E.send(res, 404, gone), true;
    const have = await E.rest('GET', `${table}?${fk}=eq.${pid}&select=id,confirmed,created_at&limit=20`);
    if (!have.ok) return E.send(res, 503, OFF), true;
    const day = new Date(Date.now() - 24 * 3600000).toISOString();
    if (list(have).filter((x) => x.confirmed || String(x.created_at) >= day).length >= MAX) return E.send(res, 400, { error: `You can attach up to ${MAX} photos.` }), true;
    const path = `${prefix}/${pid}/${crypto.randomUUID()}.${EXT[mime]}`;
    const made = list(await E.rest('POST', table, { [fk]: pid, path, size_bytes: size, mime, confirmed: false }, 'return=representation'))[0];
    if (!made) return E.send(res, 500, { error: "Couldn't prepare that photo. Try again." }), true;
    const url = await E.signImageUpload(path);
    if (!url) {
      await E.rest('DELETE', `${table}?id=eq.${made.id}`, undefined, 'return=minimal');
      return E.send(res, 502, { error: "Couldn't prepare the upload. Try again in a moment." }), true;
    }
    return E.send(res, 200, { ok: true, image_id: made.id, upload_url: url }), true;
  }
  if (body.action === 'image_done') {
    const iid = String(body.image_id || '');
    if (!UUID_RE.test(iid)) return E.send(res, 400, { error: 'Bad request.' }), true;
    const img = list(await E.rest('GET', `${table}?id=eq.${iid}&select=id,path,${fk},confirmed`))[0];
    const own = img && list(await E.rest('GET', `${parent}?id=eq.${img[fk]}&employee_id=eq.${eid}&select=id`))[0];
    if (!img || !own) return E.send(res, 404, gone), true;
    if (img.confirmed) return E.send(res, 200, { ok: true }), true;
    if ((await E.storedImageSize(img.path)) === null) return E.send(res, 404, { error: 'That photo did not finish uploading. Please try again.' }), true;
    const done = await E.rest('PATCH', `${table}?id=eq.${iid}`, { confirmed: true }, 'return=minimal');
    if (!done.ok) return E.send(res, 500, { error: "Couldn't finish that photo. Try again." }), true;
    return E.send(res, 200, { ok: true }), true;
  }
  return false;
}

/* { parent id: [signed photo links] } for a set of replies or comments, and whether photos are switched on (the table exists) */
async function linksFor(table, fk, ids) {
  const r = await E.rest('GET', ids.length ? `${table}?${fk}=in.(${ids.join(',')})&confirmed=eq.true&select=${fk},path&order=created_at.asc&limit=500` : `${table}?select=id&limit=1`);
  const rows = list(r).filter((x) => x.path && x[fk]);
  const urls = await E.signedImages(rows.map((x) => x.path));
  const by = {};
  rows.forEach((x) => { if (urls[x.path]) (by[x[fk]] = by[x[fk]] || []).push(urls[x.path]); });
  return { by, on: !!r.ok };
}

module.exports = { handle, linksFor, photoCount, MAX };
