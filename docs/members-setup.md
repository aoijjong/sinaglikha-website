# Members area setup

An invite-only area for the SINAGLIKHA 201 Files. People sign in with an email and
password. Only people a Senior Manager invites can get in. Files are kept in private storage
(not in GitHub) and are only handed out to signed-in Senior Managers.

## Who can do what
| Role | Files (view, download, upload, new folder, delete) | Accounts (invite, deactivate, reactivate, delete) | Set roles | Visible in the accounts list |
|---|---|---|---|---|
| **Senior Manager** of Staffing and Recruitment or Legal Compliance | Yes, everything | Yes, for other Senior Managers | No | Yes |
| **Senior Manager** of another department, or with no department yet | No | Yes, for other Senior Managers | No | Yes |
| **Administrator** (the owner) | Yes, everything | Yes, for everyone | Yes | **No, hidden** |

Everyone who is invited starts as a Senior Manager **with no department**, so the 201 Files stay closed to
them until the Administrator picks their department in the Accounts tab. The Administrator account is the owner's:
it is hidden from the accounts list, so no Senior Manager can see it, deactivate it, delete it
or change its role. There are no other roles.

You'll set up three things: **Supabase** (logins and file storage), the **site settings**
(two values in `members/config.js`), and **Vercel** (so Senior Managers can send invitations from the
website). Allow about 20 minutes.

> The code was tested against a simulated Supabase, not a real project, so expect to fix a
> small typo or setting on your first run. The troubleshooting list at the bottom covers the
> likely ones.

---

## Part A. Supabase

### 1. Create the project
1. Go to <https://supabase.com> and sign in with GitHub.
2. **New project.** Name it `sinaglikha`. Create and **save** the database password somewhere
   safe. Pick the region closest to your team (for the Philippines, Singapore). Choose the free plan.
3. Wait a minute or two while it sets up.

### 2. Create the tables and file rules
1. In the left menu open **SQL Editor** and choose **New query**.
2. Open `supabase/schema.sql` from this repository, copy everything, paste it in, and press **Run**.
3. You should see "Success". Running it again later is safe.

This creates the people list, a private storage bucket called `library`, and the rules:
- every active **Senior Manager of Staffing and Recruitment or Legal Compliance** (and the Administrator) can
  **view, download, upload, create folders and delete**,
- nobody else can do anything.

It also keeps an **activity log** (who opened, downloaded, uploaded or deleted a file, and who changed an
account). The Administrator can read it in Supabase under **Table Editor**, then `audit_log`. It records actions done
on this website only.

**After you run it, set the departments.** Nobody has a department yet, so Senior Managers are locked out of
the 201 Files until you sign in as the Administrator, open **Accounts**, and pick each person's department.

**Before you press Run, edit one line.** Near the top, in the block marked `EDIT THIS`, replace
`YOUR-ADMIN-EMAIL@example.com` with the email you sign in with. Do this only in the Supabase SQL
editor, not in the file on GitHub. If your project already has accounts from the old Member/Admin
setup, this one run also converts them: everybody becomes a Senior Manager, and the email you typed
becomes the hidden Administrator. If that email isn't found, it stops without changing anything.

