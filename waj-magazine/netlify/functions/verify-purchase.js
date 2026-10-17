const { createHash } = require('node:crypto');
const links = new Set(['plink_1TiZioHmM8pkZGX4kUXVbIxo', 'plink_1TiZg8HmM8pkZGX4tae0LXIl']);
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { verified: false });
  const origin = event.headers?.origin || event.headers?.Origin;
  const allowedOrigins = new Set(['https://wajmagazine.com', 'https://www.wajmagazine.com']);
  if (process.env.URL) { try { allowedOrigins.add(new URL(process.env.URL).origin); } catch {} }
  if (origin && !allowedOrigins.has(origin)) return reply(403, { verified: false });
  let sessionId;
  try { sessionId = JSON.parse(event.body).session_id; } catch { return reply(400, { verified: false }); }
  if (typeof sessionId !== 'string' || !/^cs_live_[A-Za-z0-9]{20,250}$/.test(sessionId)) return reply(400, { verified: false });
  const key = process.env.STRIPE_CHECKOUT_READ_KEY;
  if (!key) return reply(503, { verified: false, reason: 'verification_unavailable' });
  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId), {
      headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return reply(response.status === 404 ? 404 : 502, { verified: false });
    const session = await response.json();
    if (session.id !== sessionId || !session.livemode || !links.has(session.payment_link)) return reply(404, { verified: false });
    if (session.status !== 'complete' || session.payment_status !== 'paid') return reply(200, { verified: false, reason: 'payment_not_confirmed' });
    if (session.currency !== 'usd' || !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0) return reply(502, { verified: false });
    const ref = /^([A-Z0-9-]+)_(DIGITAL|PRINT)-USD[0-9.]+$/.exec(session.client_reference_id || '');
    const productId = ref && ref[1].startsWith('WAJ-') ? ref[1] + '-' + ref[2] : null;
    return reply(200, {
      verified: true, value: session.amount_total / 100, currency: 'USD', quantity: 1,
      product_id: productId,
      event_id: createHash('sha256').update(sessionId).digest('hex')
    });
  } catch { return reply(502, { verified: false }); }
};
