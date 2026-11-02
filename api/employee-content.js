/*
  Everything an employee reads, in one function (Vercel's free plan allows 12 functions).

  GET /api/employee-content                  the portal's content: Published items for Employees or the
                                             Public, the department deliverables, and the evaluation forms
                                             that are open today
  GET /api/employee-content?file=<item id>   a 5-minute link to open one such item (links go straight
                                             to their web address)
  GET /api/employee-content?records=1        the employee's OWN compensation records (title, period, date)
  GET /api/employee-content?record=<id>      a 5-minute link to open one of their OWN compensation records

  Needs an employee sign-in. The employee comes from the cookie, never from the request. Drafts,
  unpublished and archived items, items for managers only, the 201 Files, evaluation results and
  disciplinary cases are never included. Every open of a compensation record is logged.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return E.send(res, 405, { error: 'Use GET.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });

  const q = req.query || {};

  /* ---- open one Published item ---- */
  if (q.file !== undefined) {
    const id = String(q.file);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const r = await E.rest('GET', `content_items?id=eq.${id}&status=eq.published&audience=in.(employees,public)&select=kind,file_path,external_url`);
    const item = r.ok && Array.isArray(r.data) && r.data[0];
    const gone = { error: "That item isn't available any more." };
    if (!item) return E.send(res, 404, gone);
    if (item.kind === 'link') {
      if (!/^https?:\/\//i.test(item.external_url || '')) return E.send(res, 404, gone);
      return E.send(res, 200, { url: item.external_url });
    }
    if (!item.file_path) return E.send(res, 404, gone);
    const url = await E.signUrl('content', item.file_path);
    if (!url) return E.send(res, 502, { error: "Couldn't open that file. Try again in a moment." });
    return E.send(res, 200, { url });
  }

  /* ---- the employee's own compensation records ---- */
  if (q.records !== undefined) {
    const r = await E.rest('GET',
      `restricted_records?employee_id=eq.${me.emp.id}&kind=eq.compensation&select=id,title,period,created_at&order=created_at.desc&limit=100`);
    // Before supabase/restricted_records.sql has been run the table does not exist yet: show nothing.
    return E.send(res, 200, { records: r.ok && Array.isArray(r.data) ? r.data : [] });
  }
  if (q.record !== undefined) {
    const id = String(q.record);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const r = await E.rest('GET', `restricted_records?id=eq.${id}&employee_id=eq.${me.emp.id}&kind=eq.compensation&select=file_path`);
    const rec = r.ok && Array.isArray(r.data) && r.data[0];
    if (!rec || !rec.file_path) return E.send(res, 404, { error: "That record isn't available." });
    const url = await E.signUrl('restricted', rec.file_path);
    if (!url) return E.send(res, 502, { error: "Couldn't open that file. Try again in a moment." });
    await E.logAudit('employee.record.open', me.emp.employee_no, { record: id, kind: 'compensation' });
    return E.send(res, 200, { url });
  }

  /* ---- the portal's content ---- */
  const today = E.manilaDate();
  const [d, c, ev] = await Promise.all([
    E.rest('GET', 'deliverables?kind=neq.special&select=key,name,department&order=name'),
    E.rest('GET', 'content_items?status=eq.published&audience=in.(employees,public)&kind=neq.folder' +
      '&select=id,deliverable,kind,folder_path,title,description,category,version,external_url,extra,published_at' +
      '&order=published_at.desc&limit=1000'),
    E.rest('GET', 'evaluation_setups?active=eq.true&select=id,title,kind,url,instructions,opens_on,closes_on&order=kind,title')
  ]);
  if (!d.ok || !c.ok || !Array.isArray(d.data) || !Array.isArray(c.data)) {
    return E.send(res, 502, { error: "Couldn't load the portal content. Try again in a moment." });
  }
  const items = c.data.map((i) => ({
    id: i.id, deliverable: i.deliverable, kind: i.kind, folder: i.folder_path || '', title: i.title,
    description: i.description || '', category: i.category || '', version: i.version || '',
    link: i.kind === 'link' ? i.external_url : null,
    size: i.extra && typeof i.extra.size === 'number' ? i.extra.size : null,
    published_at: i.published_at
  }));
  // The evaluation table is created by supabase/phase2.sql; until then there is simply nothing to show.
  const evaluations = (ev.ok && Array.isArray(ev.data) ? ev.data : []).filter((e) =>
    /^https?:\/\//i.test(e.url || '') && (!e.opens_on || e.opens_on <= today) && (!e.closes_on || e.closes_on >= today));
  return E.send(res, 200, { deliverables: d.data, items, evaluations });
};
