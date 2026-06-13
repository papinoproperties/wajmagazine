// netlify/functions/blog-feed.js
// Fetches We Are Jersey ENT Wix blog RSS feed server-side (avoids CORS)
// Returns clean JSON with posts, categories, images, and dates

exports.handler = async (event) => {
  const RSS_URL = 'https://www.wearejerseyent.com/blog-feed.xml';

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=900', // Cache 15 mins
  };

  try {
    const response = await fetch(RSS_URL, {
      headers: { 'User-Agent': 'WAJMagazine/1.0 (wajmagazine.com)' }
    });

    if (!response.ok) throw new Error(`RSS fetch failed: ${response.status}`);
    const xml = await response.text();

    // Parse <item> blocks from RSS
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const block = m[1];

      const getTag = (tag) => {
        const match = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`));
        return match ? (match[1] || match[2] || '').trim() : '';
      };

      const title    = getTag('title');
      const link     = getTag('link') || (block.match(/<link>([^<]+)/) || [])[1] || '';
      const pubDate  = getTag('pubDate');
      const desc     = getTag('description').replace(/<[^>]+>/g, '').slice(0, 160) + '…';
      const category = getTag('category') || 'News';

      // Extract image from media:content, enclosure, or description img tag
      let image = '';
      const mediaMatch = block.match(/media:content[^>]+url="([^"]+)"/);
      const enclosureMatch = block.match(/enclosure[^>]+url="([^"]+)"/);
      const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);
      if (mediaMatch) image = mediaMatch[1];
      else if (enclosureMatch) image = enclosureMatch[1];
      else if (imgMatch) image = imgMatch[1];

      // Format date
      const date = pubDate ? new Date(pubDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      }) : '';

      return { title, link, date, description: desc, category, image };
    }).filter(p => p.title && p.link);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ posts: items.slice(0, 20) }),
    };

  } catch (err) {
    console.error('Blog feed error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, posts: [] }),
    };
  }
};
