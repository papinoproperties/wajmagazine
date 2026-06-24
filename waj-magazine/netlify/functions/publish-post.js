// netlify/functions/publish-post.js
// Publishes, updates, or deletes a post in content/posts.json by committing
// directly to GitHub. Requires GITHUB_TOKEN env var (repo scope).
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
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── AUTH CHECK — Netlify Identity ──
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Not authenticated. Please log in.' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'GITHUB_TOKEN is not configured in Netlify environment variables.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { action, post, originalSlug } = body;
  if (!action || !['create', 'update', 'delete'].includes(action)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'action must be create, update, or delete' }) };
  }

  const GH_API = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const GH_HEADERS = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'WAJ-Magazine-Publisher',
  };

  try {
    // ── 1. FETCH current posts.json from GitHub ──
    const getRes = await fetch(`${GH_API}?ref=${BRANCH}`, { headers: GH_HEADERS });
    if (!getRes.ok) {
      const errText = await getRes.text();
      throw new Error(`Failed to read posts.json from GitHub (${getRes.status}): ${errText}`);
    }
    const fileData = await getRes.json();
    const currentContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
    const sha = fileData.sha;
    let data = JSON.parse(currentContent);
    if (!Array.isArray(data.posts)) data.posts = [];

    let resultPost = null;
    let commitMessage = '';

    // ── 2. APPLY THE ACTION ──
    if (action === 'create') {
      if (!post || !post.title || !post.content) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'title and content are required' }) };
      }
      let slug = post.slug ? slugify(post.slug) : slugify(post.title);
      if (!slug) slug = 'post-' + Date.now();

      // Ensure unique slug
      const existingSlugs = new Set(data.posts.map(p => p.slug));
      let finalSlug = slug;
      let counter = 2;
      while (existingSlugs.has(finalSlug)) {
        finalSlug = `${slug}-${counter}`;
        counter++;
      }

      resultPost = {
        slug: finalSlug,
        title: post.title,
        author: post.author || 'WAJ Editorial',
        category: post.category || 'Community',
        date: post.date || new Date().toISOString().split('T')[0],
        image: post.image || '/assets/images/Cover_2_.png',
        summary: post.summary || post.content.slice(0, 160) + '…',
        content: post.content,
        featured: !!post.featured,
        status: 'published',
      };
      data.posts.unshift(resultPost);
      commitMessage = `Publish post: ${resultPost.title}`;

    } else if (action === 'update') {
      if (!originalSlug) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'originalSlug is required for update' }) };
      }
      const idx = data.posts.findIndex(p => p.slug === originalSlug);
      if (idx === -1) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Post not found: ' + originalSlug }) };
      }
      const existing = data.posts[idx];
      let newSlug = existing.slug;
      if (post.slug && slugify(post.slug) !== existing.slug) {
        newSlug = slugify(post.slug);
        const existingSlugs = new Set(data.posts.filter((p,i) => i !== idx).map(p => p.slug));
        let counter = 2;
        let candidate = newSlug;
        while (existingSlugs.has(candidate)) {
          candidate = `${newSlug}-${counter}`;
          counter++;
        }
        newSlug = candidate;
      }

      resultPost = {
        ...existing,
        slug: newSlug,
        title: post.title || existing.title,
        author: post.author || existing.author,
        category: post.category || existing.category,
        image: post.image || existing.image,
        summary: post.summary || existing.summary,
        content: post.content || existing.content,
        featured: post.featured !== undefined ? !!post.featured : existing.featured,
      };
      data.posts[idx] = resultPost;
      commitMessage = `Update post: ${resultPost.title}`;

    } else if (action === 'delete') {
      if (!originalSlug) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'originalSlug is required for delete' }) };
      }
      const before = data.posts.length;
      data.posts = data.posts.filter(p => p.slug !== originalSlug);
      if (data.posts.length === before) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Post not found: ' + originalSlug }) };
      }
      commitMessage = `Delete post: ${originalSlug}`;
    }

    // ── 3. COMMIT updated file back to GitHub ──
    const newContentBase64 = Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64');
    const putRes = await fetch(GH_API, {
      method: 'PUT',
      headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${commitMessage} (via WAJ admin — ${user.email || 'unknown'})`,
        content: newContentBase64,
        sha: sha,
        branch: BRANCH,
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`Failed to commit to GitHub (${putRes.status}): ${errText}`);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, action, post: resultPost }),
    };

  } catch (err) {
    console.error('Publish error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
