/* ============================================================
   Mock Cloudflare Workers AI server — برای تست محلی ربات
   Usage:  node scripts/mock-cf-server.js [port]
   - serves ../web as static site
   - POST anything containing /chat/completions → fake SSE stream
   - v1.4.0: پشتیبانی از پیوست تصویر (image_url) و فایل متنی
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] || 8787);
const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  /* --- v1.5.0: fake image generation (run/flux-…) --- */
  if (req.method === 'POST' && url.pathname.includes('/run/')) {
    let ib = '';
    req.on('data', (d) => { ib += d; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: { image: 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z8DAwMDAxAADCAYAHW0C7gAAAABJRU5ErkJggg==' } }));
    });
    return;
  }

  /* --- fake chat completions --- */
  if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let userMsg = 'سلام';
      let grounded = false;
      let toolRound = false;
      let contRound = false;
      let model = '';
      let imgCount = 0;
      let fileEcho = '';
      const contentOf = (m) => Array.isArray(m.content)
        ? m.content.filter((p) => p && p.type === 'text').map((p) => p.text).join(' ')
        : String((m && m.content) || '');
      try {
        const j = JSON.parse(body);
        const users = (j.messages || []).filter((m) => m.role === 'user');
        userMsg = (users.length ? contentOf(users[users.length - 1]) : 'سلام').slice(0, 2000);
        grounded = (j.messages || []).some((m) => m.role === 'system' && contentOf(m).includes('نتایج تازهٔ جستجوی وب'));
        toolRound = (j.messages || []).some((m) => m.role === 'user' && contentOf(m).includes('نتیجهٔ ابزار'));
        contRound = (j.messages || []).some((m) => m.role === 'user' && contentOf(m).includes('ناقص بریده شد'));
        imgCount = (j.messages || []).reduce((n, m) =>
          Array.isArray(m.content) ? n + m.content.filter((p) => p && p.type === 'image_url' && p.image_url && p.image_url.url).length : n, 0);
        const fm = userMsg.match(/فایل پیوست «([^»]+)»/);
        if (fm) fileEcho = fm[1];
        model = j.model || '';
      } catch (e) {}

      /* شبیه‌سازی دقیق خطای مدل‌های مردهٔ کلادفلر (همان چیزی که کاربر واقعی می‌بیند) */
      const DEAD = ['@cf/meta/llama-3.1-8b-instruct', '@cf/qwen/qwen1.5-14b-chat-awq', '@cf/meta/llama-3.3-70b-instruct', '@cf/qwen/qwen3-30b-a3b', '@cf/google/gemma-3-12b-it', '@cf/meta/llama-3.2-11b-vision-instruct'];
      if (DEAD.indexOf(model) !== -1 || /dead-model/.test(model)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          result: null, success: false,
          errors: [{ code: 5035, message: 'AiError: Model ' + model + ' is not available on the Workers Free plan: Model ' + model + ' is not available on the Workers Free plan. Upgrade to access this model.' }]
        }));
        return;
      }

      if (/فکر عمیق/.test(userMsg)) {
        /* شبیه‌سازی مدل استدلالی gpt-oss: اول فکر در فیلد reasoning، بعد محتوا */
        const chunks2 = [{ reasoning: 'The user wants a deep answer.' }, { reasoning: 'Let me think more.' }, { content: '' }, { content: 'پاسخ نهایی پس از **تفکر عمیق** آمده است.' }];
        let k = 0;
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const t2 = setInterval(() => {
          if (k >= chunks2.length) { clearInterval(t2); res.write('data: [DONE]\n\n'); res.end(); return; }
          const payload = { id: 'mock', model: 'mock', choices: [{ index: 0, delta: chunks2[k++], finish_reason: null }] };
          res.write('data: ' + JSON.stringify(payload) + '\n\n');
        }, 500);
        res.on('close', () => clearInterval(t2));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      let text;
      if (!toolRound && !contRound && /بازی مار/.test(userMsg)) {
        /* شبیه‌سازی پاسخ بریده: fence بدون بسته‌شدن → برنامه باید ادامه بگیرد */
        text = 'بازی مار:\n\n```html\n<html><body><h1>مار</h1>\n<script>\nlet snake = [1, 2];\nfunction start() { draw(); }\n';
      } else if (!toolRound && contRound) {
        text = 'function go() { draw(); }\nwindow.onload = start;\n</script></body></html>\n```\n\nبازی آماده است؛ کد کامل کپی می‌شود.';
      } else if (!toolRound && /ابزار|calculator/.test(userMsg)) {
        /* دور اول: مدل فقط JSON ابزار می‌فرستد — برنامه باید اجرا کند و برگردد */
        text = '{"tool":"calculator","expression":"(12+8)*3"}';
      } else if (toolRound) {
        text = 'با اجرای ابزار ماشین‌حساب، جواب نهایی **۶۰** شد. این پاسخ پس از حلقهٔ ابزار است.\n\n' +
          '```python\nprint("hi" * 100)\n```\n' +
          'کد بالا برای تست کپی است.';
      } else {
        text =
        (imgCount > 0 ? '**عکس را دیدم! ✓** تعداد تصاویر پیوست: ' + imgCount + ' — مدل بینا درست کار می‌کند\n\n' : '') +
        (fileEcho ? '**فایل متنی را خواندم! ✓** نام فایل: «' + fileEcho + '»\n\n' : '') +
        'سلام! من **سوکوت** هستم و این پیام از **سرور ماک** آمده است. یک كلمهٔ عربی تست: سال ﻱ ۱۴۰۴\n\n' +
        (grounded ? 'پاسخ بر اساس **نتایج جستجوی وب** داده شد و منبع دارد:\n\n**منابع:**\n- [1] [Mock News](https://example.com/news)\n\n' : '') +
        'یک نمونه کد:\n\n```html\n<div class="salam">درود بر Sukot</div>\n```\n\n' +
        '- ترارسانی (streaming) به درستی کار می‌کند\n' +
        '- رابط کاربری فارسی و راست‌به‌چپ سالم است\n' +
        '- سازندهٔ من Sukot است\n\n' +
        'برای اتصال واقعی، در تنظیمات **توکن** و **Account ID** کلادفلر را وارد کن:\n\n' +
        '```\nhttps://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1/chat/completions\n```';
      }
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

  /* --- fake search engine (for E2E of the webSearch chain) --- */
  if (url.pathname === '/mock/ddg-lite') {
    const q = decodeURIComponent(url.searchParams.get('q') || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<table>
      <tr><td>1.</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews%3Fq%3D1&rut=a" class='result-link'>خبر تازه دربارهٔ ${esc(q)}</a></td></tr>
      <tr><td class='result-snippet'>آخرین اطلاعات به‌روز برای جستجوی «${esc(q)}» — از سرور ماک.</td></tr>
      <tr><td>2.</td><td><a rel="nofollow" href="https://example.org/doc" class='result-link'>سند دوم</a></td></tr>
      <tr><td class='result-snippet'>توضیح کوتاه دوم.</td></tr>
    </table>`);
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
