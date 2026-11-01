# Members area setup

An invite-only document library for the SINAGLIKHA team. People sign in with an email and
password. Only people an administrator invites can get in. Files are kept in private storage
(not in GitHub) and are only handed out to signed-in members.

You'll set up three things: **Supabase** (logins and file storage), the **site settings**
(two values in `members/config.js`), and **Vercel** (so admins can send invitations from the
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
- any active member can **view and download**,
- only **admins** can **upload and delete**.

### 3. Make sign-up invite-only
1. Open **Authentication**, then **Sign In / Providers** (the wording changes between Supabase versions).
2. Turn **off** "Allow new users to sign up". This is the most important switch. With it off,
   nobody can create an account on their own.
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
4. Commit and push that file.

> The **anon** key is designed to be public, so it is fine in the repository. The
> **service_role** key is a secret. Never put it in `config.js` or anywhere in GitHub.

### 6. Set the biggest file size (optional)
**Storage**, then **Settings**: choose the global file size limit. The free plan allows up to 50 MB
per file. Keep `MAX_UPLOAD_MB` in `members/config.js` at or below it.

---

## Part B. Create the first admin (you)
1. Supabase: **Authentication**, then **Users**, then **Add user**, then **Send invitation**.
   Enter your own email.
2. Open the email and click the link. It opens `/members/` and asks you to **set a password**.
3. In **SQL Editor** run (use your email):

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
4. Reload the members page. You should now see **Upload files**, **New folder**, and a **People** tab.

---

## Part C. Vercel (needed only for inviting from the website)
Signing in and the file library work on any host. **Sending invitations from the People tab**
needs the server function in `api/invite.js`, which runs on Vercel.
(You can always invite from the Supabase dashboard instead.)

1. In Vercel, import this repository (**Add New**, then **Project**). Leave the build settings alone.
2. Open **Project**, then **Settings**, then **Environment Variables** and add these four:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL from step A5 |
   | `SUPABASE_ANON_KEY` | the anon key from step A5 |
   | `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** key (Project Settings, API). Secret. |
   | `SITE_URL` | your site address, for example `https://sinaglikha.vercel.app` |

3. **Redeploy** so the variables take effect.

---

## Everyday use
- **Invite someone:** Members area, **People**, enter their email, **Send invitation**. They
  click the link in the email and choose a password.
- **Make someone an admin:** People tab, change **Member** to **Admin**.
- **Remove access:** People tab, **Deactivate** (instant). To delete the account completely use
  Supabase, **Authentication**, **Users**.
- **Add files:** open **Library**, then **Upload files**, or drag files onto the list. Use **New folder** to organize.
- **Let every member upload:** see the optional block at the bottom of `supabase/schema.sql`.

## What this does and doesn't protect
- Only invited people can sign in. Everyone who is active sees **every** file. There are no
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
| Invitation link says "expired" | The address isn't in **Redirect URLs** (step A4), or an email scanner already opened the link. Send a new invitation. |
| Signed in but "This account isn't active" | The account has no profile row or was deactivated. Re-run `schema.sql`, or check the People tab. |
| No Upload button | Your role isn't `admin` yet (step B3). |
| "Couldn't send the invitation" | One of the four Vercel variables is missing, or you haven't redeployed. |
| "In-site invitations only work on the Vercel version" | You're on GitHub Pages. Invite from the Supabase dashboard, or use the Vercel address. |
| Upload says "already exists" | A file with that name is in the folder. Rename it or delete the old one. |
