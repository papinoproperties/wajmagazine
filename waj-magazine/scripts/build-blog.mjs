// Build step (runs on every Netlify deploy): turns content/posts.json into
// real, crawlable article pages at /blog/<slug>, adds them to sitemap.xml,
// and redirects old /post?slug=<slug> links to the new addresses.
// Uses only Node built-ins. Any problem with one post is logged and skipped,
// so a bad post can never break the whole site deploy.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITE = 'https://wajmagazine.com';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const stripHtml = (s) => String(s ?? '')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const abs = (u) => (!u ? `${SITE}/assets/images/waj-red-logo.png` : /^https?:\/\//.test(u) ? u : SITE + (u.startsWith('/') ? u : '/' + u));
const fmtDate = (d) => {
  const t = new Date(String(d) + 'T12:00:00Z');
  return isNaN(t) ? '' : t.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
// Same paragraph logic the existing post page uses, so articles look identical.
const paragraphs = (c) => String(c ?? '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${p.trim()}</p>`).join('');

function main() {
  const postsFile = path.join(ROOT, 'content/posts.json');
  const tplFile = path.join(ROOT, 'pages/post.html');
  if (!fs.existsSync(postsFile) || !fs.existsSync(tplFile)) {
    console.log('[build-blog] posts.json or post.html missing; skipping');
    return;
  }
  const all = (JSON.parse(fs.readFileSync(postsFile, 'utf8')).posts || []);
  const now = new Date();
  // Same visibility rules as the Blog page.
  const posts = all
    .filter((p) => p && p.status === 'published' && !p.trash && (!p.publishDate || new Date(p.publishDate) <= now))
    .filter((p) => SLUG_RE.test(p.slug || ''))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const tpl = fs.readFileSync(tplFile, 'utf8');
  const headEnd = tpl.indexOf('</head>');
  const navStart = tpl.indexOf('<nav>');
  const containerStart = tpl.indexOf('<div id="articleContainer">');
  const footerStart = tpl.indexOf('<footer>');
  const loaderStart = tpl.indexOf('// ── LOAD POST ──');
  if ([headEnd, navStart, containerStart, footerStart, loaderStart].some((i) => i < 0)) {
    console.log('[build-blog] post.html layout changed; skipping page generation');
    return;
  }
  // Pieces of the existing article page we reuse (styles, nav, footer, menu, AdSense, analytics).
  const headBits = tpl.slice(0, headEnd)
    .replace(/<title[^>]*>[\s\S]*?<\/title>/, '')
    .replace(/<meta name="description"[^>]*>/, '')
    .replace(/<meta property="og:[^>]*>/g, '');
  const navHtml = tpl.slice(tpl.indexOf('</head>') + 7, containerStart).replace('<body>', '');
  const tail = tpl.slice(footerStart, loaderStart) + '</script>\n</body>\n</html>\n';

  const outDir = path.join(ROOT, 'blog');
  fs.mkdirSync(outDir, { recursive: true });
  const redirects = [];
  let made = 0;

  for (const post of posts) {
    try {
      const url = `${SITE}/blog/${post.slug}`;
      // Some saved SEO titles were cut off mid-phrase ("...Frozen: What"); use the headline instead.
      const seo = (post.seoTitle || '').trim();
      const looksCut = /[:,;—–-]$/.test(seo) || /\s(a|an|and|the|to|of|for|in|on|at|with|from|what|how|why|is|are|or|but|by|as|its|their|your|our)$/i.test(seo);
      const title = (seo && !looksCut) ? seo : post.title;
      const desc = clip((post.metaDescription || '').trim() || (post.summary || '').trim() || stripHtml(post.content), 158);
      const img = abs(post.image);
      const alt = (post.altText || '').trim() || post.title;
      const related = posts.filter((r) => r.slug !== post.slug && r.category === post.category).slice(0, 3);
      const schema = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: clip(post.title, 110),
        description: desc,
        image: img,
        author: { '@type': 'Person', name: post.author || 'WAJ Editorial' },
        publisher: { '@type': 'Organization', name: 'WAJ Magazine', logo: { '@type': 'ImageObject', url: `${SITE}/assets/images/waj-red-logo.png` } },
        datePublished: post.date,
        dateModified: post.date,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        articleSection: post.category || undefined,
        keywords: [...(post.tags || []), post.category, 'New Jersey', 'WAJ Magazine'].filter(Boolean).join(', '),
      };
      const crumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      };
      const relatedHtml = related.length ? `
        <div class="related-section">
          <div class="related-inner">
            <h3>More in ${esc(post.category)}</h3>
            <div class="related-grid">
              ${related.map((r) => `
                <a href="/blog/${r.slug}" class="related-card" style="display:block;">
                  <img src="${esc(r.image)}" alt="${esc(r.altText || r.title)}" loading="lazy" onerror="this.style.display='none'"/>
                  <div class="body">
                    <span class="cat">${esc(r.category)}</span>
                    <h4>${esc(r.title)}</h4>
                  </div>
                </a>`).join('')}
            </div>
          </div>
        </div>` : '';
      const shareUrl = encodeURIComponent(url);
      const html = `${headBits}
  <title>${esc(title)} — WAJ Magazine</title>
  <meta name="description" content="${esc(desc)}"/>
  <link rel="canonical" href="${url}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:site_name" content="WAJ Magazine"/>
  <meta property="og:url" content="${url}"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(desc)}"/>
  <meta property="og:image" content="${esc(img)}"/>
  <meta property="article:published_time" content="${esc(post.date)}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(desc)}"/>
  <meta name="twitter:image" content="${esc(img)}"/>
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
  <script type="application/ld+json">${JSON.stringify(crumbs).replace(/</g, '\\u003c')}</script>
</head>
<body>
${navHtml}
  <div id="articleContainer">
    <article>
      <div class="article-hero">
        <a href="/blog" class="back-link">← Back to Blog</a>
        <span class="cat-tag">${esc(post.category)}</span>
        <h1>${esc(post.title)}</h1>
        <div class="article-meta">
          <strong>${esc(post.author || 'WAJ Editorial')}</strong> · <time datetime="${esc(post.date)}">${fmtDate(post.date)}</time>
        </div>
      </div>
      ${post.image ? `<img src="${esc(post.image)}" alt="${esc(alt)}" class="hero-img" fetchpriority="high" onerror="this.style.display='none'"/>` : ''}
      <div class="article-body">
        ${paragraphs(post.content)}
        <div class="share-row">
          <span>Share:</span>
          <a class="share-btn" href="https://twitter.com/intent/tweet?url=${shareUrl}&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener" title="Share on Twitter/X">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#555"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a class="share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener" title="Share on Facebook">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#555"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/></svg>
          </a>
          <a class="share-btn" href="javascript:void(0)" onclick="navigator.clipboard.writeText('${url}');this.querySelector('svg').style.fill='#7A0000';" title="Copy Link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#555"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7C4.24 7 2 9.24 2 12s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
          </a>
        </div>
      </div>
    </article>
    ${relatedHtml}
  </div>

  ${tail}`;
      fs.writeFileSync(path.join(outDir, `${post.slug}.html`), html);
      redirects.push(`/post  slug=${post.slug}  /blog/${post.slug}  301!`);
      made++;
    } catch (e) {
      console.log(`[build-blog] skipped "${post.slug}": ${e.message}`);
    }
  }

  // Old links (/post?slug=...) permanently point to the new article addresses.
  // _redirects is read before netlify.toml, so these win over the /post rule there.
  const redirFile = path.join(ROOT, '_redirects');
  const existing = fs.existsSync(redirFile) ? fs.readFileSync(redirFile, 'utf8') : '';
  fs.writeFileSync(redirFile, `# Generated by scripts/build-blog.mjs\n${redirects.join('\n')}\n${existing}`);

  // Sitemap: keep the hand-written entries, then list every live article.
  const smFile = path.join(ROOT, 'sitemap.xml');
  if (fs.existsSync(smFile)) {
    let sm = fs.readFileSync(smFile, 'utf8').replace(/\s*<url><loc>https:\/\/wajmagazine\.com\/blog\/[^<]+<\/loc>[\s\S]*?<\/url>/g, '');
    const latest = posts[0]?.date;
    if (latest) sm = sm.replace(/(<loc>https:\/\/wajmagazine\.com\/blog<\/loc>[\s\S]*?<lastmod>)[^<]*(<\/lastmod>)/, `$1${latest}$2`);
    const entries = posts.map((p) => `  <url><loc>${SITE}/blog/${p.slug}</loc>${/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? `<lastmod>${p.date}</lastmod>` : ''}<changefreq>monthly</changefreq><priority>0.7</priority></url>`).join('\n');
    sm = sm.replace('</urlset>', `${entries}\n</urlset>`);
    fs.writeFileSync(smFile, sm);
  }
  console.log(`[build-blog] generated ${made} article pages`);
}

try { main(); } catch (e) { console.log('[build-blog] failed, site deploys unchanged:', e.message); }
