const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Not authenticated' }) };

  const NETLIFY_API_TOKEN = process.env.NETLIFY_API_TOKEN;
  const SITE_ID = process.env.SITE_ID;
  if (!NETLIFY_API_TOKEN) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not configured' }) };
  if (!SITE_ID) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'SITE_ID not available' }) };

  try {
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/submissions?per_page=100`,
      { headers: { 'Authorization': `Bearer ${NETLIFY_API_TOKEN}` } });
    if (!res.ok) throw new Error(`Netlify API error (${res.status})`);
    const all = await res.json();
    const submissions = all
      .filter(s => s.form_name === 'submit-post' || s.form_name === 'blog-submission')
      .map(s => ({ id: s.id, form: s.form_name, created_at: s.created_at, data: s.data }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ submissions }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
