/* ============================================================
   سوکات AI (Sukot AI) v1.1.0 — Persian AI chatbot
   powered by Cloudflare Workers AI
   Works on: Browser (PWA) / Android WebView / Electron (Windows)

   v1.1.0 highlights
   - مغز بزرگ: long-term memory (auto + manual) persisted locally
   - 16 models, smart defaults, rich Persian system prompt
   - answer styles (کوتاه/متعادل/مفصل), long context window
   - reasoning-model support (stri)
   - SSE parsed centrally for ALL transports (web/android/electron)
   ============================================================ */
'use strict';

/* ---------- constants ---------- */
const APP_VERSION = '1.1.0';
const CREATOR = 'Sukot';
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const LEGACY_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

const LS_SET = 'sukot_ai_settings_v1';
const LS_CHAT = 'sukot_ai_chats_v1';
const LS_MEM = 'sukot_ai_memory_v1';

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* storage that never crashes (some WebViews block localStorage) */
const store = (() => {
  try {
    localStorage.setItem('__sukot_test__', '1');
    localStorage.removeItem('__sukot_test__');
    return localStorage;
  } catch (e) {
    const m = {};
    return {
      getItem: (k) => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: (k) => { delete m[k]; }
    };
  }
})();

/* ---------- personality: the brain of سوکات ---------- */
const DEFAULT_SYS =
  'تو «سوکات» هستی؛ یک دستیار هوش مصنوعی فارسی‌زبان، گرم، باهوش و خنده‌رو که در نرم‌افزار «سوکات AI» زندگی می‌کنی.\n' +
  '- همیشه فارسیِ روان، خودمانی و محترمانه پاسخ بده.\n' +
  '- سازنده و طراح تو «' + CREATOR + '» است. اگر از تو پرسیدند چه کسی تو را ساخته یا طراح برنامه کیست، با افتخار بگو: «سازندهٔ من ' + CREATOR + ' است.»\n' +
  '- پاسخ‌هایت دقیق، کامل و آموزنده باشند؛ موضوع را قدم‌به‌قدم و با مثال یا نمونهٔ کاربردی توضیح بده.\n' +
  '- برای خوانایی از نشانه‌گذاری markdown استفاده کن: تیترها را **پررنگ**، فهرست‌ها با خط تیره یا شماره.\n' +
  '- اگر از چیزی مطمئن نیستی، صادقانه بگو و حدس نزن.\n' +
  '- هرگز دادهٔ خام فنی (JSON، کد خطا، SSE و…) را به کاربر نشان نده؛ فقط پاسخ نهایی و تمیز را بنویس.';

const STYLES = {
  short: { desc: 'سبک پاسخ: خیلی کوتاه و مستقیم — فقط چند جملهٔ ضروری.', max_tokens: 800 },
  normal: { desc: 'سبک پاسخ: متوسط — کامل و روشن، بدون اطالهٔ بی‌مورد.', max_tokens: 2048 },
  detailed: { desc: 'سبک پاسخ: مفصل و عمیق — با مقدمهٔ کوتاه، توضیح اصلی، مثال یا نمونه‌کد در صورت لزوم، و جمع‌بندی نهایی.', max_tokens: 4096 }
};

const MODEL_NAMES = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 'Llama 3.3 70B Fast',
  '@cf/meta/llama-3.3-70b-instruct': 'Llama 3.3 70B',
  '@cf/openai/gpt-oss-120b': 'GPT-OSS 120B',
  '@cf/openai/gpt-oss-20b': 'GPT-OSS 20B',
  '@cf/meta/llama-4-scout-17b-16e-instruct': 'Llama 4 Scout',
  '@cf/qwen/qwen3-30b-a3b': 'Qwen 3 30B',
  '@cf/qwen/qwq-32b': 'QwQ 32B',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': 'DeepSeek R1 32B',
  '@cf/mistralai/mistral-small-3.1-24b-instruct': 'Mistral Small 24B',
  '@cf/meta/llama-3.1-8b-instruct-fast': 'Llama 3.1 8B Fast',
  '@cf/meta/llama-3.1-8b-instruct': 'Llama 3.1 8B',
  '@cf/meta/llama-3.2-3b-instruct': 'Llama 3.2 3B',
  '@cf/meta/llama-3.2-11b-vision-instruct': 'Llama 3.2 Vision',
  '@cf/qwen/qwen1.5-14b-chat-awq': 'Qwen 1.5 14B',
  '@cf/mistral/mistral-7b-instruct-v0.1': 'Mistral 7B',
  '@cf/google/gemma-3-12b-it': 'Gemma 3 12B'
};

