// netlify/functions/youtube-feed.js
// Fetches WAJ YouTube channel RSS server-side (avoids browser CORS)
// No API key needed — uses YouTube's public RSS feed

exports.handler = async (event) => {
  const CHANNEL_ID = 'UCerZgSUO5y_qLl9KLl0zGwQ';
  const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=1800', // Cache 30 mins
  };

  try {
    const response = await fetch(RSS_URL);
    if (!response.ok) throw new Error(`RSS fetch failed: ${response.status}`);
    const xml = await response.text();

    // Parse XML entries
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
      const block = m[1];
      const get = (tag) => {
        const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return match ? match[1].trim() : '';
      };
      const videoId = (block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || '';
      const title   = get('title').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
      const link    = (block.match(/href="([^"]+)"/) || [])[1] || `https://www.youtube.com/watch?v=${videoId}`;
      const published = (block.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
      const thumb   = videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '';
      const desc    = get('media:description') || '';

      // Filter out Shorts
      const isShort = title.toLowerCase().includes('#short') ||
                      desc.toLowerCase().includes('#short') ||
                      link.includes('/shorts/');

      return { videoId, title, link, published, thumb, isShort };
    });

    // Return only non-Shorts, up to 5
    const videos = entries.filter(v => v.videoId && !v.isShort).slice(0, 5);

    return { statusCode: 200, headers, body: JSON.stringify({ videos }) };

  } catch (err) {
    console.error('YouTube feed error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, videos: [] }),
    };
  }
};
