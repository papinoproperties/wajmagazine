const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER  = 'papinoproperties';
const REPO   = 'wajmagazine';
const PATH   = 'waj-magazine/content/posts.json';
const BRANCH = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(body)  { return { statusCode: 200, headers: CORS, body: JSON.stringify(body) }; }
function err(msg, code = 500) { return { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) }; }

// ── Robust GitHub API helper ──
function ghRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'User-Agent': 'WAJ-Admin/1.0',
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8').trim();
          let parsed = null;
          if (raw) {
            try { parsed = JSON.parse(raw); } catch { parsed = { _raw: raw }; }
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('GitHub API request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Read posts.json from GitHub ──
async function readPosts() {
  const r = await ghRequest('GET', `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  if (r.status === 404) return { sha: null, posts: [] };
  if (r.status !== 200) throw new Error(`GitHub read failed (${r.status}): ${r.body?.message || 'unknown error'}`);
  if (!r.body || !r.body.content) throw new Error('GitHub returned file with no content');
  const decoded = Buffer.from(r.body.content.replace(/\n/g, ''), 'base64').toString('utf8');
  let data;
  try { data = JSON.parse(decoded); } catch { throw new Error('posts.json is not valid JSON — check the file in GitHub'); }
  return { sha: r.body.sha, posts: data.posts || [] };
}

// ── Write posts.json to GitHub ──
async function writePosts(posts, sha, message) {
  const content = Buffer.from(JSON.stringify({ posts }, null, 2)).toString('base64');
  const body = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await ghRequest('PUT', `/repos/${OWNER}/${REPO}/contents/${PATH}`, body);
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`GitHub write failed (${r.status}): ${r.body?.message || JSON.stringify(r.body)}`);
  }
  return r.body;
}

// ── Auto-rehost external images ──
async function rehostImage(url) {
  return new Promise(resolve => {
    try {
      https.get(url, res => {
        const chunks = [];
        res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', async () => {
          try {
            const buf = Buffer.concat(chunks);
            const ext = (url.split('?')[0].split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
            const fname = `post-${Date.now()}.${ext || 'jpg'}`;
            const r = await ghRequest('PUT', `/repos/${OWNER}/${REPO}/contents/waj-magazine/assets/uploads/${fname}`, {
              message: `Auto-host image: ${fname}`,
              content: buf.toString('base64'),
              branch: BRANCH,
            });
            resolve(r.status === 200 || r.status === 201 ? `/assets/uploads/${fname}` : null);
          } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

// ── Handler ──
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const user = context.clientContext && context.clientContext.user;
  if (!user) return err('Not authenticated — please log in again', 401);
  if (!GITHUB_TOKEN) return err('GITHUB_TOKEN is not configured on Netlify', 500);

  // Parse request body safely
  let body;
  try {
    if (!event.body || !event.body.trim()) return err('Request body is empty', 400);
    body = JSON.parse(event.body);
  } catch (e) {
    return err(`Invalid JSON in request: ${e.message}`, 400);
  }

  try {
    const { sha, posts } = await readPosts();

    // ── BULK SAVE (Save All button) ──
    if (body.saveAll === true) {
      if (!Array.isArray(body.posts)) return err('saveAll requires posts array', 400);
      await writePosts(body.posts, sha, `Bulk save (${body.posts.length} posts) by ${user.email}`);
      return ok({ success: true, count: body.posts.length });
    }

    // ── SINGLE POST SAVE ──
    const { post, originalSlug } = body;
    if (!post) return err('post object is required', 400);
    if (!post.slug || !post.slug.trim()) return err('post.slug is required', 400);
    if (!post.title || !post.title.trim()) return err('post.title is required', 400);

    // Rehost external image if needed
    if (post.image && (post.image.startsWith('http://') || post.image.startsWith('https://'))) {
      const hosted = await rehostImage(post.image);
      if (hosted) post.image = hosted;
    }

    let updated = [...posts];

    // Remove old slug if slug changed
    if (originalSlug && originalSlug !== post.slug) {
      updated = updated.filter(p => p.slug !== originalSlug);
    }

    const existIdx = updated.findIndex(p => p.slug === post.slug);
    if (existIdx >= 0) {
      updated[existIdx] = post;             // update existing
    } else {
      updated.unshift(post);                // new post → add at top
    }

    const action = originalSlug ? 'Update' : 'Create';
    await writePosts(updated, sha, `${action}: "${post.slug}" by ${user.email}`);
    return ok({ success: true, slug: post.slug, action: action.toLowerCase() });

  } catch (e) {
    console.error('publish-post error:', e.message);
    return err(e.message || 'Internal server error');
  }
};