/* ---------- settings ---------- */
function loadSettings() {
  let s = {};
  try { s = JSON.parse(store.getItem(LS_SET) || '{}'); } catch (e) {}
  const out = Object.assign({
    token: '', account: '', base: '',
    model: DEFAULT_MODEL, modelCustom: '',
    sys: '', temp: 0.7, style: 'detailed'
  }, s);
  /* upgrade users of the old default to the new big brain */
  if (out.model === LEGACY_MODEL && !out.modelPicked) { out.model = DEFAULT_MODEL; }
  if (!STYLES[out.style]) out.style = 'detailed';
  return out;
}
function saveSettings(s) { try { store.setItem(LS_SET, JSON.stringify(s)); } catch (e) {} }

/* ---------- chats ---------- */
function loadChats() {
  try { return JSON.parse(store.getItem(LS_CHAT) || '[]'); } catch (e) { return []; }
}
function saveChats(cs) {
  let arr = cs.slice(0, 40);
  try {
    let j = JSON.stringify(arr);
    while (j.length > 2200000 && arr.length > 1) { arr = arr.slice(0, -1); j = JSON.stringify(arr); }
    store.setItem(LS_CHAT, j);
  } catch (e) {}
}

/* ---------- مغز: long-term memory ---------- */
let memories = [];
function loadMemories() {
  try { return JSON.parse(store.getItem(LS_MEM) || '[]'); } catch (e) { return []; }
}
function saveMemories() { try { store.setItem(LS_MEM, JSON.stringify(memories.slice(0, 80))); } catch (e) {} }
const normTxt = (t) => String(t).replace(/\s+/g, ' ').trim();

function addMemory(text, src) {
  text = normTxt(text).slice(0, 180);
  if (!text) return false;
  if (memories.some((m) => normTxt(m.text) === text)) return false;
  memories.unshift({ id: uid(), text, at: Date.now(), src: src || 'auto' });
  saveMemories();
  return true;
}

const MEM_BLOCK = /تو|شما|چیه|چیست|چی|کیست|ربات|بات|رابط|هوش مصنوعی/;
function cleanName(s) { return s.replace(/\s+(است|هست|هستم|بود|می‌باشد|میباشد|ه)$/u, '').trim(); }

