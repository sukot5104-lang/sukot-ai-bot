/* ============================================================
   Sukot AI Bot — Persian AI chatbot powered by Cloudflare Workers AI
   Works on: Browser (PWA) / Android WebView / Electron (Windows)
   ============================================================ */
'use strict';

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const DEFAULT_SYS = 'تو یک دستیار هوشمند و خوش‌برخورد فارسی‌زبان هستی. پاسخ‌ها را دقیق، مفید و مرتب بده. اگر سؤال نامفهوم بود، برای روشن شدن آن سؤال بپرس. از فرمت markdown برای خواناتر شدن پاسخ استفاده کن.';

const LS_SET = 'sukot_ai_settings_v1';
const LS_CHAT = 'sukot_ai_chats_v1';

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS_SET) || '{}'); } catch (e) {}
  return Object.assign({
    token: '', account: '', base: '',
    model: '@cf/meta/llama-3.1-8b-instruct-fast', modelCustom: '',
    sys: DEFAULT_SYS, temp: 0.7
  }, s);
}
function saveSettings(s) { localStorage.setItem(LS_SET, JSON.stringify(s)); }

function loadChats() {
  try { return JSON.parse(localStorage.getItem(LS_CHAT) || '[]'); } catch (e) { return []; }
}
function saveChats(c) { localStorage.setItem(LS_CHAT, JSON.stringify(c.slice(0, 40))); }

/* ---------- environment / transport ---------- */
const ENV = (typeof AndroidAI !== 'undefined') ? 'android'
          : (window.electronAPI ? 'electron' : 'web');

const pendingStreams = new Map(); // cbId -> {onDelta, onDone, abort}

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
if (ENV === 'electron' && window.electronAPI) {
  window.electronAPI.onChunk((cbId, text) => {
    const st = pendingStreams.get(cbId);
    if (st && text) { try { st.onDelta(text); } catch (e) {} }
  });
  window.electronAPI.onDone((cbId, err) => {
    const st = pendingStreams.get(cbId);
    if (st) { pendingStreams.delete(cbId); try { st.onDone(translateErr(err)); } catch (e) {} }
  });
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
          if (j.errors || j.error) onDelta('');
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
  if (status === 401 || code === 10000) return 'توکن نامعتبر یا منقضی است. یک توکن جدید بسازید.';
  if (status === 403) return 'دسترسی رد شد. توکن باید دسترسی «Workers AI — Edit» داشته باشد.';
  if (status === 404) return 'مدل یا آدرس پیدا نشد. نام مدل و Account ID را بررسی کنید.';
  if (status === 429) return 'محدودیت تعداد درخواست (rate limit). چند لحظه بعد دوباره امتحان کنید.';
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

/* Unified streaming request across all 3 environments */
function streamRequest(url, headers, body, onDelta, onDone) {
  const cbId = uid();
  if (ENV === 'android') {
    pendingStreams.set(cbId, { onDelta, onDone });
    AndroidAI.request(cbId, url, JSON.stringify(headers), JSON.stringify(body));
    return { stop: () => { try { AndroidAI.cancel(cbId); } catch (e) {} } };
  }
  if (ENV === 'electron') {
    pendingStreams.set(cbId, { onDelta, onDone });
    window.electronAPI.request({ id: cbId, url, headers, body });
    return { stop: () => { try { window.electronAPI.cancel(cbId); } catch (e) {} } };
  }
  /* web */
  const ctrl = new AbortController();
  pendingStreams.set(cbId, { onDelta, onDone, abort: ctrl });
  (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw { status: res.status, body: t };
      }
      const parser = createSSEParser(onDelta);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(dec.decode(value, { stream: true }));
      }
      parser.end();
      pendingStreams.delete(cbId);
      onDone(null);
    } catch (err) {
      pendingStreams.delete(cbId);
      if (err && err.name === 'AbortError') { onDone(null); return; }
      if (err && err.status) { onDone(friendlyError(err.status, err.body)); return; }
      onDone('خطای شبکه: اتصال به سرور ممکن نشد. ' + (ENV === 'web' ? '(در مرورگر، درخواست مستقیم به کلادفلر ممکن است به دلایل CORS مسدود شود — از نسخه اندروید/ویندوز استفاده کنید یا Worker واسط راه‌اندازی کنید)' : ''));
    }
  })();
  return { stop: () => { try { ctrl.abort(); } catch (e) {} } };
}

