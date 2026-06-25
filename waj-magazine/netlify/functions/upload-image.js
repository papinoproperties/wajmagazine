// netlify/functions/upload-image.js
// Accepts a base64-encoded image file from the admin dashboard and commits
// it permanently into the repo under assets/uploads/. Returns the public URL.

const REPO = 'papinoproperties/wajmagazine';
const BRANCH = 'main';
const MAX_BASE64_LENGTH = 6_000_000; // ~4.5MB raw file, safely under Lambda's 6MB payload limit

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'GITHUB_TOKEN is not configured.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { filename, contentBase64 } = body;
  if (!filename || !contentBase64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'filename and contentBase64 are required' }) };
  }
  if (contentBase64.length > MAX_BASE64_LENGTH) {
    return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: 'Image is too large. Please use a file under 4MB.' }) };
  }

  // Sanitize filename and force a unique name to avoid collisions
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ['jpg','jpeg','png','webp','gif'].includes(ext) ? ext : 'jpg';
  const finalFilename = `upload-${Date.now()}.${safeExt}`;
  const uploadPath = `waj-magazine/assets/uploads/${finalFilename}`;

  const GH_HEADERS = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'WAJ-Magazine-Uploader',
  };

  try {
    const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${uploadPath}`, {
      method: 'PUT',
      headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Upload image via admin: ${finalFilename} (by ${user.email || 'unknown'})`,
        content: contentBase64,
        branch: BRANCH,
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub upload failed (${putRes.status}): ${errText}`);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, url: `/assets/uploads/${finalFilename}` }),
    };

  } catch (err) {
    console.error('upload-image error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
