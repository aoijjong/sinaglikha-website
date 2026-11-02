/*
  GET /api/employee-content

  Everything an employee may read: the items managers have Published for Employees or for the
  Public, and the list of deliverables they belong to. Needs an employee sign-in. Drafts,
  unpublished and archived items, items for managers only, the 201 Files and restricted records
  are never included. No file paths are sent; files are opened through /api/employee-file.
*/

const E = require('./_employee');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return E.send(res, 405, { error: 'Use GET.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });

  const [d, c] = await Promise.all([
    E.rest('GET', 'deliverables?kind=neq.special&select=key,name,department&order=name'),
    E.rest('GET', 'content_items?status=eq.published&audience=in.(employees,public)&kind=neq.folder' +
      '&select=id,deliverable,kind,folder_path,title,description,category,version,external_url,extra,published_at' +
      '&order=published_at.desc&limit=1000')
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
  return E.send(res, 200, { deliverables: d.data, items });
};
