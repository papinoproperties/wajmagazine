// netlify/functions/get-posts.js
// Reads posts.json from GitHub with the raw+json Accept header,
// which bypasses the 1MB inline-content limit of the Contents API.

const REPO      = 'papinoproperties/wajmagazine';
const FILE_PATH = 'waj-magazine/content/posts.json';
const BRANCH    = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60',
};

exports.handler = async () => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  try {
    // ── Primary: GitHub API with raw+json Accept header ──
    // This returns the raw file bytes directly — no base64, no size cap.
    if (GITHUB_TOKEN) {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept:        'application/vnd.github.raw+json', // ← key: no 1MB limit
            'User-Agent':  'WAJ-Magazine/2.0',
          },
        }
      );

      if (res.ok) {
        // Body is the raw file content — just pass it straight through
        const content = await res.text();
        if (content && content.trim()) {
          return { statusCode: 200, headers: CORS, body: content };
        }
      }

      console.error('get-posts GitHub API response:', res.status);
    }

    // ── Fallback: static file on the Netlify filesystem ──
    const fs   = require('fs');
    const path = require('path');
    const staticPath = path.join(__dirname, '../../content/posts.json');
    if (fs.existsSync(staticPath)) {
      const content = fs.readFileSync(staticPath, 'utf-8');
      return { statusCode: 200, headers: CORS, body: content };
    }

    // ── Last resort: return empty set rather than error ──
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ posts: [] }),
    };

  } catch (err) {
    console.error('get-posts error:', err.message);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ posts: [], error: err.message }),
    };
  }
};
