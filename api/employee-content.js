/*
  Everything an employee reads, in one function (Vercel's free plan allows 12 functions).

  GET /api/employee-content?home=1             the WHOLE dashboard in one answer, fetched in parallel: the
                                               employee, Published content, the open Self and Peer
                                               evaluation forms, own time
                                               records, own compensation records, learning progress, the forum
                                               feed and the announcements
  GET /api/employee-content                    just the content
  GET /api/employee-content?file=<item id>     a 5-minute link to open one Published item (links go straight to
                                               their web address); add &dl=1 for a link that saves the file
  GET /api/employee-content?ann=<id>&i=<n>     a 5-minute link to open file number n attached to an announcement
  GET /api/employee-content?records=1          the employee's OWN compensation records (title, period, date)
  GET /api/employee-content?record=<id>        a 5-minute link to open one of their OWN compensation records

  Needs an employee sign-in. The employee comes from the cookie, never from the request. Drafts,
  unpublished and archived items, hidden announcements, items for managers only, the 201 Files, evaluation
  results and disciplinary cases are never included. Every open of a compensation record is logged.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/* Published items for Employees or the Public and the deliverables they belong to. Returns null if the
   content itself can't be read. */
async function contentPayload() {
  const [d, c] = await Promise.all([
    E.rest('GET', 'deliverables?kind=neq.special&select=key,name,department&order=name'),
    E.rest('GET', 'content_items?status=eq.published&audience=in.(employees,public)&kind=neq.folder' +
      '&select=id,deliverable,kind,folder_path,title,description,category,version,external_url,extra,file_path,published_at' +
      '&order=published_at.desc&limit=1000')
  ]);
  if (!d.ok || !c.ok || !Array.isArray(d.data) || !Array.isArray(c.data)) return null;
  // a title often has no extension ("Organizational Structure"), so the type comes from the stored file's name;
  // only the type goes out, the path stays here
  const extOf = (p) => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(p || '')); return m ? m[1].toLowerCase() : ''; };
  const items = c.data.map((i) => ({
    id: i.id, deliverable: i.deliverable, kind: i.kind, folder: i.folder_path || '', title: i.title,
    ext: i.kind === 'link' ? '' : extOf(i.file_path),
    description: i.description || '', category: i.category || '', version: i.version || '',
    link: i.kind === 'link' ? i.external_url : null,
    size: i.extra && typeof i.extra.size === 'number' ? i.extra.size : null,
    published_at: i.published_at
  }));
  return { deliverables: d.data, items };
}

/* The latest published announcements, newest first. File paths stay on the server. */
async function announcementList() {
  const r = await E.rest('GET', 'announcements?published=eq.true&select=id,title,body,files,author_id,author_name,author_dept,created_at&order=created_at.desc&limit=30');
  // Before supabase/phase4.sql has been run the table doesn't exist yet.
  const rows = E.list(r);
  const pack = await E.photoPack('profiles', rows.map((a) => a.author_id));
  return {
    photos: pack.pics,
    items: rows.map((a) => ({
      id: a.id, title: a.title || '', body: a.body, author: a.author_name || 'A Senior Manager', pic: pack.at(a.author_id), dept: a.author_dept || '', created_at: a.created_at,
      files: (Array.isArray(a.files) ? a.files : []).map((f) => ({ name: String(f.name || 'File'), size: typeof f.size === 'number' ? f.size : null }))
    }))
  };
}