/* one-shot (non stream) request used by "test connection" */
function testConnection(cb) {
  const s = settings;
  const url = apiUrl();
  const body = {
    model: chosenModel(), stream: false, max_tokens: 40,
    messages: [{ role: 'user', content: 'سلام! فقط بگو: اتصال برقرار است' }]
  };
  let acc = '';
  streamRequest(url, apiHeaders(), body, t => { acc += t; }, err => {
    if (err) cb(false, err);
    else if (!acc.trim()) cb(false, 'اتصال برقرار شد ولی پاسخی دریافت نشد. (Account ID یا مدل را بررسی کنید)');
    else cb(true, '✅ اتصال موفق! پاسخ مدل: ' + acc.trim().slice(0, 120));
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
  let html = '', list = null; // 'ul' | 'ol' | null
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
let currentId = chats.length ? chats[0].id : null;
let activeStream = null;

/* ---------- UI: chats ---------- */
function currentChat() { return chats.find(c => c.id === currentId) || null; }

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
  chats = chats.filter(c => c.id !== id);
  if (currentId === id) currentId = chats.length ? chats[0].id : null;
  saveChats(chats); renderChatList(); renderMessages();
}

function renderChatList() {
  const el = $('#chat-list');
  el.innerHTML = '';
  for (const c of chats) {
    const d = document.createElement('div');
    d.className = 'chat-item' + (c.id === currentId ? ' active' : '');
    d.innerHTML = '<span>💬</span><span class="title">' + esc(c.title) + '</span><span class="del" title="حذف">✕</span>';
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
    '<div class="avatar">' + (role === 'user' ? '🧑' : '🤖') + '</div>' +
    '<div class="bubble-wrap" style="min-width:0">' +
    '<div class="bubble"' + (id ? ' id="' + id + '"' : '') + '>' + html + '</div>' +
    (role === 'bot' ? '<div class="meta"><button class="copy-btn">📋 کپی پاسخ</button></div>' : '') +
    '</div>';
  if (role === 'bot') {
    w.querySelector('.copy-btn').addEventListener('click', () => {
      const txt = w.querySelector('.bubble').innerText;
      const done = () => { const b = w.querySelector('.copy-btn'); b.textContent = '✅ کپی شد'; setTimeout(() => b.textContent = '📋 کپی پاسخ', 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, done);
      else done();
    });
  }
  $('#messages').appendChild(w);
  return w;
}

function renderMessages() {
  const c = currentChat();
  $('#messages').innerHTML = '';
  const empty = !c || c.msgs.length === 0;
  $('#welcome').classList.toggle('hidden', !empty);
  if (empty) return;
  for (const m of c.msgs) addMsgDom(m.r === 'user' ? 'user' : 'bot', m.r === 'user' ? '<p>' + esc(m.c) + '</p>' : renderMD(m.c));
  scrollBottom(true);
}
function scrollBottom(force) {
  const el = $('#messages');
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  if (near || force) el.scrollTop = el.scrollHeight;
}

/* ---------- send / stream ---------- */
function setBusy(b) {
  $('#btn-send').textContent = b ? '⏹' : '➤';
  $('#btn-send').title = b ? 'توقف' : 'ارسال';
  $('#btn-send').classList.toggle('busy', b);
}

function send(textRaw) {
  const text = (textRaw !== undefined ? textRaw : $('#input').value).trim();
  if (!text || activeStream) return;

  if (!settings.token.trim() || !settings.account.trim()) { openSettings(); return; }
  if (!chosenModel()) { openSettings(); return; }

  let c = currentChat();
  if (!c) { newChat(); c = currentChat(); }
  $('#welcome').classList.add('hidden');
  if (c.msgs.length === 0) { c.title = text.slice(0, 32); renderChatList(); }

  c.msgs.push({ r: 'user', c: text });
  addMsgDom('user', '<p>' + esc(text) + '</p>');
  $('#input').value = ''; autoGrow();
  saveChats(chats);
  scrollBottom(true);

  /* bot placeholder */
  const botId = 'bot-' + uid();
  const w = addMsgDom('bot', '<span class="typing"><i></i><i></i><i></i></span>', botId);
  scrollBottom(true);

  const history = c.msgs.slice(-20).map(m => ({ role: m.r === 'user' ? 'user' : 'assistant', content: m.c }));
  const body = {
    model: chosenModel(), stream: true, temperature: Number(settings.temp) || 0.7,
    max_tokens: 4096,
    messages: [{ role: 'system', content: settings.sys || DEFAULT_SYS }].concat(history)
  };

  let acc = '';
  setBusy(true);
  activeStream = streamRequest(apiUrl(), apiHeaders(), body,
    (delta) => {
      if (!acc) w.querySelector('.bubble').innerHTML = '';
      acc += delta;
      w.querySelector('.bubble').innerHTML = renderMD(acc);
      scrollBottom(false);
    },
    (err) => {
      activeStream = null; setBusy(false);
      const bubble = w.querySelector('.bubble');
      if (err) {
        if (!acc) bubble.innerHTML = '<p style="color:var(--err)">❌ ' + esc(err) + '</p>';
        else bubble.innerHTML = renderMD(acc) + '<p style="color:var(--err);font-size:12px;margin-top:6px">⚠️ ' + esc(err) + '</p>';
      } else if (!acc.trim()) {
        bubble.innerHTML = '<p style="color:var(--err)">پاسخی دریافت نشد — تنظیمات مدل و Account ID را بررسی کنید.</p>';
      } else {
        bubble.innerHTML = renderMD(acc);
      }
      c.msgs.push({ r: 'assistant', c: acc || ('[خطا] ' + (err || '')) });
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
  const opts = Array.from(sel.options).map(o => o.value);
  sel.value = opts.includes(settings.model) ? settings.model : 'custom';
  $('#set-model-custom').value = settings.modelCustom || '';
  $('#set-model-custom').classList.toggle('hidden', sel.value !== 'custom');
  $('#set-sysprompt').value = settings.sys;
  $('#set-temp').value = settings.temp;
  $('#temp-val').textContent = settings.temp;
  $('#test-result').textContent = ''; $('#test-result').className = 'test-result';
  $('#settings-backdrop').classList.remove('hidden');
}
function closeSettings() { $('#settings-backdrop').classList.add('hidden'); }

function saveFromModal() {
  settings = {
    token: $('#set-token').value.trim(),
    account: $('#set-account').value.trim(),
    base: $('#set-base').value.trim(),
    model: $('#set-model').value,
    modelCustom: $('#set-model-custom').value.trim(),
    sys: $('#set-sysprompt').value.trim() || DEFAULT_SYS,
    temp: $('#set-temp').value
  };
  saveSettings(settings);
  refreshStatus(); closeSettings();
}

function refreshStatus() {
  const ok = settings.token.trim() && settings.account.trim();
  $('#status-dot').className = 'dot ' + (ok ? 'dot-on' : 'dot-off');
  $('#status-text').textContent = ok ? 'متصل به Cloudflare Workers AI' : 'تنظیمات لازم است';
  $('#model-badge').textContent = 'مدل: ' + (chosenModel() || '—');
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
  });
  $('#btn-send').addEventListener('click', () => {
    if (activeStream) stopStream(); else send();
  });
  $('#btn-test').addEventListener('click', () => {
    const r = $('#test-result');
    r.className = 'test-result'; r.textContent = '⏳ در حال تست اتصال…';
    const tmpTok = $('#set-token').value.trim(), tmpAcc = $('#set-account').value.trim();
    if (!tmpTok || !tmpAcc) { r.className = 'test-result err'; r.textContent = '❌ اول توکن و Account ID را وارد کنید.'; return; }
    const old = settings;
    settings = {
      token: tmpTok, account: tmpAcc, base: $('#set-base').value.trim(),
      model: $('#set-model').value, modelCustom: $('#set-model-custom').value.trim(),
      sys: $('#set-sysprompt').value.trim() || DEFAULT_SYS, temp: $('#set-temp').value
    };
    testConnection((ok, msg) => {
      r.className = 'test-result ' + (ok ? 'ok' : 'err');
      r.textContent = ok ? msg : '❌ ' + msg;
      if (!ok) settings = old;
    });
  });
  $('#set-model').addEventListener('change', () => {
    $('#set-model-custom').classList.toggle('hidden', $('#set-model').value !== 'custom');
  });
  $('#set-temp').addEventListener('input', () => { $('#temp-val').textContent = $('#set-temp').value; });

  $('#input').addEventListener('input', autoGrow);
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#sidebar-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('hidden'));

  document.querySelectorAll('.suggestion').forEach(b => b.addEventListener('click', () => send(b.textContent)));

  renderChatList(); renderMessages(); refreshStatus(); autoGrow();

  /* PWA: register service worker only when served over https (GitHub Pages etc.) */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

}

document.addEventListener('DOMContentLoaded', boot);
