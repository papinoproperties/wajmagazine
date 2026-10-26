// Build step: turns content/catalog.json into a product page for every magazine
// issue at /issues/<slug>, adds Google-ready product data (price, stock,
// shipping, returns), lists every issue on the Shop page for search engines,
// updates the sitemap, and writes the product feed used by Google Merchant
// Center and Pinterest (/pinterest-products.csv).
// Uses only Node built-ins; any failure leaves the rest of the site untouched.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITE = 'https://wajmagazine.com';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (u) => (/^https?:/.test(u) ? u : SITE + (u.startsWith('/') ? u : '/' + u));
const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const csv = (v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const money = (n) => Number(n).toFixed(2);

// Names too generic to match inside articles reliably.
const NO_ARTICLE_MATCH = new Set(['WAJ-036-KIA', 'WAJ-040-THE-ARTIST']);

export function loadCatalog() {
  const f = path.join(ROOT, 'content/catalog.json');
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).issues || []) : [];
}

export function issueForText(issues, text) {
  for (const i of issues) {
    if (NO_ARTICLE_MATCH.has(i.id)) continue;
    const n = i.name.replace(/^The /, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Za-z0-9])${n}([^A-Za-z0-9]|$)`, 'i').test(text)) return i;
  }
  return null;
}

function publishedPosts() {
  const f = path.join(ROOT, 'content/posts.json');
  if (!fs.existsSync(f)) return [];
  const now = new Date();
  return (JSON.parse(fs.readFileSync(f, 'utf8')).posts || [])
    .filter((p) => p.status === 'published' && !p.trash && (!p.publishDate || new Date(p.publishDate) <= now) && /^[a-z0-9-]+$/.test(p.slug || ''));
}

function productSchema(i, url) {
  const inStock = i.inStock !== false ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
  const title = `${i.name} | WAJ Magazine ${i.edition}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    image: [abs(i.image)],
    description: `WAJ Magazine ${i.edition} featuring ${i.name} on the cover. Available as a digital PDF ($${money(i.priceDigital)}) or a print copy ($${money(i.pricePrint)} plus $${money(i.shippingPrint)} shipping).`,
    sku: i.id,
    mpn: i.id,
    category: 'Media > Magazines',
    brand: { '@type': 'Brand', name: 'WAJ Magazine' },
    offers: [
      {
        '@type': 'Offer', name: 'Print copy', sku: `${i.id}-PRINT`, url, priceCurrency: 'USD', price: money(i.pricePrint),
        availability: inStock, itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: 'WAJ Magazine' },
        shippingDetails: {
          '@type': 'OfferShippingDetails',
          shippingRate: { '@type': 'MonetaryAmount', value: money(i.shippingPrint), currency: 'USD' },
          shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
        },
        hasMerchantReturnPolicy: {
          '@type': 'MerchantReturnPolicy', applicableCountry: 'US',
          returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
          merchantReturnDays: 4, returnMethod: 'https://schema.org/ReturnByMail',
          merchantReturnLink: `${SITE}/terms#print-purchases`,
        },
      },
      {
        '@type': 'Offer', name: 'Digital PDF', sku: `${i.id}-DIGITAL`, url, priceCurrency: 'USD', price: money(i.priceDigital),
        availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: 'WAJ Magazine' },
        hasMerchantReturnPolicy: {
          '@type': 'MerchantReturnPolicy', applicableCountry: 'US',
          returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
          merchantReturnLink: `${SITE}/terms`,
        },
      },
    ],
  };
}

