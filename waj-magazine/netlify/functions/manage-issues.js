const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER  = 'papinoproperties';
const REPO   = 'wajmagazine';
const PATH   = 'waj-magazine/content/issues.json';
const BRANCH = 'main';
const CORS   = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ghReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path, method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'WAJ-Admin',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
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
  const r = await ghReq('GET', `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  if (r.status === 404) return { sha: null, data: { issues: [] } };
  if (r.status !== 200) throw new Error(`GitHub read error: ${r.status}`);
  return {
    sha: r.body.sha,
    data: JSON.parse(Buffer.from(r.body.content, 'base64').toString()),
  };
}

async function saveFile(data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await ghReq('PUT', `/repos/${OWNER}/${REPO}/contents/${PATH}`, body);
  if (r.status !== 200 && r.status !== 201) throw new Error(`GitHub write error: ${r.status}`);
  return r.body;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (!GITHUB_TOKEN) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'GITHUB_TOKEN not set' }) };

  // GET — return all issues
  if (event.httpMethod === 'GET') {
    try {
      const { data } = await getFile();
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // POST — save
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    try {
      const { sha, data } = await getFile();

      // Save all issues at once (used by admin)
      if (body.saveAll && Array.isArray(body.issues)) {
        await saveFile({ issues: body.issues }, sha, `Issue management update by ${user.email}`);
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
      }

      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
