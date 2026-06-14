// netlify/functions/create-checkout.js
// Uses native fetch — no npm required

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  // Handle CORS preflight FIRST
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'STRIPE_SECRET_KEY not set in Netlify environment variables.' })
    };
  }

  let items;
  try {
    items = JSON.parse(event.body).items;
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!items || !items.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  try {
    const siteUrl = process.env.URL || 'https://wajmagazine.com';
    const printCount = items.filter(i => i.type === 'print').length;

    // Build Stripe form-encoded params
    const p = new URLSearchParams();
    p.append('payment_method_types[]', 'card');
    p.append('mode', 'payment');
    p.append('success_url', `${siteUrl}/order-success?session_id={CHECKOUT_SESSION_ID}`);
    p.append('cancel_url', `${siteUrl}/shop`);

    let idx = 0;
    for (const item of items) {
      const desc = item.type === 'digital' ? 'Digital PDF — instant download after purchase' : 'Print copy — ships within 5–7 business days';
      p.append(`line_items[${idx}][price_data][currency]`, 'usd');
      p.append(`line_items[${idx}][price_data][product_data][name]`, item.name);
      p.append(`line_items[${idx}][price_data][product_data][description]`, desc);
      p.append(`line_items[${idx}][price_data][unit_amount]`, String(Math.round(item.price * 100)));
      p.append(`line_items[${idx}][quantity]`, '1');
      idx++;
    }

    if (printCount > 0) {
      p.append(`line_items[${idx}][price_data][currency]`, 'usd');
      p.append(`line_items[${idx}][price_data][product_data][name]`, `Shipping — ${printCount} print ${printCount === 1 ? 'copy' : 'copies'}`);
      p.append(`line_items[${idx}][price_data][unit_amount]`, String(printCount * 1000));
      p.append(`line_items[${idx}][quantity]`, '1');
      p.append('shipping_address_collection[allowed_countries][]', 'US');
      p.append('shipping_address_collection[allowed_countries][]', 'CA');
      p.append('shipping_address_collection[allowed_countries][]', 'GB');
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: p.toString(),
    });

    const session = await res.json();

    if (!res.ok) {
      console.error('Stripe error:', JSON.stringify(session));
      return {
        statusCode: res.status, headers: CORS,
        body: JSON.stringify({ error: session.error?.message || 'Stripe error' })
      };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ url: session.url }) };

  } catch (err) {
    console.error('Function error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
