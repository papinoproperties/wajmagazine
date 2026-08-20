// netlify/functions/get-posts.js
// Serves published posts from GitHub — works even if /content/posts.json
// isn't resolving correctly as a static file.

const REPO = 'papinoproperties/wajmagazine';
const FILE_PATH = 'waj-magazine/content/posts.json';
const BRANCH = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300', // cache 5 mins
};

exports.handler = async () => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  try {
    // Try to read from GitHub API first
    if (GITHUB_TOKEN) {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
        {
          headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'WAJ-Magazine',
          }
        }
      );
      if (res.ok) {
        const file = await res.json();
        const content = Buffer.from(file.content, 'base64').toString('utf-8');
        return { statusCode: 200, headers: CORS, body: content };
      }
    }

    // Fallback: try reading the static file directly from the filesystem
    // (available in Netlify Functions runtime as a relative path)
    const fs = require('fs');
    const path = require('path');
    const staticPath = path.join(__dirname, '../../content/posts.json');
    if (fs.existsSync(staticPath)) {
      const content = fs.readFileSync(staticPath, 'utf-8');
      return { statusCode: 200, headers: CORS, body: content };
    }

    // If neither works, return empty posts array
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ posts: [] })
    };

  } catch (err) {
    console.error('get-posts error:', err.message);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ posts: [], error: err.message })
    };
  }
};
