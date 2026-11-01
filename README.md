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

## Photos

The photos are free-to-use Unsplash images, loaded directly from `images.unsplash.com`, so the page needs an internet
connection to show them. To use your own photos, save them in `assets/` and replace the matching `<img src="...">` in `index.html`.

## Notes

- Employee (HR 201) records are confidential and must never be committed to this repository.
- `assets/source/` keeps the original logo exports; the site uses `assets/sinaglikha-logo.png`.