### 3. Make sign-up invite-only
1. Open **Authentication**, then **Sign In / Providers** (the wording changes between Supabase versions).
2. Turn **off** "Allow new users to sign up" and **save**. This is the most important switch. With
   it off, nobody can create an account on their own. (Even if it's left on, accounts that weren't
   invited start out inactive and can't see any files.)
3. Under the Email provider set the **minimum password length to 10** and keep
   **Confirm email** on.

### 4. Tell Supabase where your site lives
Open **Authentication**, then **URL Configuration**:
- **Site URL**: your main site address (for example `https://sinaglikha.vercel.app`).
- **Redirect URLs**: add each address people will use, ending in `/members/`:
  - `https://YOUR-SITE.vercel.app/members/`
  - `https://aoijjong.github.io/sinaglikha-website/members/` (if you keep the GitHub Pages copy)

Invitation and password-reset links only work for addresses on this list.

### 5. Copy your keys into the site
1. Open **Project Settings**, then **API** (or **API Keys**).
2. Copy the **Project URL** and the **anon / public** key.
3. Open `members/config.js` and replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY`.
   - `SUPABASE_URL` is the **Project URL**: it starts with `https://` and ends with `.supabase.co`.
     It is **not** a key.
   - `SUPABASE_ANON_KEY` is the long key that starts with `eyJ` (from the **Legacy API keys** tab),
     or the `sb_publishable_…` key.
4. Commit and push that file.

If you paste a key into the URL line, the members page now tells you so instead of failing quietly.

> The **anon** key is designed to be public, so it is fine in the repository. The
> **service_role** key is a secret. Never put it in `config.js` or anywhere in GitHub.

### 6. Set the biggest file size (optional)
**Storage**, then **Settings**: choose the global file size limit. The free plan allows up to 50 MB
per file. Keep `MAX_UPLOAD_MB` in `members/config.js` at or below it.

---

## Part B. Create the first account (the hidden Administrator, you)
1. Supabase: **Authentication**, then **Users**, then **Add user**, then **Send invitation**.
   Enter your own email.
2. Open the email and click the link. It opens `/members/` (or the home page, which sends you on)
   and asks you to **set a password**. Each link works once. If you already used it, or you weren't
   asked for a password, go to `/members/`, type your email, and choose **Forgot your password?**.
   The email that sends lets you set one.
3. In **SQL Editor** run (use your email):

   ```sql
   update public.profiles set role = 'admin', hidden = true, active = true where email = 'you@example.com';
   ```
   (If you already ran the full `schema.sql` with your email in the `EDIT THIS` block, this is done for you.)
4. Reload the members page. You should see **Upload files**, **New folder**, and a **People** tab.
   Your own account won't be listed in the Accounts tab. That is intended.

---

## Part C. Vercel (needed only for inviting from the website)
Signing in and the 201 Files work on any host. **Sending invitations from the Accounts tab**
needs the server function in `api/invite.js`, which runs on Vercel.
(You can always invite from the Supabase dashboard instead.)

1. In Vercel, import this repository (**Add New**, then **Project**). Leave the build settings alone.
2. Open **Project**, then **Settings**, then **Environment Variables** and add these four:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL from step A5 |
   | `SUPABASE_ANON_KEY` | the anon key from step A5 |
   | `SUPABASE_SERVICE_ROLE_KEY` | the **secret** key (Project Settings, API Keys): either the legacy `service_role` key or the newer `sb_secret_…` key. Secret. Switch on Vercel's **Sensitive** option for it. |
   | `SITE_URL` | your site address with no trailing slash, for example `https://sinaglikha-website.vercel.app` |

3. **Redeploy** so the variables take effect: **Deployments**, open the latest one, **⋯**, **Redeploy**.
4. **Test it:** sign in, open **Accounts**, and invite a second email address you own.
   The invitation email should arrive within a minute. If you see "Invites are not set up on the
   server yet", one of the variables is missing or you haven't redeployed.

---

## Part D. Your own email sender (do this before inviting a real group)
Supabase's built-in email sender is for testing only. It allows roughly **2 emails per hour for the
whole project**, so invitations and password resets quickly show "email rate limit exceeded".
Connect your own sender once and the limit goes away. Gmail works well for a small team and is free:

1. **Get a Gmail app password.** In your Google account: **Security**, turn on **2-Step Verification**,
   then search for **App passwords**, create one named `Supabase`, and copy the 16-character password.
2. **Add it to Supabase.** Open **Authentication**, then **Emails** (or **Project Settings**, then
   **Authentication**), find **SMTP Settings**, switch on **Enable custom SMTP**, and fill in:

   | Field | Value |
   |---|---|
   | Sender email | your Gmail address |
   | Sender name | `SINAGLIKHA` |
   | Host | `smtp.gmail.com` |
   | Port | `465` |
   | Username | your Gmail address |
   | Password | the 16-character app password |

   Save it.
3. **Raise the limit.** Open **Authentication**, then **Rate Limits**, and set the emails-per-hour
   limit to something like 30.

Gmail allows about 500 emails a day, which is plenty here. Invitations sometimes land in spam at
first, so ask people to check there. Brevo (300 emails a day free) is a good alternative if you
want a separate sender.

## Everyday use
- **Invite someone:** Members area, **Accounts**, enter their email, **Send invitation**. They
  click the link in the email and choose a password.
- **Profile settings:** everyone sets up their own profile. Tap the round button next to
  **Sign out** (your photo, or your initials) to open the **Profile settings** page. There you can
  upload a photo, set your name and change your password (you enter your current password first).
  Forgot it? Use **Forgot your password?** on the sign-in page instead. Until a name is set the
  list shows "No name added". This needs the latest `supabase/schema.sql` to have been run once
  (it adds the photo column and the `set_my_profile` function). If you see "Saving isn't set up
  yet", run it again in the Supabase SQL editor.
- **Preview a PDF:** tap a PDF in the file list and it opens in a full-screen viewer on the same
  page: scroll through the pages, zoom with **+** and **-** (or the keyboard), and download from the
  top bar. Other file types still open in a new tab. The viewer uses the open-source pdf.js library,
  loaded from a CDN the first time a PDF is opened, so it needs an internet connection.
- **Roles and departments:** everyone you invite is a **Senior Manager** and can invite and manage other
  Senior Managers. Only the hidden Administrator can change a role or a department (Accounts tab). Only Senior
  Managers of Staffing and Recruitment and Legal Compliance can open the 201 Files. A Senior Manager of another
  department sees only the Accounts tab.
- **Remove access:** Accounts tab, **Deactivate** (instant). The account moves out of the main list
  into **Show deactivated accounts**, where you can **Reactivate** it or **Delete** it for good.
  Deleting frees the email so the person can be invited again. You can't delete yourself, and you
  must deactivate an account before deleting it. If an account has uploaded files, Supabase won't
  delete it, so keep it deactivated. Deleting from the website needs the Vercel settings from Part C.
- **Add files:** open **Files**, then **Upload files**, or drag files onto the list. Use **New folder** to organize.

## What this does and doesn't protect
- Only invited people can sign in. A Senior Manager of Staffing and Recruitment or Legal Compliance sees and can
  change **every** 201 file. There are no per-folder permissions.
- The public site's 201 Files notice says these files are only for Senior Managers of those two departments. The
  database and storage rules enforce it, not just the page.
- Files are never stored in GitHub. Download links expire after two minutes.
- Don't upload real employee records (HR 201) unless your team has approved where they're stored
  and who can see them. For the simulation, use sample documents.
- Supabase's free plan **pauses a project after about a week with no activity**. You can resume it
  from the dashboard. It also sends very few emails per hour from its default sender; if you invite
  many people at once, add your own email service under **Authentication**, then **SMTP**.

## Troubleshooting
| Problem | Likely cause and fix |
|---|---|
| "The members area isn't connected yet" | `members/config.js` still has the placeholder values. |
| Clicked the invitation but wasn't asked for a password | Usually a wrong `SUPABASE_URL` in `config.js` (the page now warns about this), or the link was already used. Fix the URL, then use **Forgot your password?** on `/members/`. |
| "SUPABASE_URL contains a key" | You pasted a key into the URL line. Put the Project URL (`https://….supabase.co`) there. |
| Invitation link says "expired" | The address isn't in **Redirect URLs** (step A4), or an email scanner already opened the link. Send a new invitation. |
| Signed in but "This account isn't active" | The account has no profile row or was deactivated. Re-run `schema.sql`, or check the Accounts tab. |
| No Upload button, or only the Accounts tab | The account isn't an active Administrator or a Senior Manager of Staffing and Recruitment or Legal Compliance. Set the department in the Accounts tab (as the Administrator), or reactivate the account. |
| "Your account has no department yet" | The Administrator hasn't picked this person's department. |
| `schema.sql` stops with "The owner email … was not found" | The email in the `EDIT THIS` block doesn't match your account. Fix it in the SQL editor and run again. Nothing was changed. |
| My own account doesn't appear in the accounts list | By design: the Administrator account is hidden. |
| "Email rate limit exceeded" or "Too many emails were sent recently" | Supabase's built-in sender only allows about 2 emails an hour. Wait an hour, or set up your own sender (Part D). |
| "Couldn't send the invitation" | One of the four Vercel variables is missing, or you haven't redeployed. |
| "In-site invitations only work on the Vercel version" | You're on GitHub Pages. Invite from the Supabase dashboard, or use the Vercel address. |
| Upload says "already exists" | A file with that name is in the folder. Rename it or delete the old one. |
| The Content tab says "isn't set up in the database yet" | `supabase/content_manager.sql` hasn't been run. Paste it into the Supabase SQL editor (after `schema.sql`) and run it. |
| Content upload says "file type not allowed" | Only PDF, images, Word, Excel, PowerPoint, text and CSV files are accepted. |
| The Employees tab says "isn't set up in the database yet" | `supabase/employees.sql` hasn't been run. Paste it into the Supabase SQL editor (after `schema.sql`) and run it. |
| Issuing a code says "not set up on the server yet" | The Vercel variable `EMPLOYEE_SESSION_SECRET` is missing (any random string of 32 or more characters, marked Sensitive), or you haven't redeployed since adding it. |
| An employee is "Locked" | Five wrong PINs lock sign-in for 15 minutes. A new code from Staffing and Recruitment clears it at once. |
| An employee lost their PIN | Nobody can read a PIN. Choose **Reset PIN** on their row in the Employees tab to issue a new activation code. |
| The Records tab says "aren't set up in the database yet" | `supabase/restricted_records.sql` hasn't been run. Paste it into the Supabase SQL editor (after `schema.sql` and `employees.sql`) and run it. |
| A Senior Manager can't see Evaluation Results or has no Upload Record button | By design. Evaluation results are for Total Rewards and the Administrator, compensation is uploaded by Total Rewards, and disciplinary cases by Legal Compliance. Check the person's department in the Accounts tab. |
| An employee's photo won't save ("Photos aren't set up yet") | `supabase/employees_avatar.sql` hasn't been run. Paste it into the Supabase SQL editor (after `employees.sql`) and run it. |
| Attendance or Performance Management says "Not set up yet" | `supabase/phase2.sql` hasn't been run. Paste it into the Supabase SQL editor (after `schema.sql` and `employees.sql`) and run it. |
| An employee can't time in or out, or the Attendance panel is missing | The panel only appears once `supabase/phase2.sql` has been run. Time in and time out follow Philippine time (UTC+8), allow one of each per day, and a second try is refused. Staffing and Recruitment can correct a record from the Attendance Tracker. |
| The Attendance Tracker says "Staffing and Recruitment only" | By design: only Staffing and Recruitment Senior Managers and the Administrator can review attendance. |
| An evaluation form doesn't show in the employee portal | It must be switched on (not Hidden) and today must be inside its open and close dates. Dates use Philippine time. |
| Learning or the Employee Forum says "Not set up yet" | `supabase/phase3.sql` hasn't been run. Paste it into the Supabase SQL editor (after the earlier files) and run it. |
| Employees don't see a course | A course stays hidden until a manager publishes it (the eye icon in the Learning Management System screen). It must also have at least one module to show progress. |
| The Employee Forum card says "Employee Engagement only" | By design: Employee Engagement Senior Managers and the Administrator moderate the forum. Check the person's department in the Accounts tab. |
| An employee says they can't post in the forum | The thread may be locked, the category closed, or they posted more than 5 times in 10 minutes. Hidden threads and posts never show to employees. |
| Announcements say "Not set up yet", or the Employee Portal shows no announcements | `supabase/phase4.sql` hasn't been run. Paste it into the Supabase SQL editor (after the earlier files) and run it. Announcements are written in the Content tab, under Employee Engagement, in the Announcements row. |
| Performance Management says "Not set up yet", or the Evaluation forms tab is missing options | `supabase/phase5.sql` to `supabase/phase9.sql` haven't all been run. Paste each into the Supabase SQL editor (in that order, after the earlier files) and run it. Phase 7 adds the extra question types (short answer, paragraph, multiple choice, checkboxes, dropdown, linear scale, stars, date, time); without it only linear-scale and paragraph questions save. Phase 9 lets each linear-scale question have its own length and point names. Phase 8 lets a form that already has evaluations be deleted, and lets a manager evaluation be deleted even once finalised. Evaluation forms (Self, Peer, Manager) are created by Total Rewards and the Administrator in the Content tab, Total Rewards panel, Performance Management System. Every Senior Manager can evaluate with Manager forms. Employees fill Self and Peer forms on their dashboard. |
| Vacancies, Applicant Tracking System or Recruitment and Selection Records says "Not set up yet", or the Careers page shows no positions | `supabase/careers.sql`, then `supabase/careers_seed.sql` (the 20 poster vacancies as drafts), then `supabase/recruitment.sql` haven't all been run. Paste each into the Supabase SQL editor, in that order. A vacancy shows on Careers only after it is published and inside its dates. |
| An announcement doesn't show for employees | It may be hidden (the eye icon in the Announcements screen). Employees see the 30 newest posted announcements, three at first with a button for the older ones. |
| The employee dashboard is slow to appear | It now loads in one request. If it is still slow, the usual cause is a Supabase project that was paused for inactivity: restore it from the Supabase dashboard (the first request after a pause can take a minute). |
