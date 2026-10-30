/**
 * Sukot AI Bot — CORS proxy Worker (اختیاری، فقط برای نسخه وب)
 *
 * نصب: Cloudflare Dashboard → Workers & Pages → Create Worker → Paste this → Deploy
 * استفاده: در تنظیمات ربات، «آدرس API» = https://<your-worker>.workers.dev/cf/<ACCOUNT_ID>
 *
 * ⚠️ بدون CORS_HEADERS محدود شده و برای هر کسی قابل استفاده نیست —
 *    بهتر است مقدار ALLOWED_ORIGIN را به دامنه خودت محدود کنی.
 */

const ALLOWED_ORIGIN = '*'; // مثلا: https://your-site.pages.dev

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    // /cf/<ACCOUNT_ID>/...  →  https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/...
    const m = url.pathname.match(/^\/cf\/([a-f0-9]{32})(\/.*)?$/i);
    if (!m) return new Response('Not found. Use /cf/<ACCOUNT_ID>/...', { status: 404 });

    const accountId = m[1];
    const rest = (m[2] || '').replace(/^\//, '');
    const target = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai/' + rest;

    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
        'Content-Type': 'application/json',
        'Accept-Encoding': 'identity',
      },
      body: request.body,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: Object.assign(
        { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
        corsHeaders(request)
      ),
    });
  },
};

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || ALLOWED_ORIGIN;
  const h = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  return h;
}
