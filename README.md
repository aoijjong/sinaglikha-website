# SINAGLIKHA website

Corporate website for SINAGLIKHA, a Filipino solar energy company, and the official site for our HR simulation.
It is a single static page (`index.html`) with no build step.

## Run locally

Open `index.html` in a browser, or serve the folder:

```
python -m http.server 5173
```

## Add approved company details

Edit the `CONFIG` block near the bottom of `index.html`:

- `location`: address, city/province, office hours, map query (enables the map and Get Directions)
- `contact`: email, phone, social links
- `formEndpoint`: optional form service URL for the contact form
- `team`: names, positions, photos and bios

Anything left empty shows as "To be provided". Nothing is invented.

## Members area (invite-only 201 Files)

`/members/` is a private area for the team's 201 Files. Sign-in and files run on Supabase, and Senior Managers can
invite people from the site through a small Vercel function.

- `members/` the sign-in page and HR 201 file area (`config.js` holds the two Supabase settings)
- `api/invite.js` sends invitations (Senior Managers only; runs on Vercel)
- `supabase/schema.sql` creates the people list, the private `library` bucket, and the access rules
- `docs/members-setup.md` step-by-step setup

Never commit the Supabase `service_role` key. It belongs only in Vercel's environment variables.

## Photos

The photos are free-to-use Unsplash images, loaded directly from `images.unsplash.com`, so the page needs an internet
connection to show them. To use your own photos, save them in `assets/` and replace the matching `<img src="...">` in `index.html`.

## Notes

- Employee (HR 201) records are confidential and must never be committed to this repository.
- `assets/source/` keeps the original logo exports. The site uses `assets/sinaglikha-logo-notag.png` (the logo without its tagline).
  It is an interim version cut from the original; replace that one file with the official logo when it is supplied.