function extractMemories(userText) {
  let added = 0;
  const push = (t) => { if (addMemory(t, 'auto')) added++; };
  let m;
  if ((m = userText.match(/(?:یادت\s*(?:باشه|باشد|بود)?|یادت\s+نگیر[هه]?|به\s+یادت\s+سپردم|تو\s+حافظه(?:ات)?\s+(?:بنویس|ذخیره\s*کن))[،:.:]?\s*([\s\S]{3,160})/))) {
    push(m[1].replace(/^[.،؛:!؟\-\s]+/, ''));
  }
  if ((m = userText.match(/(?:اسم|نام)(?:م|\s+من)?\s*[،:=«"']?\s*([^\s،؛.!?؟][^،؛.!?؟\n]{1,29})/)) && !MEM_BLOCK.test(m[1])) {
    const n = cleanName(m[1]);
    if (n.length > 1) push('اسم کاربر «' + n + '» است');
  }
  if ((m = userText.match(/من\s+در\s+([^،؛.!?؟\n]{2,40}?)\s+زندگی\s+می/u))) {
    push('کاربر در «' + m[1].trim() + '» زندگی می‌کند');
  }
  if ((m = userText.match(/من\s+([^،؛.!?؟\n]{2,60}?)\s+(?:را|رو)\s+دوست\s+دارم/))) {
    push('کاربر ' + m[0].trim());
  }
  if ((m = userText.match(/من\s+([^،؛.!?؟\n]{2,60}?)\s+(?:را|رو)\s+دوست\s+ندارم/))) {
    push('کاربر ' + m[0].trim());
  }
  if ((m = userText.match(/من\s+یک?ِ?\s*([^،؛.!?؟\n]{2,40}?)\s+هستم/)) && !/مطمئن|خوشحال|آماده|معطل|علاقه‌مند\s+به\s+یادگیری/.test(m[1])) {
    push('کاربر ' + m[0].trim());
  }
  return added;
}

/* ---------- system prompt assembly ---------- */
function buildSystemPrompt() {
  const base = settings.sys && settings.sys.trim() ? settings.sys.trim() : DEFAULT_SYS;
  const style = STYLES[settings.style] || STYLES.detailed;
  let p = base + '\n\n' + style.desc;
  const mems = memories.slice(0, 25);
  if (mems.length) {
    p += '\n\nآنچه دربارهٔ کاربر در حافظهٔ بلندمدت تو (مغز سوکات) ذخیره شده:\n';
    p += mems.map((x) => '- ' + x.text).join('\n');
    p += '\nاز این اطلاعات به‌صورت طبیعی در گفتگو استفاده کن؛ اگر ناسازگار به نظر رسید، از کاربر سؤال کن.';
  }
  return p;
}

/* ---------- environment / transport ---------- */
function detectEnv() {
  if (typeof AndroidAI !== 'undefined') return 'android';
  if (window.electronAPI) return 'electron';
  return 'web';
}
const _qe = new URLSearchParams(location.search).get('env');
const ENV = (_qe === 'android' || _qe === 'electron') ? _qe : detectEnv();

const pendingStreams = new Map(); // cbId -> {onDelta, onDone}

if (ENV === 'android') {
  window.__aiChunk = function (cbId, text) {
    const st = pendingStreams.get(cbId);
    if (st && text) { try { st.onDelta(text); } catch (e) {} }
  };
  window.__aiDone = function (cbId, err) {
    const st = pendingStreams.get(cbId);
    if (st) { pendingStreams.delete(cbId); try { st.onDone(translateErr(err)); } catch (e) {} }
  };
}
if (ENV === 'electron') {
  let tries = 0;
  const attach = () => {
    if (window.electronAPI) {
      window.electronAPI.onChunk((cbId, text) => {
        const st = pendingStreams.get(cbId);
        if (st && text) { try { st.onDelta(text); } catch (e) {} }
      });
      window.electronAPI.onDone((cbId, err) => {
        const st = pendingStreams.get(cbId);
        if (st) { pendingStreams.delete(cbId); try { st.onDone(translateErr(err)); } catch (e) {} }
      });
    } else if (++tries < 60) { setTimeout(attach, 150); }
  };
  attach();
}

/* SSE line parser shared by every transport */
function createSSEParser(onDelta) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message || {});
          const t = (d.content || '').toString();
          if (t) onDelta(t);
        } catch (e) { /* partial json — ignore */ }
      }
    },
    end() {
      if (buf.trim().startsWith('data:')) {
        try {
          const j = JSON.parse(buf.trim().slice(5).trim());
          const d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message || {});
          const t = (d.content || '').toString();
          if (t) onDelta(t);
        } catch (e) {}
      }
    }
  };
}

function friendlyError(status, bodyText) {
  let code = '', msg = '';
  try {
    const j = JSON.parse(bodyText);
    if (j.errors && j.errors[0]) { code = j.errors[0].code; msg = j.errors[0].message || ''; }
    if (j.error && j.error.message) { msg = j.error.message; code = j.error.code || ''; }
  } catch (e) { msg = (bodyText || '').slice(0, 200); }

  if (code === 9109 || /location/i.test(msg)) {
    return 'توکن شما محدودیت IP دارد (خطای 9109). در پنل کلادفلر توکن را ویرایش کنید و بخش «IP Address Filtering» را حذف کنید.';
  }
  if (code === 7003) return 'مدل روی این حساب در دسترس نیست یا نام مدل اشتباه است. در تنظیمات مدل دیگری (مثلاً Llama 3.1 8B) انتخاب کنید.';
  if (status === 400 && /max_tokens|token/i.test(msg)) return 'طول پاسخ برای این مدل زیاد است؛ در تنظیمات «سبک پاسخ» را روی متعادل یا کوتاه بگذارید.';
  if (status === 401 || code === 10000) return 'توکن نامعتبر یا منقضی است. یک توکن جدید بسازید.';
  if (status === 403) return 'دسترسی رد شد. توکن باید دسترسی «Workers AI — Edit» داشته باشد.';
  if (status === 404) return 'مدل یا آدرس پیدا نشد. نام مدل و Account ID را بررسی کنید.';
  if (status === 429) return 'محدودیت تعداد درخواست (rate limit) یا پایان اعتبار روزانهٔ پلن. چند لحظه بعد یا با مدل سبک‌تر امتحان کنید.';
  if (status >= 500) return 'خطای سرور کلادفلر. کمی بعد دوباره تلاش کنید.';
  return 'خطا ' + (status || '') + ': ' + (msg || 'نامشخص');
}

