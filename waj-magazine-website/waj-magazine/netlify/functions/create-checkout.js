// netlify/functions/create-checkout.js
// Stripe Checkout Session creator for WAJ Magazine Shop
// 
// SETUP INSTRUCTIONS:
// 1. Go to https://stripe.com and create an account
// 2. In your Stripe Dashboard > Products, create:
//    - A product "WAJ Magazine Digital" priced at $5.99 (one-time)
//    - A product "WAJ Magazine Print" priced at $30.99 (one-time)
//    - A product "Print Shipping" priced at $10.00 (one-time)
// 3. Copy each product's Price ID (starts with "price_...")
// 4. In Netlify > Site Settings > Environment Variables, add:
//    - STRIPE_SECRET_KEY = sk_live_... (your Stripe secret key)
//    - URL = https://wajmagazine.com (your live site URL)
// 5. Run: npm install stripe  (in your project root)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { items } = JSON.parse(event.body);

    if (!items || !items.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cart is empty' }) };
    }

    // Build Stripe line items from cart
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          description: item.type === 'digital'
            ? 'Digital PDF — instant download after purchase'
            : 'Print copy — ships within 5–7 business days',
          images: [], // Add product image URLs here if desired
        },
        unit_amount: Math.round(item.price * 100), // Stripe uses cents
      },
      quantity: 1,
    }));

    // Add shipping line item for each print copy
    const printCount = items.filter(i => i.type === 'print').length;
    if (printCount > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Shipping (${printCount} print ${printCount === 1 ? 'copy' : 'copies'})`,
            description: 'Standard shipping — 5 to 10 business days',
          },
          unit_amount: printCount * 1000, // $10.00 per print in cents
        },
        quantity: 1,
      });
    }

    const siteUrl = process.env.URL || 'https://wajmagazine.com';

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${siteUrl}/pages/order-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${siteUrl}/pages/shop.html?cancelled=true`,
      // Collect shipping address for print orders
      shipping_address_collection: printCount > 0 ? {
        allowed_countries: ['US', 'CA', 'GB', 'AU', 'NZ'],
      } : undefined,
      metadata: {
        source: 'waj_magazine_shop',
        has_print: printCount > 0 ? 'true' : 'false',
        has_digital: items.some(i => i.type === 'digital') ? 'true' : 'false',
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
