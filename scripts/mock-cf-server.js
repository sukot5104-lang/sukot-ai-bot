/* ============================================================
   Mock Cloudflare Workers AI server — برای تست محلی ربات
   Usage:  node scripts/mock-cf-server.js [port]
   - serves ../web as static site
   - POST anything containing /chat/completions → fake SSE stream
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] || 8787);
const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  /* --- fake chat completions --- */
  if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let userMsg = 'سلام';
      try {
        const j = JSON.parse(body);
        const users = (j.messages || []).filter((m) => m.role === 'user');
        userMsg = (users.length ? users[users.length - 1].content : 'سلام').slice(0, 200);
      } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const text =
        'سلام! من **سوکات** هستم و این پیام از **سرور ماک** آمده است.\n\n' +
        'پیام تو این بود:\n\n> ' + userMsg + '\n\n' +
        '- ترارسانی (streaming) به درستی کار می‌کند\n' +
        '- رابط کاربری فارسی و راست‌به‌چپ سالم است\n' +
        '- سازندهٔ من Sukot است\n\n' +
        'برای اتصال واقعی، در تنظیمات **توکن** و **Account ID** کلادفلر را وارد کن:\n\n' +
        '```\nhttps://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1/chat/completions\n```';
      const chunks = text.match(/[\s\S]{1,16}/g) || [];
      let i = 0;
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          clearInterval(timer);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        const payload = { id: 'mock', model: 'mock', choices: [{ index: 0, delta: { content: chunks[i++] }, finish_reason: null }] };
        res.write('data: ' + JSON.stringify(payload) + '\n\n');
      }, 35);
      res.on('close', () => clearInterval(timer));
    });
    return;
  }

  /* --- dev simulation pages (android/electron bridge testing) --- */
  if (url.pathname.startsWith('/__dev/')) {
    const f = path.join(__dirname, url.pathname.replace('/__dev/', ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(f).pipe(res);
    } else { res.writeHead(404); res.end('not found'); }
    return;
  }

  /* --- static ../web --- */
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  p = p.split('?')[0];
  const file = path.normalize(path.join(WEB, p));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('✅ Mock CF server:  http://127.0.0.1:' + port));
