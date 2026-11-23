# Operations: deploying, checking and recovering SINAGLIKHA

This page is the checklist for keeping the live site healthy. Items marked **TODO (owner)** need a decision or an
account only the site owner has; nothing here was invented on the owner's behalf.

## 1. Before every deploy

```
npm run check    # every script parses, vercel.json is valid, no secret key is in a public file
npm test         # sign-in helpers: PIN rules, hashing, session cookies, lockout, origin check
```

GitHub runs both on every push (`.github/workflows/ci.yml`). A red check means do not deploy.

Vercel (free plan) allows **12 serverless functions**. `api/` holds exactly 12 (files starting with `_` are helpers, not
functions). A 13th file fails the deploy. Add new routes to an existing function (as `employee-forum.js` does for
comments) or move to a paid plan.

## 2. Database changes (Supabase SQL)

The `supabase/*.sql` files are applied by hand in the Supabase SQL editor. **TODO (owner):** write the order they were
run on the live project here, so a fresh project can be rebuilt:

```
1. schema.sql
2. ... (fill in)
```

Optional features that need a SQL file before they work:
- `forum_anonymous.sql`: lets employees post anonymously in the Community forum. Deploying the code first is safe
  (the forum works as before and an anonymous post is refused with a clear message). Moderators always see the
  real author, and the portal says so next to the checkbox.

Rules going forward:
- Never edit a file that has already been run. Add a new, dated file (`2026-12-01_add_x.sql`).
- Write each file so it is safe to run twice (`create table if not exists`, `add column if not exists`,
  `create or replace`).
- Try it on the staging project first (section 3), then on live.
- The API has a fallback for a missing column (`api/_employee.js`, scorecards `department`). If a feature seems to
  "quietly not work", a SQL file has probably not been applied on that project.
- Optional later step: adopt the Supabase CLI (`supabase migration new`) so the order is enforced by tooling.

## 3. Staging

A second Supabase project plus a Vercel preview gives a safe place to test.
**TODO (owner):** create a free second Supabase project, run the SQL files on it, and give Vercel's **Preview**
environment its own `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `EMPLOYEE_SESSION_SECRET`
(Project, Settings, Environment Variables, tick "Preview" only). Every branch push then gets its own URL that
talks to the staging database. `members/config.js` holds the live Supabase URL; point it at staging in the preview
branch while testing, and never merge that change.

## 4. Security notes

- **Secrets.** `SUPABASE_SERVICE_ROLE_KEY` and `EMPLOYEE_SESSION_SECRET` live only in Vercel environment variables.
  `npm run check` fails the build if a secret-shaped string appears in a file. The anon key in `members/config.js` is
  public by design; Row Level Security is what protects the data.
- **Content-Security-Policy** is sent as `Content-Security-Policy-Report-Only` in `vercel.json`. It blocks nothing; it
  lists in the browser console (F12, Console) anything the page loads that is not on the allow-list. After a week of
  normal use with no warnings, rename the header to `Content-Security-Policy` to enforce it. Tighten later by
  removing `'unsafe-inline'` once inline scripts move to files.
- **Cross-site posts.** `readJson()` rejects a request whose `Origin` names another site.
- **User text.** Everything shown with `innerHTML` goes through `esc()` (quotes included); dialogs use `textContent`;
  photo URLs are checked against a strict `data:image` pattern. When adding a screen, escape every value you did not
  write yourself.
- **Subresource Integrity.** `members/index.html` loads supabase-js from jsDelivr at a pinned version. Add an
  `integrity="sha384-..."` and `crossorigin="anonymous"` attribute using the hash from
  `curl -s <that URL> | openssl dgst -sha384 -binary | openssl base64 -A`, or copy the library into `assets/`.
  Test on staging first: a wrong hash stops the script and breaks sign-in.
- **Database timeouts.** Supabase calls from `api/` stop after 8 seconds and answer "not ok" instead of hanging.

## 5. Monitoring (TODO, owner)

- **Uptime:** a free monitor (UptimeRobot or Better Stack) on the home page and on `/api/employee-me`
  (a 401 for "not signed in" still means the function is alive).
- **Errors:** Vercel, Project, Logs shows function errors for the last day on the free plan. For longer history add
  Sentry's free tier to the functions.
- **Quotas:** watch Supabase (database size, monthly active users) and Vercel (function time) usage monthly.
- Tables that grow: `employee_attempts` self-cleans (7 days). Check `audit_log` size now and then.

## 6. Backups and restore (TODO, owner)

- The free Supabase plan keeps **no downloadable daily backups**. Pro includes daily backups.
  **Until then, run a monthly export:** Supabase, Database, Backups, or
  `pg_dump "$DATABASE_URL" -Fc -f sinaglikha-$(date +%F).dump` from any computer, stored somewhere private.
- Files in the private `library` storage bucket are not in a database dump. Download them separately (Storage page)
  or keep a copy of the originals.
- **Restore drill:** once, restore a dump into the staging project and sign in. A backup that has never been
  restored is a guess.
- Code is safe in GitHub; roll back a bad deploy with Vercel, Deployments, "Promote to Production" on the last good one.

## 7. Accessibility and performance review (TODO)

Run Chrome DevTools, Lighthouse (mobile and desktop) on `/`, `/careers/`, `/employees/` and `/members/`, and the axe
DevTools extension. Fix "serious" and "critical" findings first: contrast, form labels, button names, focus order.
