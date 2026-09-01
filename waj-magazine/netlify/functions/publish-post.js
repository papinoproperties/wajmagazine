// netlify/functions/publish-post.js
// Publishes, schedules, updates, or deletes a post in content/posts.json
// by committing directly to GitHub. Requires GITHUB_TOKEN env var (repo scope).
// Protected by Netlify Identity — only logged-in invited users can call this.

const REPO = 'papinoproperties/wajmagazine';
const FILE_PATH = 'waj-magazine/content/posts.json';
const BRANCH = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function rehostImageIfNeeded(imageUrl, GH_HEADERS) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('/assets/')) return imageUrl;
  if (!imageUrl.startsWith('http')) return imageUrl;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return imageUrl;
    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const ct = imgRes.headers.get('content-type') || '';
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
    const filename = `post-${Date.now()}.${ext}`;
    const uploadPath = `waj-magazine/assets/uploads/${filename}`;
    const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${uploadPath}`, {
      method: 'PUT',
      headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Upload post image: ${filename}`, content: base64, branch: BRANCH }),
    });
    if (!putRes.ok) return imageUrl;
    return `/assets/uploads/${filename}`;
  } catch { return imageUrl; }
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Not authenticated' }) };

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'GITHUB_TOKEN not configured' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { action, post, originalSlug } = body;
  if (!action || !['create','update','delete'].includes(action)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'action must be create, update, or delete' }) };
  }

  const GH_API = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const GH_HEADERS = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'WAJ-Magazine-Publisher',
  };

  try {
    // 1. Read current posts.json
    const getRes = await fetch(`${GH_API}?ref=${BRANCH}`, { headers: GH_HEADERS });
    if (!getRes.ok) {
      const errText = await getRes.text();
      throw new Error(`Failed to read posts.json (${getRes.status}): ${errText}`);
    }
    const fileData = await getRes.json();
    const sha = fileData.sha;
    let data = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
    if (!Array.isArray(data.posts)) data.posts = [];

    let resultPost = null;
    let commitMessage = '';

    if (action === 'create') {
      if (!post || !post.title || !post.content) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'title and content are required' }) };
      }
      let slug = slugify(post.slug || post.title) || ('post-' + Date.now());
      const used = new Set(data.posts.map(p => p.slug));
      let final = slug, n = 2;
      while (used.has(final)) { final = `${slug}-${n}`; n++; }

      // Determine status based on publishDate
      const isScheduled = post.publishDate && new Date(post.publishDate) > new Date();
      const permanentImage = await rehostImageIfNeeded(post.image, GH_HEADERS);

      resultPost = {
        slug: final,
        title: post.title,
        author: post.author || 'WAJ Editorial',
        category: post.category || 'Community',
        date: new Date().toISOString().split('T')[0],
        publishDate: post.publishDate || null,
        image: permanentImage || '/assets/images/Cover_2_.png',
        summary: post.summary || post.content.slice(0, 160).replace(/\s+\S*$/, '') + '…',
        content: post.content,
        featured: !!post.featured,
        status: isScheduled ? 'scheduled' : 'published',
      };
      data.posts.unshift(resultPost);
      commitMessage = isScheduled
        ? `Schedule post: ${resultPost.title} (${post.publishDate})`
        : `Publish post: ${resultPost.title}`;

    } else if (action === 'update') {
      if (!originalSlug) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'originalSlug required for update' }) };
      const idx = data.posts.findIndex(p => p.slug === originalSlug);
      if (idx === -1) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Post not found: ' + originalSlug }) };
      const existing = data.posts[idx];

      let newSlug = existing.slug;
      if (post.slug && slugify(post.slug) !== existing.slug) {
        const candidate = slugify(post.slug);
        const used = new Set(data.posts.filter((_,i) => i !== idx).map(p => p.slug));
        let final = candidate, n = 2;
        while (used.has(final)) { final = `${candidate}-${n}`; n++; }
        newSlug = final;
      }

      const isScheduled = post.publishDate && new Date(post.publishDate) > new Date();
      const permanentImage = post.image ? await rehostImageIfNeeded(post.image, GH_HEADERS) : existing.image;

      resultPost = {
        ...existing,
        slug: newSlug,
        title: post.title || existing.title,
        author: post.author || existing.author,
        category: post.category || existing.category,
        image: permanentImage || existing.image,
        summary: post.summary || existing.summary,
        content: post.content || existing.content,
        featured: post.featured !== undefined ? !!post.featured : existing.featured,
        publishDate: post.publishDate !== undefined ? (post.publishDate || null) : existing.publishDate,
        status: isScheduled ? 'scheduled' : 'published',
      };
      data.posts[idx] = resultPost;
      commitMessage = `Update post: ${resultPost.title}`;

    } else if (action === 'delete') {
      if (!originalSlug) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'originalSlug required for delete' }) };
      const before = data.posts.length;
      data.posts = data.posts.filter(p => p.slug !== originalSlug);
      if (data.posts.length === before) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Post not found: ' + originalSlug }) };
      commitMessage = `Delete post: ${originalSlug}`;
    }

    // 2. Commit updated file to GitHub
    const newBase64 = Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64');
    const putRes = await fetch(GH_API, {
      method: 'PUT',
      headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${commitMessage} (via WAJ admin — ${user.email || 'unknown'})`,
        content: newBase64, sha, branch: BRANCH,
      }),
    });
    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub commit failed (${putRes.status}): ${errText}`);
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, action, post: resultPost }) };

  } catch(err) {
    console.error('publish-post error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