/* native bridges report errors as "<status>||<body>" — convert to friendly Persian text */
function translateErr(err) {
  if (!err) return null;
  const m = String(err).match(/^\s*(\d{3})\|\|([\s\S]*)$/);
  if (m && m[1] !== '000') return friendlyError(+m[1], m[2]);
  if (m && m[1] === '000') return m[2];
  return err;
}

/* Unified streaming request across all 3 environments.
   Every transport (Android bridge / Electron IPC / fetch) delivers RAW body
   chunks — SSE parsing runs centrally here for all of them. */
function streamRequest(url, headers, body, onDelta, onDone) {
  const cbId = uid();
  const parser = createSSEParser(onDelta);
  const handleChunk = (raw) => { try { parser.push(raw); } catch (e) {} };
  const handleDone = (err) => { try { parser.end(); } catch (e) {} onDone(err); };

  if (ENV === 'android') {
    if (typeof AndroidAI === 'undefined' || !AndroidAI.request) {
      setTimeout(() => handleDone('پل اندروید در دسترس نیست.'), 0);
      return { stop: () => {} };
    }
    pendingStreams.set(cbId, { onDelta: handleChunk, onDone: handleDone });
    AndroidAI.request(cbId, url, JSON.stringify(headers), JSON.stringify(body));
    return { stop: () => { try { AndroidAI.cancel(cbId); } catch (e) {} } };
  }
  if (ENV === 'electron') {
    if (!window.electronAPI) {
      setTimeout(() => handleDone('پل ویندوز در دسترس نیست.'), 0);
      return { stop: () => {} };
    }
    pendingStreams.set(cbId, { onDelta: handleChunk, onDone: handleDone });
    window.electronAPI.request({ id: cbId, url, headers, body });
    return { stop: () => { try { window.electronAPI.cancel(cbId); } catch (e) {} } };
  }
  /* web */
  const ctrl = new AbortController();
  pendingStreams.set(cbId, { onDelta: handleChunk, onDone: handleDone, abort: ctrl });
  (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw { status: res.status, body: t };
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        handleChunk(dec.decode(value, { stream: true }));
      }
      pendingStreams.delete(cbId);
      handleDone(null);
    } catch (err) {
      pendingStreams.delete(cbId);
      if (err && err.name === 'AbortError') { handleDone(null); return; }
      if (err && err.status) { handleDone(friendlyError(err.status, err.body)); return; }
      onDone('خطای شبکه: اتصال به سرور ممکن نشد.' +
        (ENV === 'web' ? ' (در مرورگر، درخواست مستقیم به کلادفلر ممکن است به دلایل CORS مسدود شود — از نسخهٔ اندروید/ویندوز استفاده کنید یا Worker واسط راه‌اندازی کنید)' : ''));
    }
  })();
  return { stop: () => { try { ctrl.abort(); } catch (e) {} } };
}

/* one-shot request used by "test connection" */
function testConnection(cb) {
  const url = apiUrl();
  const body = {
    model: chosenModel(), stream: true, max_tokens: 60,
    messages: [{ role: 'user', content: 'سلام! فقط بگو: اتصال برقرار است' }]
  };
  let acc = '';
  streamRequest(url, apiHeaders(), body, (t) => { acc += t; }, (err) => {
    if (err) cb(false, err);
    else if (!acc.trim()) cb(false, 'اتصال برقرار شد ولی پاسخی دریافت نشد. (Account ID یا مدل را بررسی کنید)');
    else cb(true, 'اتصال موفق — پاسخ مدل: ' + stripThink(acc).text.trim().slice(0, 120));
  });
}

