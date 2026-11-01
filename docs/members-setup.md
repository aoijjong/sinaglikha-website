# Members area setup

An invite-only area for the SINAGLIKHA HR 201 files. People sign in with an email and
password. Only people a Senior manager invites can get in. Files are kept in private storage
(not in GitHub) and are only handed out to signed-in Senior managers.

## Who can do what
| Role | Files (view, download, upload, new folder, delete) | People (invite, deactivate, reactivate, delete) | Set roles | Visible in the People list |
|---|---|---|---|---|
| **Senior manager** | Yes, everything | Yes, for other Senior managers | No | Yes |
| **Administrator** (the owner) | Yes, everything | Yes, for everyone | Yes | **No, hidden** |

Everyone who is invited starts as a Senior manager. The Administrator account is the owner's:
it is hidden from the People list, so no Senior manager can see it, deactivate it, delete it
or change its role. There are no other roles.

You'll set up three things: **Supabase** (logins and file storage), the **site settings**
(two values in `members/config.js`), and **Vercel** (so Senior managers can send invitations from the
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
- every active **Senior manager** (and the Administrator) can **view, download, upload, create folders and delete**,
- nobody else can do anything.

**Before you press Run, edit one line.** Near the top, in the block marked `EDIT THIS`, replace
`YOUR-ADMIN-EMAIL@example.com` with the email you sign in with. Do this only in the Supabase SQL
editor, not in the file on GitHub. If your project already has accounts from the old Member/Admin
setup, this one run also converts them: everybody becomes a Senior manager, and the email you typed
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
   Your own account won't be listed in the People tab. That is intended.

---

## Part C. Vercel (needed only for inviting from the website)
Signing in and the HR 201 files work on any host. **Sending invitations from the People tab**
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
4. **Test it:** sign in, open **People**, and invite a second email address you own.
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
- **Invite someone:** Members area, **People**, enter their email, **Send invitation**. They
  click the link in the email and choose a password.
- **Roles:** everyone you invite is a **Senior manager** with full file access and can invite and
  manage other Senior managers. Only the hidden Administrator can change a role (People tab, role menu).
- **Remove access:** People tab, **Deactivate** (instant). The account moves out of the main list
  into **Show deactivated accounts**, where you can **Reactivate** it or **Delete** it for good.
  Deleting frees the email so the person can be invited again. You can't delete yourself, and you
  must deactivate an account before deleting it. If an account has uploaded files, Supabase won't
  delete it, so keep it deactivated. Deleting from the website needs the Vercel settings from Part C.
- **Add files:** open **Files**, then **Upload files**, or drag files onto the list. Use **New folder** to organize.

## What this does and doesn't protect
- Only invited people can sign in. Every active Senior manager sees and can change **every** file. There are no
  per-folder permissions yet.
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
| Signed in but "This account isn't active" | The account has no profile row or was deactivated. Re-run `schema.sql`, or check the People tab. |
| No Upload button | The account isn't an active Senior manager or Administrator. Re-run `schema.sql` (with the owner email edited), or reactivate it from the People tab. |
| `schema.sql` stops with "The owner email … was not found" | The email in the `EDIT THIS` block doesn't match your account. Fix it in the SQL editor and run again. Nothing was changed. |
| My own account doesn't appear in People | By design: the Administrator account is hidden. |
| "Email rate limit exceeded" or "Too many emails were sent recently" | Supabase's built-in sender only allows about 2 emails an hour. Wait an hour, or set up your own sender (Part D). |
| "Couldn't send the invitation" | One of the four Vercel variables is missing, or you haven't redeployed. |
| "In-site invitations only work on the Vercel version" | You're on GitHub Pages. Invite from the Supabase dashboard, or use the Vercel address. |
| Upload says "already exists" | A file with that name is in the folder. Rename it or delete the old one. |
