(function () {
  'use strict';
  const preferenceKey = 'waj-pinterest-consent-v1';
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} }
  };
  const blocked = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  let choice = storage.get(preferenceKey);
  let loaded = false;
  let enabled = false;
  let pageVisitSent = false;
  const eventId = () => 'waj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const sentThisPage = new Set();
  function purchase(result) {
    if (!enabled || blocked() || result?.verified !== true || !/^[a-f0-9]{64}$/.test(result.event_id) || !(result.value > 0)) return;
    let sent;
    try { sent = JSON.parse(storage.get('waj-measured-orders') || '[]'); } catch { sent = []; }
    if (!Array.isArray(sent)) sent = [];
    if (sent.includes(result.event_id) || sentThisPage.has(result.event_id)) return;
    const data = { event_id: result.event_id, order_id: result.event_id, value: result.value, currency: result.currency, order_quantity: result.quantity };
    if (result.product_id) data.line_items = [{ product_id: result.product_id, product_quantity: result.quantity }];
    window.pintrk('track', 'checkout', data);
    sentThisPage.add(result.event_id);
    storage.set('waj-measured-orders', JSON.stringify([...sent.slice(-99), result.event_id]));
  }
  function enable() {
    if (blocked()) return;
    if (!loaded) {
      window.pintrk = window.pintrk || function () { window.pintrk.queue.push(Array.from(arguments)); };
      window.pintrk.queue = window.pintrk.queue || [];
      window.pintrk.version = '3.0';
      window.pintrk('setconsent', true);
      window.pintrk('load', '2613211443546');
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://s.pinimg.com/ct/core.js';
      document.head.appendChild(script);
      loaded = true;
    } else window.pintrk('setconsent', true);
    if (!enabled) window.pintrk('page');
    if (!pageVisitSent) {
      window.pintrk('track', 'pagevisit', { event_id: eventId() });
      pageVisitSent = true;
    }
    enabled = true;
    purchase(window.wajVerifiedPurchase);
  }
  function setChoice(value) {
    choice = value;
    storage.set(preferenceKey, value);
    banner.hidden = true;
    if (value === 'allowed') enable();
    else {
      enabled = false;
      if (window.pintrk) window.pintrk('setconsent', false);
    }
  }
  const style = document.createElement('style');
  style.textContent = '#waj-measurement{position:fixed;bottom:12px;left:12px;right:12px;z-index:10000;max-width:740px;margin:auto;background:#fff;color:#171717;border:2px solid #7a0000;padding:18px;box-shadow:0 4px 24px #0003;font:15px/1.5 Arial,sans-serif}#waj-measurement[hidden]{display:none}#waj-measurement p{color:#171717;margin:6px 0 14px;font:15px/1.5 Arial,sans-serif}#waj-measurement button{padding:10px 16px;margin:4px 12px 0 0;border:1px solid #7a0000;background:white;color:#171717;cursor:pointer;font:inherit}#waj-measurement button:focus-visible,#waj-privacy-choice:focus-visible{outline:3px solid #7a0000;outline-offset:3px}#waj-privacy-choice{display:block;margin:16px;padding:8px 12px;background:#fff;color:#171717;border:1px solid #777;font:14px Arial,sans-serif;cursor:pointer}';
  document.head.appendChild(style);
  const banner = document.createElement('section');
  banner.id = 'waj-measurement';
  banner.setAttribute('aria-label', 'Pinterest measurement choice');
  banner.innerHTML = '<strong>Help us understand what brings you to WAJ</strong><p>If you allow Pinterest measurement, Pinterest receives page visits and shopping events, including purchase value and product IDs, to measure results and personalize ads. You can decline and still shop. <a href="/privacy#pinterest-measurement">Learn more</a>.</p>';
  const allow = document.createElement('button'); allow.type = 'button'; allow.textContent = 'Allow Pinterest measurement';
  const decline = document.createElement('button'); decline.type = 'button'; decline.textContent = 'Decline';
  allow.addEventListener('click', () => setChoice('allowed'));
  decline.addEventListener('click', () => setChoice('declined'));
  banner.append(allow, decline);
  document.body.appendChild(banner);
  const settings = document.createElement('button'); settings.id = 'waj-privacy-choice'; settings.type = 'button'; settings.textContent = 'Privacy choices';
  settings.addEventListener('click', () => { banner.hidden = false; (blocked() ? decline : allow).focus(); });
  (document.querySelector('footer') || document.body).appendChild(settings);
  if (blocked()) {
    allow.disabled = true;
    banner.querySelector('p').textContent = 'Pinterest measurement is off because your browser has a privacy preference enabled. You can continue shopping.';
    banner.hidden = true;
    enabled = false;
    if (window.pintrk) window.pintrk('setconsent', false);
  } else {
    banner.hidden = choice === 'allowed' || choice === 'declined';
    if (choice === 'allowed') enable();
  }
  window.addEventListener('waj:purchase-verified', event => purchase(event.detail));
  window.addEventListener('waj:add-to-cart', event => {
    const item = event.detail;
    if (!enabled || blocked() || !item?.productId || !(item.price > 0)) return;
    window.pintrk('track', 'addtocart', { event_id:eventId(), value:item.price, currency:'USD', order_quantity:1,
      line_items:[{product_id:item.productId + '-' + item.type.toUpperCase(), product_price:item.price, product_quantity:1}] });
  });
})();
