const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'papinoproperties';
const REPO  = 'wajmagazine';
const PATH  = 'waj-magazine/content/posts.json';
const BRANCH= 'main';
const CORS  = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ghRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'WAJ-Admin',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getFile() {
  const r = await ghRequest('GET', `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  if (r.status !== 200) throw new Error(`GitHub read failed: ${r.status}`);
  return { sha: r.body.sha, data: JSON.parse(Buffer.from(r.body.content, 'base64').toString()) };
}

async function saveFile(data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const r = await ghRequest('PUT', `/repos/${OWNER}/${REPO}/contents/${PATH}`, {
    message, content, sha, branch: BRANCH,
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`GitHub write failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Not authenticated' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (!GITHUB_TOKEN) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'GITHUB_TOKEN not configured' }) };

  try {
    const { sha, data } = await getFile();

    // ── SAVE ALL (admin bulk save) ──
    if (body.saveAll && Array.isArray(body.posts)) {
      const newData = { posts: body.posts };
      await saveFile(newData, sha, `Bulk save via WAJ Admin (${body.posts.length} posts) by ${user.email}`);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
    }

    // ── SINGLE POST SAVE ──
    const { post, originalSlug } = body;
    if (!post || !post.slug) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'post.slug required' }) };

    // Host external image locally
    if (post.image && post.image.startsWith('http')) {
      try {
        const imgData = await hostImage(post.image);
        if (imgData) post.image = imgData;
      } catch(e) { /* keep original if hosting fails */ }
    }

    let posts = data.posts || [];

    if (originalSlug && originalSlug !== post.slug) {
      // Slug changed — remove old entry
      posts = posts.filter(p => p.slug !== originalSlug);
    }

    const existingIdx = posts.findIndex(p => p.slug === post.slug);
    if (existingIdx >= 0) {
      posts[existingIdx] = post;
    } else {
      posts.unshift(post);
    }

    await saveFile({ posts }, sha, `${originalSlug ? 'Update' : 'Create'} post: ${post.slug} by ${user.email}`);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, slug: post.slug }) };

  } catch(e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};

async function hostImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        const buf = Buffer.concat(chunks);
        const ext = url.split('.').pop().split('?')[0].toLowerCase() || 'jpg';
        const fname = `post-${Date.now()}.${ext}`;
        const content = buf.toString('base64');
        try {
          const r = await ghRequest('PUT', `/repos/${OWNER}/${REPO}/contents/waj-magazine/assets/uploads/${fname}`, {
            message: `Permanently host post image: ${fname}`,
            content,
            branch: BRANCH,
          });
          if (r.status === 201 || r.status === 200) resolve(`/assets/uploads/${fname}`);
          else resolve(null);
        } catch { resolve(null); }
      });
    }).on('error', reject);
  });
}
