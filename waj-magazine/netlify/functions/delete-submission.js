// netlify/functions/delete-submission.js
// Deletes a Netlify Forms submission once it's been approved (published)
// or rejected, so it no longer shows in the pending queue.

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

  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  const NETLIFY_API_TOKEN = process.env.NETLIFY_API_TOKEN;
  if (!NETLIFY_API_TOKEN) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'NETLIFY_API_TOKEN is not configured.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!body.id) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Submission id is required' }) };
  }

  try {
    const res = await fetch(`https://api.netlify.com/api/v1/submissions/${body.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${NETLIFY_API_TOKEN}` },
    });

    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      throw new Error(`Failed to delete submission (${res.status}): ${errText}`);
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('delete-submission error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
