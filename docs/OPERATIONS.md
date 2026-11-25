# Operations: deploying, checking and recovering SINAGLIKHA

This page is the checklist for keeping the live site healthy. Items marked **TODO (owner)** need a decision or an
account only the site owner has; nothing here was invented on the owner's behalf.

## 1. Before every deploy

```
npm run check    # every script parses, vercel.json is valid, no secret key is in a public file
npm test         # sign-in helpers: PIN rules, hashing, session cookies, lockout, origin check
```

GitHub runs both on every push (`.github/workflows/ci.yml`). A red check means do not deploy.

**Speed.** The functions run in Tokyo (`"regions": ["hnd1"]` in `vercel.json`) because the Supabase database is in
Tokyo (`ap-northeast-1`). Each page load makes several database calls, so keep the two in the same place: if the
database ever moves, change the region to match. The free plan allows one region. The HTML pages are `no-store`; their
scripts and styles are re-checked with the server (ETag) instead of being re-downloaded in full.

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
- `forum_anonymous.sql`: lets employees post anonymously in the Employee Forum. Deploying the code first is safe
  (the forum works as before and an anonymous post is refused with a clear message). Moderators always see the
  real author, and the portal says so next to the checkbox.
- `forum_category_colors.sql`: lets Senior Managers pick a label colour for each forum category, and gives the
  existing categories different colours. Until it runs, categories still get varied colours (worked out from their
  id) and the picker still opens; saving a chosen colour is skipped with a message and the rest of the category is
  saved normally.
- `forum_images.sql`: lets employees attach up to 4 photos (3 MB each) to a new Employee Forum discussion, and lets
  moderators see them in the Senior Manager portal. Photos sit in the private `forum-images` bucket under random
  names inside the discussion's folder (nothing says who posted them), and the browser re-saves each one as a plain
  JPEG, which drops hidden camera details such as the location. Until it runs, the forum works as before and the
  "Add photo" button is simply not shown.

- `grievances.sql`: the Grievances system for Legal Compliance (tables, ticket numbers, the access rules, and the
  Grievances card on the Legal Compliance page). Until it runs, nothing shows: employees see no Grievances panel and
  Senior Managers see no card. Run it on staging first.

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

## 8. Grievances (Legal Compliance)

Employees raise a grievance under **My Work, Grievances** and get a ticket number such as `GRV-2026-0001`. Legal Compliance
Senior Managers and the Administrator handle them under **Content, Legal Compliance, Grievances**. Nobody else can see them.
Set-up is one SQL file, `supabase/grievances.sql` (safe to run again; try it on staging first). Until it runs, nothing shows.

**Privacy**
- **Confidential** grievances record the employee. Handlers see "Raised by: Hidden" until they press Reveal, and every reveal is
  written to the activity log with the handler's name. **Anonymous** grievances record no employee at all: the employee gets a
  ticket number and a secret access code and needs both to follow the case. Times on anonymous cases are rounded to the day, they
  write nothing to the activity log, never cause an immediate email, and wrong ticket/code guesses are counted per device and then
  blocked. Anonymity has limits: Legal cannot verify details or protect the person from retaliation, so the form says so. A file
  attached to an anonymous case can still carry its author's details, and Supabase Storage keeps the exact upload time inside its
  own tables; the form warns the employee about the first.
- **Routing (conflicts of interest).** The form asks whether the case involves someone in Legal Compliance or the Administrator.
  If it involves Legal Compliance, only the Administrator can see it; if it involves the Administrator, only Legal Compliance can.
  A handler can also press "I have a conflict of interest" on a case: it disappears for them and is unassigned. If a case involves
  the only person who could handle it, nobody can: that is by design, so handle it outside the system.
- **Access rule:** done in the database (`can_handle_grievances()` and `grievance_visible()` in `supabase/grievances.sql`), not in
  the screens. Handlers use database functions that check the rule and keep a trail; the tables cannot be read from the browser.

**Handling**
- **Who handles a case:** the Handling card has an "Assigned to" list and an Assign button. The list holds only the people who may see that
  case: the Legal Compliance Senior Managers (and the Administrator, only to the Administrator, because that account is hidden from
  Senior Managers), minus anyone who stepped away from it, and following the routing (a case involving Legal Compliance lists only the
  Administrator; one involving the Administrator lists only Legal Compliance). Any handler who may see a case can give it to someone
  else or back to nobody; each change is in the case trail and the activity log by name. Assigning does not send an email.
- **Statuses:** Submitted, Acknowledged, Under review, Resolved, Escalated, Closed. Resolving or closing needs an outcome, which the
  employee can read. Private notes are never shown to the employee.
- **Time limits** (the Administrator sets them under Grievances, Settings): acknowledge within 2 working days, update at least every
  5 working days, resolution target 30 days. A case past a limit shows **Overdue** with the reason, has its own filter, and is
  counted on the Content tab ("3 grievances are overdue"). Weekends do not count; **public holidays do** (the database does not
  know them).
- **Export:** the inbox can be downloaded as a CSV (tickets, topic, status, dates; never a name or any text).
- **Deleting one case:** the trash icon at the top of a case deletes it for good, with its messages and files, after a confirmation. Any
  handler who may see the case can do it. The activity log keeps one line with the ticket number and who deleted it (never the
  complainant). There is no undo, so consider closing a case instead.
- **Retention:** nothing is deleted automatically. The Administrator can set "keep closed cases for N months" and then press "Delete
  expired cases" to remove every closed case past that age at once (logged as a count). Ask your counsel or Data Privacy Officer
  which period is right.

**Files** (private bucket `grievances`): up to 5 per grievance, 10 MB each, PDF, JPG, PNG, WEBP, TXT or DOCX. The browser uploads straight
to Storage with a one-time address from the server; the file keeps a random name and the employee's name for it is kept only in the
database. Handlers download with a 2-minute link. Files are not virus-scanned.

**Email alerts (optional; off until you set it up).**
1. Create an account at resend.com and verify a sending domain.
2. In Vercel, Project, Settings, Environment Variables, add `RESEND_API_KEY`, `GRIEVANCE_MAIL_FROM` (for example
   `SINAGLIKHA <alerts@yourdomain.com>`), optionally `SITE_URL`, and `CRON_SECRET` (any random string of 16 or more characters).
3. Redeploy. A new **confidential** grievance, and the employee's first message of the day on one, then emails the right handlers
   (a ticket number only: never a name, topic or text). **Anonymous** ones never trigger an immediate email, because the minute it
   arrives could be matched with someone's sign-in time. They are only counted in the **daily summary** at 8:00 AM Philippine time
   (a Vercel scheduled job in `vercel.json`), which says how many cases are unacknowledged, waiting for a reply or overdue.
   Without `CRON_SECRET` the scheduled job is refused, and without the Resend settings no email is sent. Neither breaks anything.

**Defaults** (change in `assets/grievance-meta.js` and the matching lists in the SQL; a test checks they agree): seven categories,
3 confidential grievances a day per employee, 30 anonymous in all per day, 20 messages a day per grievance.

**Tests:** `npm test` covers the server; `./scripts/test-sql.sh` runs the database tests against a throwaway Postgres (CI does this
too). What no test here could cover: real Supabase Storage uploads and downloads, and real email delivery. Try both on staging
before relying on them.
