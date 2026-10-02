const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER  = 'papinoproperties';
const REPO   = 'wajmagazine';
const PATH   = 'waj-magazine/content/posts.json';
const BRANCH = 'main';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const ok  = body      => ({ statusCode: 200, headers: CORS, body: JSON.stringify(body) });
const err = (msg, c=500) => ({ statusCode: c,   headers: CORS, body: JSON.stringify({ error: msg }) });

// ── Core HTTP helper ──
function ghReq(method, apiPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path:     apiPath,
        method,
        headers: {
          Authorization:  `token ${GITHUB_TOKEN}`,
          'User-Agent':   'WAJ-Admin/2.0',
          Accept:         'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...extraHeaders,
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          // Resolve with raw string + status; caller decides how to parse
          resolve({ status: res.statusCode, raw, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('GitHub API timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Parse helper — safe JSON parse with clear error ──
function safeParse(str, label) {
  const trimmed = (str || '').trim();
  if (!trimmed) throw new Error(`${label}: GitHub returned an empty body`);
  try { return JSON.parse(trimmed); }
  catch (e) { throw new Error(`${label}: invalid JSON — ${e.message}`); }
}

// ── READ posts.json (two-step — fixes the >1 MB Contents API limit) ──
//
// Step 1: standard Contents API call → gives us the sha even when the file
//         is too large for GitHub to embed the base64 content inline.
// Step 2: same endpoint with Accept: application/vnd.github.raw+json
//         → returns the raw file bytes with no size cap.
async function readPosts() {
  // Step 1 — metadata (sha)
  const meta = await ghReq('GET', `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  if (meta.status === 404) return { sha: null, posts: [] };
  if (meta.status !== 200) {
    const body = safeParse(meta.raw, 'metadata');
    throw new Error(`GitHub metadata read failed (${meta.status}): ${body.message || meta.raw.slice(0, 120)}`);
  }
  const metaBody = safeParse(meta.raw, 'metadata');
  const sha = metaBody.sha;
  if (!sha) throw new Error('GitHub did not return a sha for posts.json');

  // Step 2 — raw content (works for files of any size)
  const raw = await ghReq(
    'GET',
    `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`,
    null,
    { Accept: 'application/vnd.github.raw+json' }   // ← key fix
  );
  if (raw.status !== 200) {
    throw new Error(`GitHub raw content read failed (${raw.status})`);
  }
  if (!raw.raw || !raw.raw.trim()) {
    throw new Error('GitHub returned empty content for posts.json even with raw header');
  }

  const data = safeParse(raw.raw, 'posts.json content');
  return { sha, posts: data.posts || [] };
}

// ── WRITE posts.json ──
async function writePosts(posts, sha, message) {
  const content = Buffer.from(JSON.stringify({ posts }, null, 2)).toString('base64');
  const body = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;

  const r = await ghReq('PUT', `/repos/${OWNER}/${REPO}/contents/${PATH}`, body);
  if (r.status !== 200 && r.status !== 201) {
    const errBody = safeParse(r.raw, 'write response');
    throw new Error(`GitHub write failed (${r.status}): ${errBody.message || r.raw.slice(0, 200)}`);
  }
  return safeParse(r.raw, 'write response');
}

// ── Auto-rehost external image ──
async function rehostImage(url) {
  return new Promise(resolve => {
    try {
      https.get(url, res => {
        const chunks = [];
        res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', async () => {
          try {
            const buf  = Buffer.concat(chunks);
            const ext  = (url.split('?')[0].split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
            const fname = `post-${Date.now()}.${ext}`;
            const r = await ghReq('PUT', `/repos/${OWNER}/${REPO}/contents/waj-magazine/assets/uploads/${fname}`, {
              message: `Auto-host image: ${fname}`,
              content: buf.toString('base64'),
              branch:  BRANCH,
            });
            resolve(r.status === 200 || r.status === 201 ? `/assets/uploads/${fname}` : null);
          } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

// ── Lambda handler ──
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const user = context.clientContext && context.clientContext.user;
  if (!user)          return err('Not authenticated — please log in again', 401);
  if (!GITHUB_TOKEN)  return err('GITHUB_TOKEN is not configured on Netlify — check environment variables', 500);

  // Parse body safely
  let body;
  try {
    if (!event.body || !event.body.trim()) return err('Request body is empty', 400);
    body = JSON.parse(event.body);
  } catch (e) {
    return err(`Invalid request JSON: ${e.message}`, 400);
  }

  try {
    const { sha, posts } = await readPosts();

    // ── SAVE ALL (admin bulk-save) ──
    if (body.saveAll === true) {
      if (!Array.isArray(body.posts)) return err('saveAll requires a posts array', 400);
      await writePosts(body.posts, sha, `Bulk save (${body.posts.length} posts) by ${user.email}`);
      return ok({ success: true, count: body.posts.length });
    }

    // ── SINGLE POST ──
    const { post, originalSlug } = body;
    if (!post)             return err('post object is required', 400);
    if (!post.slug?.trim()) return err('post.slug is required', 400);
    if (!post.title?.trim()) return err('post.title is required', 400);

    // Rehost external images
    if (post.image && /^https?:\/\//.test(post.image)) {
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
      updated[existIdx] = post;
    } else {
      updated.unshift(post);
    }

    const action = originalSlug ? 'Update' : 'Create';
    await writePosts(updated, sha, `${action}: "${post.slug}" by ${user.email}`);
    return ok({ success: true, slug: post.slug, action: action.toLowerCase() });

  } catch (e) {
    console.error('[publish-post]', e.message);
    return err(e.message || 'Internal error');
  }
};
