// Diagnostic function — delete after troubleshooting
exports.handler = async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      has_key: !!key,
      key_length: key ? key.length : 0,
      key_prefix: key ? key.substring(0, 12) + '...' : 'NOT FOUND',
      all_env_keys: Object.keys(process.env).filter(k =>
        k.includes('STRIPE') || k.includes('URL') || k.includes('NODE')
      ),
      node_version: process.version
    })
  };
};