function page(i, issues, related) {
  const url = `${SITE}/issues/${i.slug}`;
  const title = `${i.name} | WAJ Magazine ${i.edition}`;
  const desc = `Shop WAJ Magazine ${i.edition} featuring ${i.name}. Digital PDF $${money(i.priceDigital)}, delivered by email within 24 hours; print $${money(i.pricePrint)} plus $${money(i.shippingPrint)} shipping.`;
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'Shop', item: `${SITE}/shop` },
    { '@type': 'ListItem', position: 3, name: title, item: url }] };
  const others = issues.filter((o) => o.id !== i.id).slice(0, 6);
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/assets/images/waj-red-logo.png" type="image/png">
<meta property="og:type" content="product">
<meta property="og:site_name" content="WAJ Magazine">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${abs(i.image)}">
<meta property="og:image:alt" content="${esc(title)} cover">
<meta property="product:price:amount" content="${money(i.priceDigital)}">
<meta property="product:price:currency" content="USD">
<meta name="twitter:card" content="summary_large_image">
${ld(productSchema(i, url))}
${ld(crumbs)}
<script async src="https://www.googletagmanager.com/gtag/js?id=G-MBG1ZXVMHE"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-MBG1ZXVMHE');</script>
<style>*{box-sizing:border-box}body{margin:0;color:#1a1a1a;background:#fff;font-family:Arial,sans-serif;line-height:1.6}header{background:#0a0a0a;color:white;padding:20px 6%;display:flex;gap:24px;justify-content:space-between;flex-wrap:wrap}a{color:inherit}header a{font-weight:bold;text-decoration:none}nav{display:flex;gap:24px;flex-wrap:wrap}main{max-width:1080px;margin:48px auto;padding:0 24px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}img{width:100%;height:auto;display:block}h1{line-height:1.15;font-size:clamp(2rem,4vw,3.2rem);margin:12px 0 20px}.crumbs{font-size:.85rem;color:#777;margin:0}.crumbs a{text-decoration:none}.edition{color:#7a0000;font-weight:bold;letter-spacing:.1em;text-transform:uppercase}.option{display:block;border:2px solid #7a0000;padding:16px 20px;margin:20px 0;text-decoration:none}.option strong{display:block;font-size:1.15rem}.option:first-of-type{background:#7a0000;color:white}.option:hover,.option:focus-visible{outline:3px solid #111;outline-offset:3px}small{display:block}.stock{display:inline-block;background:#e9f7ef;color:#1e7e34;font-weight:bold;font-size:.8rem;padding:4px 10px;border-radius:3px}.merch{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:#0a0a0a;color:#fff;padding:18px 22px;margin-top:28px}.merch a{background:#7a0000;color:#fff;text-decoration:none;font-weight:bold;padding:10px 18px;font-size:.85rem;letter-spacing:.08em;text-transform:uppercase}.more{max-width:1080px;margin:0 auto 56px;padding:0 24px}.more h2{font-size:1.4rem;border-top:1px solid #ddd;padding-top:28px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px}.grid a{text-decoration:none;font-size:.9rem;font-weight:bold}.grid span{display:block;color:#7a0000;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase}.reads li{margin:8px 0}footer{padding:24px 6%;border-top:1px solid #ddd;display:flex;gap:24px;flex-wrap:wrap}@media(max-width:700px){main{grid-template-columns:1fr;gap:24px;margin:24px auto}main>img{max-width:400px;margin:auto}}</style>
</head>
<body>
<header><a href="/">WAJ MAGAZINE</a><nav aria-label="Main"><a href="/shop">Shop all issues</a><a href="/apparel" target="_blank" rel="noopener">Apparel</a><a href="/blog">Read stories</a></nav></header>
<main>
<img src="${esc(i.image)}" alt="${esc(title)} cover" width="900" height="1200" fetchpriority="high">
<section>
<p class="crumbs"><a href="/">Home</a> / <a href="/shop">Shop</a> / ${esc(i.name)}</p>
<p class="edition">WAJ Magazine · ${esc(i.edition)}</p>
<h1>${esc(i.name)}</h1>
<p><span class="stock">${i.inStock !== false ? 'In stock' : 'Sold out'}</span></p>
<p>WAJ Magazine ${esc(i.edition)} features ${esc(i.name)} on the cover. Choose a digital PDF or a print copy below.</p>
<a class="option" href="/shop?issue=${i.id}&amp;format=digital#${i.id}"><strong>Choose digital PDF — $${money(i.priceDigital)}</strong><small>Delivered by email within 24 hours</small></a>
<a class="option" href="/shop?issue=${i.id}&amp;format=print#${i.id}"><strong>Choose print — $${money(i.pricePrint)}</strong><small>Plus $${money(i.shippingPrint)} shipping. Processed and shipped within 5–7 business days.</small></a>
<p><a href="/terms#print-purchases">Shipping &amp; returns policy</a></p>
<p>You'll select this issue in the shop before continuing to secure Stripe checkout.</p>
<div class="merch"><span>Rep the culture — official WAJ apparel</span><a href="/apparel" target="_blank" rel="noopener">Shop apparel ↗</a></div>
</section>
</main>
${related.length ? `<section class="more"><h2>Read more about ${esc(i.name)}</h2><ul class="reads">${related.map((p) => `<li><a href="/blog/${p.slug}">${esc(p.title)}</a></li>`).join('')}</ul></section>` : ''}
<section class="more"><h2>More WAJ Magazine issues</h2><div class="grid">${others.map((o) => `<a href="/issues/${o.slug}"><img src="${esc(o.image)}" alt="${esc(o.name)} WAJ Magazine ${esc(o.edition)} cover" loading="lazy" width="300" height="400"><span>${esc(o.edition)}</span>${esc(o.name)}</a>`).join('')}</div></section>
<footer><a href="/shop">All magazine issues</a><a href="/apparel" target="_blank" rel="noopener">Apparel</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms#print-purchases">Shipping &amp; returns</a><a href="/terms">Terms</a></footer>
<script src="/assets/js/pinterest-measurement.js" defer></script>
</body>
</html>
`;
}

function main() {
  const issues = loadCatalog();
  if (!issues.length) { console.log('[build-issues] no catalog; skipping'); return; }
  const posts = publishedPosts();
  const outDir = path.join(ROOT, 'issues');
  fs.mkdirSync(outDir, { recursive: true });
  let made = 0;
  for (const i of issues) {
    try {
      const related = NO_ARTICLE_MATCH.has(i.id) ? [] : posts.filter((p) => issueForText([i], `${p.title} ${strip(p.content)}`)).slice(0, 5);
      fs.writeFileSync(path.join(outDir, `${i.slug}.html`), page(i, issues, related));
      made++;
    } catch (e) { console.log(`[build-issues] skipped ${i.id}: ${e.message}`); }
  }

  // Shop page: tell search engines about every issue.
  const shop = path.join(ROOT, 'pages/shop.html');
  if (fs.existsSync(shop)) {
    const list = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'WAJ Magazine issues',
      itemListElement: issues.map((i, k) => ({ '@type': 'ListItem', position: k + 1, url: `${SITE}/issues/${i.slug}`, name: `${i.name} | WAJ Magazine ${i.edition}` })) };
    const s = fs.readFileSync(shop, 'utf8');
    if (s.includes('<!--ISSUES-ITEMLIST-->')) fs.writeFileSync(shop, s.replace('<!--ISSUES-ITEMLIST-->', `<script type="application/ld+json">${JSON.stringify(list)}</script>`));
  }

  // Sitemap: replace issue entries with the full list.
  const sm = path.join(ROOT, 'sitemap.xml');
  if (fs.existsSync(sm)) {
    let x = fs.readFileSync(sm, 'utf8').replace(/\s*<url><loc>https:\/\/wajmagazine\.com\/issues\/[^<]+<\/loc>[\s\S]*?<\/url>/g, '');
    x = x.replace('</urlset>', issues.map((i) => `  <url><loc>${SITE}/issues/${i.slug}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>`).join('\n') + '\n</urlset>');
    fs.writeFileSync(sm, x);
  }

  // Product feed (print copies) for Google Merchant Center and Pinterest.
  const head = 'id,title,description,link,image_link,price,availability,item_group_id,brand,condition,product_type,shipping,google_product_category';
  const rows = issues.map((i) => [
    `${i.id}-PRINT`, `${i.name} | WAJ Magazine ${i.edition} - Print`,
    `Print copy of WAJ Magazine ${i.edition} featuring ${i.name}. Print price $${money(i.pricePrint)} plus $${money(i.shippingPrint)} shipping. Processed and shipped within 5-7 business days.`,
    `${SITE}/issues/${i.slug}`, abs(i.image), `${money(i.pricePrint)} USD`, i.inStock !== false ? 'in stock' : 'out of stock',
    i.id, 'WAJ Magazine', 'new', 'Media > Magazines', `US:::${money(i.shippingPrint)} USD`, '543539'].map(csv).join(','));
  fs.writeFileSync(path.join(ROOT, 'pinterest-products.csv'), [head, ...rows].join('\n') + '\n');
  console.log(`[build-issues] generated ${made} issue pages`);
}

if (process.argv[1] && process.argv[1].endsWith('build-issues.mjs')) {
  try { main(); } catch (e) { console.log('[build-issues] failed, site deploys unchanged:', e.message); }
}
