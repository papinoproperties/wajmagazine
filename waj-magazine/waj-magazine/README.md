# WAJ Magazine Website

**wajmagazine.com** — Uniting Creatives, Community & Culture

---

## File Structure

```
waj-magazine/
├── index.html              ← Homepage
├── assets/
│   └── images/             ← All cover images + logo go here
└── pages/
    ├── issues.html         ← All Issues archive
    ├── features.html       ← Features page
    ├── advertise.html      ← Advertise & Partner
    └── contact.html        ← Contact page
```

## Pages Included

- **Homepage** (index.html) — Hero, latest issue, cover archive grid, categories, mission, advertise CTA, footer
- **Issues** (pages/issues.html) — Full cover archive with filter bar
- **Features** (pages/features.html) — Editorial feature spotlights
- **Advertise** (pages/advertise.html) — Sponsorship packages + inquiry form
- **Contact** (pages/contact.html) — Split-layout contact form

## Still To Build (next steps)
- `pages/blog.html` — Blog articles
- `pages/shop.html` — Digital + physical products (connect Stripe or Shopify Buy Button)
- `pages/about.html` — About WAJ / mission page

## Deploying to Netlify

1. Push this folder to a GitHub repository
2. Connect the repo to Netlify (netlify.com → New Site from Git)
3. Set publish directory to `/` (root)
4. Point your domain `wajmagazine.com` to Netlify DNS

## Brand Colors
- Crimson: `#7A0000`
- Black: `#0A0A0A`
- White: `#FFFFFF`

## Cross-Links to We Are Jersey ENT
Every page links to `https://www.wearejerseyent.com` via:
- Navigation bar button (top right)
- Footer link (bottom right)