/* ---------- API URL / config ---------- */
function apiUrl() {
  const s = settings;
  if (s.base && s.base.trim()) return s.base.trim().replace(/\/+$/, '') + '/v1/chat/completions';
  return 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(s.account.trim()) + '/ai/v1/chat/completions';
}
function apiHeaders() {
  return { 'Authorization': 'Bearer ' + settings.token.trim(), 'Content-Type': 'application/json' };
}
function chosenModel() {
  return settings.model === 'custom' ? (settings.modelCustom || '').trim() : settings.model;
}
function prettyModel(id) {
  if (!id) return '—';
  if (MODEL_NAMES[id]) return MODEL_NAMES[id];
  return id.length > 26 ? id.slice(0, 26) + '…' : id;
}

/* ---------- reasoning models: strip <think>…</think> ---------- */
function stripThink(text) {
  const s = String(text);
  const open = s.indexOf('<think>');
  if (open === -1) return { text: s, thinking: false };
  const close = s.indexOf('</think>');
  if (close === -1) return { text: s.slice(0, open), thinking: true };
  return { text: s.slice(0, open) + s.slice(close + 8), thinking: false };
}

/* ---------- markdown-lite renderer ---------- */
function renderMD(text) {
  let s = esc(text);
  const blocks = [];
  s = s.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
    return '\u0000B' + (blocks.length - 1) + '\u0000';
  });
  s = s.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]\n]{1,80})\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = s.split('\n');
  let html = '', list = null;
  const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\u0000B\d+\u0000$/.test(line)) { closeList(); html += line; continue; }
    if (!line) { closeList(); continue; }
    let m;
    if ((m = line.match(/^[-•*]\s+(.*)/))) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += '<li>' + m[1] + '</li>';
    } else if ((m = line.match(/^(\d+)[.)]\s+(.*)/))) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += '<li>' + m[2] + '</li>';
    } else if ((m = line.match(/^#{1,6}\s+(.*)/))) {
      closeList(); html += '<p><b>' + m[1] + '</b></p>';
    } else {
      closeList(); html += '<p>' + line + '</p>';
    }
  }
  closeList();
  html = html.replace(/\u0000B(\d+)\u0000/g, (m, i) => blocks[+i]);
  return html;
}

/* ---------- state ---------- */
let settings = loadSettings();
let chats = loadChats();
memories = loadMemories();
let currentId = chats.length ? chats[0].id : null;
let activeStream = null;

/* ---------- UI: chats ---------- */
function currentChat() { return chats.find((c) => c.id === currentId) || null; }

function newChat() {
  const c = { id: uid(), title: 'گفتگوی جدید', msgs: [] };
  chats.unshift(c); currentId = c.id;
  saveChats(chats); renderChatList(); renderMessages();
  $('#input').focus();
  if (window.innerWidth <= 760) $('#sidebar').classList.add('hidden');
}
function openChat(id) {
  currentId = id;
  renderChatList(); renderMessages();
  if (window.innerWidth <= 760) $('#sidebar').classList.add('hidden');
}
function deleteChat(id, ev) {
  ev.stopPropagation();
  chats = chats.filter((c) => c.id !== id);
  if (currentId === id) currentId = chats.length ? chats[0].id : null;
  saveChats(chats); renderChatList(); renderMessages();
}

function renderChatList() {
  const el = $('#chat-list');
  el.innerHTML = '';
  for (const c of chats) {
    const d = document.createElement('div');
    d.className = 'chat-item' + (c.id === currentId ? ' active' : '');
    d.innerHTML =
      '<svg class="ic"><use href="#i-chat"/></svg>' +
      '<span class="title">' + esc(c.title) + '</span>' +
      '<button class="del" title="حذف گفتگو"><svg class="ic"><use href="#i-trash"/></svg></button>';
    d.addEventListener('click', () => openChat(c.id));
    d.querySelector('.del').addEventListener('click', (e) => deleteChat(c.id, e));
    el.appendChild(d);
  }
}

