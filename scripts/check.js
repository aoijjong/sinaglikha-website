/* Cheap safety net before every deploy: every script parses, vercel.json is valid JSON,
   and no secret key is written into a file the browser can load. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
const skip = new Set(['.git', 'node_modules']);
let bad = 0;

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    if (skip.has(n)) continue;
    const p = path.join(dir, n);
    fs.statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const files = walk(root);

for (const f of files.filter((x) => x.endsWith('.js'))) {
  const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error('SYNTAX  ' + path.relative(root, f) + '\n' + r.stderr); }
}
try { JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')); }
catch (e) { bad++; console.error('vercel.json is not valid JSON: ' + e.message); }

/* a service_role JWT carries "role":"service_role"; sb_secret_ keys are the newer form */
const secretLike = /sb_secret_[A-Za-z0-9_-]{16,}|service_role["']?\s*[:=]\s*["']eyJ/;
for (const f of files.filter((x) => /\.(js|html|css|json|md)$/.test(x))) {
  if (secretLike.test(fs.readFileSync(f, 'utf8'))) { bad++; console.error('SECRET?  ' + path.relative(root, f)); }
}
console.log(bad ? `${bad} problem(s)` : 'ok: scripts parse, vercel.json valid, no secrets found');
process.exit(bad ? 1 : 0);
