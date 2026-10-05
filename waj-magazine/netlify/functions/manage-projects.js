const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER  = 'papinoproperties';
const REPO   = 'wajmagazine';
const PATH   = 'waj-magazine/content/projects.json';
const BRANCH = 'main';
const CORS   = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ghReq(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: apiPath, method,
      headers: {
        Authorization:  `token ${GITHUB_TOKEN}`,
        'User-Agent':   'WAJ-Admin/2.0',
        Accept:         'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        let parsed = null;
        if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = { _raw: raw }; } }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('Timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function ghReqRaw(method, apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com', path: apiPath, method,
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        'User-Agent':  'WAJ-Admin/2.0',
        Accept:        'application/vnd.github.raw+json',
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('Timed out')); });
    req.end();
  });
}

async function getFile() {
  const meta = await ghReq('GET', `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  if (meta.status === 404) return { sha: null, data: { projects: [] } };
  if (meta.status !== 200) throw new Error(`GitHub metadata error (${meta.status}): ${meta.body?.message || ''}`);
  const sha = meta.body.sha;
  const rawRes = await ghReqRaw('GET', `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  if (rawRes.status !== 200) throw new Error(`GitHub raw read error (${rawRes.status})`);
  const raw = (rawRes.raw || '').trim();
  if (!raw) throw new Error('GitHub returned empty content for projects.json');
  let data;
  try { data = JSON.parse(raw); } catch(e) { throw new Error(`projects.json parse error: ${e.message}`); }
  return { sha, data };
}

async function saveFile(data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await ghReq('PUT', `/repos/${OWNER}/${REPO}/contents/${PATH}`, body);
  if (r.status !== 200 && r.status !== 201)
    throw new Error(`GitHub write failed (${r.status}): ${r.body?.message || ''}`);
  return r.body;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  const user = context.clientContext && context.clientContext.user;
  if (!user)         return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (!GITHUB_TOKEN) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'GITHUB_TOKEN not configured' }) };

  if (event.httpMethod === 'GET') {
    try {
      const { data } = await getFile();
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      if (!event.body?.trim()) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Empty body' }) };
      body = JSON.parse(event.body);
    } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    try {
      const { sha, data } = await getFile();
      if (body.saveAll && Array.isArray(body.projects)) {
        await saveFile({ projects: body.projects }, sha, `Projects update by ${user.email}`);
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
      }
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