/* ---------- UI: messages ---------- */
function addMsgDom(role, html, id) {
  const w = document.createElement('div');
  w.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  w.innerHTML =
    '<div class="avatar">' +
    (role === 'user'
      ? '<svg class="ic"><use href="#i-user"/></svg>'
      : '<img src="img/hero.jpg" alt="">') +
    '</div>' +
    '<div class="bubble-wrap" style="min-width:0">' +
    '<div class="bubble"' + (id ? ' id="' + id + '"' : '') + '>' + html + '</div>' +
    (role === 'bot'
      ? '<div class="meta"><button class="copy-btn"><svg class="ic ic-sm"><use href="#i-copy"/></svg><span> کپی پاسخ</span></button></div>'
      : '') +
    '</div>';
  if (role === 'bot') {
    w.querySelector('.copy-btn').addEventListener('click', () => {
      const txt = w.querySelector('.bubble').innerText;
      const done = () => {
        const b = w.querySelector('.copy-btn');
        b.innerHTML = '<svg class="ic ic-sm"><use href="#i-check"/></svg><span> کپی شد</span>';
        setTimeout(() => { b.innerHTML = '<svg class="ic ic-sm"><use href="#i-copy"/></svg><span> کپی پاسخ</span>'; }, 1600);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, done);
      else done();
    });
  }
  $('#messages').appendChild(w);
  return w;
}

function errorHTML(msg) {
  return '<p style="color:var(--err);display:flex;align-items:center;gap:8px">' +
    '<svg class="ic ic-sm" style="color:var(--err)"><use href="#i-alert"/></svg><span>' + esc(msg) + '</span></p>';
}

function renderMessages() {
  const c = currentChat();
  $('#messages').innerHTML = '';
  const empty = !c || c.msgs.length === 0;
  $('#welcome').classList.toggle('hidden', !empty);
  if (empty) return;
  for (const m of c.msgs) {
    if (m.r === 'user') addMsgDom('user', '<p>' + esc(m.c) + '</p>');
    else {
      const v = stripThink(m.c).text || '[پاسخی ثبت نشد]';
      addMsgDom('bot', renderMD(v));
    }
  }
  scrollBottom(true);
}
function scrollBottom(force) {
  const el = $('#messages');
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  if (near || force) el.scrollTop = el.scrollHeight;
}

/* ---------- send / stream ---------- */
function setBusy(b) {
  $('#btn-send').classList.toggle('busy', b);
  $('#btn-send').title = b ? 'توقف' : 'ارسال';
}

