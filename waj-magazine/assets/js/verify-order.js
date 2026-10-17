(async function () {
  const title = document.getElementById('order-title');
  const status = document.getElementById('order-status');
  const details = document.getElementById('order-details');
  const sessionId = new URLSearchParams(location.search).get('session_id');
  // Remove the payment reference before third-party measurement can load.
  if (location.search) history.replaceState(null, '', location.pathname);
  const unconfirmed = () => {
    document.title = 'Check Your Order | WAJ Magazine';
    title.textContent = 'CHECK YOUR ORDER';
    status.textContent = 'We could not confirm this payment here. Check your Stripe receipt or contact magazine@wearejerseyent.com for help. Please do not pay again just because this page could not verify the order.';
  };
  if (!sessionId) { unconfirmed(); return; }
  try {
    const response = await fetch('/api/verify-purchase', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }), cache: 'no-store'
    });
    const result = await response.json();
    if (!response.ok || result.verified !== true) { unconfirmed(); return; }
    document.title = 'Order Confirmed | WAJ Magazine';
    title.textContent = 'ORDER CONFIRMED!';
    status.textContent = 'Thank you for your purchase. Your payment of $' + result.value.toFixed(2) + ' USD has been confirmed.';
    details.hidden = false;
    // A separate consent-aware measurement layer may use this verified result.
    window.wajVerifiedPurchase = result;
    window.dispatchEvent(new CustomEvent('waj:purchase-verified', { detail: result }));
  } catch { unconfirmed(); }
})();