async function ownRecords(eid) {
  const r = await E.rest('GET', `restricted_records?employee_id=eq.${eid}&kind=eq.compensation&select=id,title,period,created_at&order=created_at.desc&limit=100`);
  // Before supabase/restricted_records.sql has been run the table does not exist yet: show nothing.
  return E.list(r);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return E.send(res, 405, { error: 'Use GET.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });

  const q = req.query || {};
  const eid = me.emp.id;

  /* ---- the whole dashboard, every piece fetched at the same time ---- */
  if (q.home !== undefined) {
    const [content, attendance, records, learning, forum, announcements, evaluations, av] = await Promise.all([
      contentPayload(),
      E.attendanceRecent(eid),
      ownRecords(eid),
      E.learningSummary(eid),
      E.forumFeed(eid),
      announcementList(),
      E.evaluationForms(eid),
      // Read on its own so a missing photo column never stops anyone from seeing their dashboard.
      E.rest('GET', `employees?id=eq.${eid}&select=avatar`)
    ]);
    if (!content) return E.send(res, 502, { error: "Couldn't load the portal content. Try again in a moment." });
    const row = E.list(av)[0];
    const avatar = row && typeof row.avatar === 'string' && AVATAR_RE.test(row.avatar) ? row.avatar : null;
    return E.send(res, 200, {
      employee: { employee_no: me.emp.employee_no, full_name: me.emp.full_name, position: me.emp.position, avatar },
      deliverables: content.deliverables, items: content.items,
      attendance, records, learning, forum, evaluations, announcements: announcements.items, announcementPhotos: announcements.photos
    });
  }

  /* ---- open one Published item ---- */
  if (q.file !== undefined) {
    const id = String(q.file);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const r = await E.rest('GET', `content_items?id=eq.${id}&status=eq.published&audience=in.(employees,public)&select=kind,file_path,external_url,title`);
    const item = r.ok && Array.isArray(r.data) && r.data[0];
    const gone = { error: "That item isn't available any more." };
    if (!item) return E.send(res, 404, gone);
    if (item.kind === 'link') {
      if (!/^https?:\/\//i.test(item.external_url || '')) return E.send(res, 404, gone);
      return E.send(res, 200, { url: item.external_url });
    }
    if (!item.file_path) return E.send(res, 404, gone);
    let url = await E.signUrl('content', item.file_path);
    if (!url) return E.send(res, 502, { error: "Couldn't open that file. Try again in a moment." });
    if (q.dl !== undefined) {
      // save it as "Title.pdf" even when the title itself has no extension
      const m = /\.([A-Za-z0-9]{1,5})$/.exec(item.file_path);
      const title = item.title || 'file';
      const name = m && !new RegExp('\\.' + m[1] + '$', 'i').test(title) ? title + '.' + m[1].toLowerCase() : title;
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'download=' + encodeURIComponent(name);
    }
    return E.send(res, 200, { url });
  }

  /* ---- open a file attached to a published announcement ---- */
  if (q.ann !== undefined) {
    const id = String(q.ann), i = Number(q.i);
    if (!UUID_RE.test(id) || !Number.isInteger(i) || i < 0) return E.send(res, 400, { error: 'Bad request.' });
    const r = await E.rest('GET', `announcements?id=eq.${id}&published=eq.true&select=files`);
    const row = E.list(r)[0];
    const file = row && Array.isArray(row.files) ? row.files[i] : null;
    if (!file || typeof file.path !== 'string' || file.path.indexOf('announcements/') !== 0) return E.send(res, 404, { error: "That file isn't available any more." });
    const url = await E.signUrl('content', file.path);
    if (!url) return E.send(res, 502, { error: "Couldn't open that file. Try again in a moment." });
    return E.send(res, 200, { url });
  }

  /* ---- the employee's own compensation records ---- */
  if (q.records !== undefined) return E.send(res, 200, { records: await ownRecords(eid) });
  if (q.record !== undefined) {
    const id = String(q.record);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const r = await E.rest('GET', `restricted_records?id=eq.${id}&employee_id=eq.${eid}&kind=eq.compensation&select=file_path`);
    const rec = r.ok && Array.isArray(r.data) && r.data[0];
    if (!rec || !rec.file_path) return E.send(res, 404, { error: "That record isn't available." });
    const url = await E.signUrl('restricted', rec.file_path);
    if (!url) return E.send(res, 502, { error: "Couldn't open that file. Try again in a moment." });
    await E.logAudit('employee.record.open', me.emp.employee_no, { record: id, kind: 'compensation' });
    return E.send(res, 200, { url });
  }

  /* ---- just the portal's content ---- */
  const content = await contentPayload();
  if (!content) return E.send(res, 502, { error: "Couldn't load the portal content. Try again in a moment." });
  return E.send(res, 200, content);
};