function buildHistory(c) {
  const clean = c.msgs
    .filter((m) => {
      const t = String(m.c || '');
      if (m.r === 'assistant' && (t.indexOf('[خطا]') === 0 || /chat\.completion\.chunk|^\s*data:\s*\{/.test(t))) return false;
      return true;
    })
    .map((m) => ({ role: m.r === 'user' ? 'user' : 'assistant', content: String(m.c).slice(0, 3000) }));
  /* long memory window: keep last 24 messages inside a ~30k char budget */
  const win = clean.slice(-24);
  let budget = 30000;
  const out = [];
  for (let i = win.length - 1; i >= 0; i--) {
    const len = win[i].content.length;
    if (budget - len < 0) break;
    budget -= len;
    out.unshift(win[i]);
  }
  return out;
}

function send(textRaw) {
  const text = (textRaw !== undefined ? textRaw : $('#input').value).trim();
  if (!text || activeStream) return;

  if (!settings.token.trim() || !settings.account.trim()) { openSettings(); return; }
  if (!chosenModel()) { openSettings(); return; }

  /* مغز: learn from the user's message */
  const learned = extractMemories(text);
  if (learned > 0) {
    toast(learned === 1 ? 'یادداشت جدید در مغز سوکات ذخیره شد' : learned + ' یادداشت جدید در مغز سوکات ذخیره شد');
  }

  let c = currentChat();
  if (!c) { newChat(); c = currentChat(); }
  $('#welcome').classList.add('hidden');
  if (c.msgs.length === 0) { c.title = text.slice(0, 32); renderChatList(); }

  c.msgs.push({ r: 'user', c: text });
  addMsgDom('user', '<p>' + esc(text) + '</p>');
  $('#input').value = ''; autoGrow();
  saveChats(chats);
  scrollBottom(true);

  const botId = 'bot-' + uid();
  const w = addMsgDom('bot', '<span class="typing"><i></i><i></i><i></i></span>', botId);
  scrollBottom(true);

  const style = STYLES[settings.style] || STYLES.detailed;
  const body = {
    model: chosenModel(), stream: true,
    temperature: Number(settings.temp) || 0.7,
    max_tokens: style.max_tokens,
    messages: [{ role: 'system', content: buildSystemPrompt() }].concat(buildHistory(c))
  };

  let acc = '';
  setBusy(true);
  activeStream = streamRequest(apiUrl(), apiHeaders(), body,
    (delta) => {
      acc += delta;
      const v = stripThink(acc);
      const bubble = w.querySelector('.bubble');
      if (v.thinking) {
        bubble.innerHTML = '<div class="thinking-note"><svg class="ic"><use href="#i-chip"/></svg><span>دارم عمیق فکر می‌کنم…</span></div>';
      } else if (v.text) {
        bubble.innerHTML = renderMD(v.text);
      } else {
        bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      }
      scrollBottom(false);
    },
    (err) => {
      activeStream = null; setBusy(false);
      const bubble = w.querySelector('.bubble');
      const v = stripThink(acc);
      if (err) {
        if (!acc.trim()) bubble.innerHTML = errorHTML(err);
        else bubble.innerHTML = renderMD(v.text) + '<p style="color:var(--err);font-size:12px;margin-top:6px">' + esc(err) + '</p>';
      } else if (!v.text.trim()) {
        bubble.innerHTML = errorHTML('پاسخی دریافت نشد — مدل و Account ID را در تنظیمات بررسی کنید.');
      } else {
        bubble.innerHTML = renderMD(v.text);
      }
      c.msgs.push({ r: 'assistant', c: (v.text || '[خطا] ' + (err || '')).slice(0, 20000) });
      saveChats(chats);
      scrollBottom(false);
    }
  );
}

function stopStream() {
  if (activeStream) { activeStream.stop(); }
}

/* ---------- settings modal ---------- */
function openSettings() {
  $('#set-token').value = settings.token;
  $('#set-account').value = settings.account;
  $('#set-base').value = settings.base;
  const sel = $('#set-model');
  const opts = Array.from(sel.options).map((o) => o.value);
  sel.value = opts.includes(settings.model) ? settings.model : 'custom';
  $('#set-model-custom').value = settings.modelCustom || '';
  $('#set-model-custom').classList.toggle('hidden', sel.value !== 'custom');
  $('#set-sysprompt').value = settings.sys || '';
  $('#set-style').value = settings.style || 'detailed';
  $('#set-temp').value = settings.temp;
  $('#temp-val').textContent = settings.temp;
  $('#test-result').textContent = ''; $('#test-result').className = 'test-result';
  $('#settings-backdrop').classList.remove('hidden');
}
function closeSettings() { $('#settings-backdrop').classList.add('hidden'); }

function readSettingsFromModal() {
  return {
    token: $('#set-token').value.trim(),
    account: $('#set-account').value.trim(),
    base: $('#set-base').value.trim(),
    model: $('#set-model').value,
    modelCustom: $('#set-model-custom').value.trim(),
    sys: $('#set-sysprompt').value.trim(),
    style: $('#set-style').value,
    temp: $('#set-temp').value,
    modelPicked: true
  };
}

function saveFromModal() {
  settings = readSettingsFromModal();
  saveSettings(settings);
  refreshStatus(); closeSettings();
  toast('تنظیمات ذخیره شد');
}

function refreshStatus() {
  const ok = settings.token.trim() && settings.account.trim();
  $('#status-dot').className = 'dot ' + (ok ? 'dot-on' : 'dot-off');
  $('#status-text').textContent = ok ? 'متصل — Cloudflare Workers AI' : 'تنظیمات لازم است';
  $('#model-badge span').textContent = prettyModel(chosenModel());
}

/* ---------- brain modal ---------- */
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'همین حالا';
  const m = Math.floor(s / 60); if (m < 60) return m + ' دقیقه پیش';
  const h = Math.floor(m / 60); if (h < 24) return h + ' ساعت پیش';
  const d = Math.floor(h / 24); return d + ' روز پیش';
}
function renderMemoryList() {
  const list = $('#mem-list');
  const count = $('#mem-count');
  list.innerHTML = '';
  count.innerHTML = '<svg class="ic"><use href="#i-chip"/></svg><span>' + memories.length + ' خاطره در مغز سوکات' + (memories.length >= 80 ? ' (حداکثر ۸۰)' : '') + '</span>';
  if (!memories.length) {
    list.innerHTML = '<div class="mem-empty">مغز سوکات هنوز خالی است.<br>چند چیز دربارهٔ خودت بگو تا یادش بماند — مثلاً «اسم من … است و در … زندگی می‌کنم».</div>';
    return;
  }
  for (const m of memories) {
    const d = document.createElement('div');
    d.className = 'mem-item';
    d.innerHTML =
      '<svg class="ic"><use href="#i-spark"/></svg>' +
      '<div class="txt">' + esc(m.text) + '<div class="when">' + timeAgo(m.at) + ' · ' + (m.src === 'auto' ? 'یادگیری خودکار' : 'یادداشت دستی') + '</div></div>' +
      '<button title="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>';
    d.querySelector('button').addEventListener('click', () => {
      memories = memories.filter((x) => x.id !== m.id);
      saveMemories(); renderMemoryList();
    });
    list.appendChild(d);
  }
}
function openBrain() {
  renderMemoryList();
  $('#brain-backdrop').classList.remove('hidden');
  setTimeout(() => { try { $('#mem-input').focus(); } catch (e) {} }, 60);
}
function closeBrain() { $('#brain-backdrop').classList.add('hidden'); }
function addMemoryFromInput() {
  const v = $('#mem-input').value.trim();
  if (!v) return;
  if (addMemory(v, 'manual')) {
    $('#mem-input').value = '';
    renderMemoryList();
    toast('در مغز سوکات حک شد');
  } else {
    toast('این خاطره تکراری است', true);
  }
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 2600);
}

/* ---------- misc UI ---------- */
function autoGrow() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}

/* ---------- boot ---------- */
function boot() {
  $('#btn-new-chat').addEventListener('click', newChat);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', closeSettings);
  $('#settings-backdrop').addEventListener('click', (e) => { if (e.target.id === 'settings-backdrop') closeSettings(); });
  $('#btn-save-settings').addEventListener('click', saveFromModal);
  $('#btn-clear-chat').addEventListener('click', () => {
    const c = currentChat(); if (!c) return;
    c.msgs = []; saveChats(chats); renderMessages();
    toast('گفتگو پاک شد');
  });
  $('#btn-send').addEventListener('click', () => {
    if (activeStream) stopStream(); else send();
  });
  $('#btn-test').addEventListener('click', () => {
    const r = $('#test-result');
    r.className = 'test-result'; r.textContent = 'در حال تست اتصال…';
    const old = settings;
    settings = readSettingsFromModal();
    testConnection((ok, msg) => {
      r.className = 'test-result ' + (ok ? 'ok' : 'err');
      r.textContent = ok ? msg : msg;
      if (!ok) settings = old;
    });
  });
  $('#set-model').addEventListener('change', () => {
    $('#set-model-custom').classList.toggle('hidden', $('#set-model').value !== 'custom');
  });
  $('#set-temp').addEventListener('input', () => { $('#temp-val').textContent = $('#set-temp').value; });

  /* brain */
  $('#btn-brain-side').addEventListener('click', openBrain);
  $('#btn-close-brain').addEventListener('click', closeBrain);
  $('#brain-backdrop').addEventListener('click', (e) => { if (e.target.id === 'brain-backdrop') closeBrain(); });
  $('#btn-mem-add').addEventListener('click', addMemoryFromInput);
  $('#mem-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMemoryFromInput(); }
  });
  $('#btn-mem-clear').addEventListener('click', () => {
    memories = []; saveMemories(); renderMemoryList();
    toast('مغز سوکات پاک شد', true);
  });

  /* about */
  $('#btn-about').addEventListener('click', () => { $('#about-backdrop').classList.remove('hidden'); });
  $('#btn-close-about').addEventListener('click', () => { $('#about-backdrop').classList.add('hidden'); });
  $('#about-backdrop').addEventListener('click', (e) => { if (e.target.id === 'about-backdrop') $('#about-backdrop').classList.add('hidden'); });

  $('#input').addEventListener('input', autoGrow);
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#sidebar-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('hidden'));

  document.querySelectorAll('.suggestion').forEach((b) => b.addEventListener('click', () => send(b.textContent)));

  renderChatList(); renderMessages(); refreshStatus(); autoGrow();

  /* PWA: register service worker only when served over https */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
