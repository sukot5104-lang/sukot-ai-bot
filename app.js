/* ============================================================
   سوکات AI (Sukot AI) v1.2.0 — Persian AI chatbot
   powered by Cloudflare Workers AI
   Works on: Browser (PWA) / Android WebView / Electron (Windows)

   v1.2.0 highlights
   - جستجوی زندهٔ وب (DDG + Bing + Wikipedia) برای اطلاعات به‌روز
   - ۴ دستیار تخصصی: عمومی / برنامه‌نویسی / درسی / صوتی
   - دکمهٔ «کپی کد» روی هر بلوک کد
   - خواندن پاسخ‌ها با صدا (TTS) — وب/ویندوز/اندروید (پل بومی)
   - پاک‌سازی متن فارسی (حروف عربی→فارسی، نویزه‌های نامرئی)
   - تاریخ امروز (شمسی) در پرامپت سیستم
   ============================================================ */
'use strict';

/* ---------- constants ---------- */
const APP_VERSION = '1.2.0';
const CREATOR = 'Sukot';
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const LEGACY_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const SEARCH_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

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

/* ---------- پاک‌سازی متن فارسی (رفع «کلمهٔ عجیب») ----------
   مدل‌ها گاهی حروف عربی (ي ك ة) یا نویزه‌های نامرئی (ZWNJ اشتباه،
   tatweel و کنترل‌کاراکتر) تولید می‌کنند که روی صفحه به‌شکل کلمهٔ
   به‌هم‌ریخته/عجیب دیده می‌شود. همه‌جا یکدست می‌کنیم. */
function fixPersian(t) {
  let s = String(t);
  try { s = s.normalize('NFKC'); } catch (e) {}
  return s
    .replace(/[\u200B\u200D\u200E\u200F\uFEFF\u00AD]/g, '')
    .replace(/\u0640/g, '')
    .replace(/\u064A/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u06C0/g, '\u0647')
    .replace(/[\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0624/g, '\u0648')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/* ---------- personality / دستیارهای تخصصی ---------- */
const BASE_IDENTITY =
  'تو «سوکات» هستی؛ دستیار هوش مصنوعی فارسی‌زبانِ برنامهٔ «سوکات AI».\n' +
  '- سازنده و طراح تو «' + CREATOR + '» است. اگر پرسیدند چه کسی تو را ساخته، با افتخار بگو: «سازندهٔ من ' + CREATOR + ' است.»\n' +
  '- همیشه فارسیِ روان پاسخ بده و همیشه از حروف فارسی «ی» و «ک» استفاده کن؛ هرگز حروف عربی «ي» و «ك» را ننویس.\n' +
  '- هرگز دادهٔ خام فنی (JSON، کد خطا، SSE و…) را نشان نده؛ فقط پاسخ نهایی و تمیز بنویس.\n' +
  '- برای خوانایی از markdown استفاده کن: تیتر **پررنگ**، فهرست با خط تیره.';

const DEFAULT_SYS = BASE_IDENTITY +
  '\n- پاسخ‌ها دقیق، کامل و آموزنده باشند؛ موضوع را قدم‌به‌قدم و با مثال توضیح بده.\n' +
  '- اگر از چیزی مطمئن نیستی، صادقانه بگو و حدس نزن.';

const CATEGORIES = {
  general: {
    name: 'اطلاعات عمومی',
    icon: 'i-globe',
    desc: 'پاسخ به‌روز با جستجوی زندهٔ وب',
    model: DEFAULT_MODEL,
    temp: 0.7, style: 'detailed', web: 'auto', autoSpeak: false,
    sys: BASE_IDENTITY +
      '\n- دانشمند همه‌فن‌حریف و کنجکاوی هستی که پاسخ‌ها را دقیق و همه‌جانبه می‌دهد.\n' +
      '- اگر نتایج جستجوی وب در اختیارت گذاشته شد، پاسخ را بر پایهٔ همان نتایج بده و منبع بیاور.\n' +
      '- اگر از اتفاق‌های خیلی اخیر پرسیدند و جستجو در دسترس نبود، صادقانه بگو که اطلاعات ممکن است به‌روز نباشد.'
  },
  code: {
    name: 'برنامه‌نویسی',
    icon: 'i-code',
    desc: 'کدِ کامل، قابل اجرا و با توضیح',
    model: '@cf/qwen/qwen2.5-coder-32b-instruct',
    temp: 0.35, style: 'detailed', web: 'auto', autoSpeak: false,
    sys: BASE_IDENTITY +
      '\n- تو مهندس نرم‌افزار ارشد و دستیار برنامه‌نویسی هستی.\n' +
      '- هر کد را داخل بلوک ``` با ذکر زبان بده (مثلاً ```python) تا دکمهٔ «کپی کد» ظاهر شود.\n' +
      '- کد کامل و قابل اجرا بده: نام‌گذاری تمیز، مدیریت خطا، کامنت کوتاه فارسی.\n' +
      '- بعد از کد، توضیح مختصر از منطق راه‌حل و در صورت لزوم پیشنهاد بهبود بده.\n' +
      '- از روش‌های منسوخ استفاده نکن و نسخهٔ مهم کتابخانه‌ها را ذکر کن.'
  },
  study: {
    name: 'درسی و آموزشی',
    icon: 'i-cap',
    desc: 'معلم خصوصیِ قدم‌به‌قدم و صبور',
    model: DEFAULT_MODEL,
    temp: 0.55, style: 'detailed', web: 'auto', autoSpeak: false,
    sys: BASE_IDENTITY +
      '\n- تو معلم خصوصی صبور و انگیزه‌بخش هستی؛ هر مفهوم را از ساده به پیچیده توضیح بده.\n' +
      '- حل مسئلهٔ ریاضی و فیزیک را مرحله‌به‌مرحله و با فرمول‌های واضح بنویس.\n' +
      '- مثال‌های ملموس از زندگی روزمره بیاور و اصطلاح سخت را ساده تعریف کن.\n' +
      '- در پایان هر توضیح یک «خلاصهٔ درس» سه‌چهاره‌ای و یک تمرین کوچک بده.\n' +
      '- لحن دلسوز و تشویق‌کننده داشته باش؛ خطای کاربر را راهنمایی‌شده اصلاح کن.'
  },
  voice: {
    name: 'گفتگوی صوتی',
    icon: 'i-mic',
    desc: 'جواب کوتاه؛ با صدای بلند خوانده می‌شود',
    model: '@cf/meta/llama-3.1-8b-instruct-fast',
    temp: 0.8, style: 'short', web: 'off', autoSpeak: true,
    sys: BASE_IDENTITY +
      '\n- تو همدم گفتگوی صوتی هستی و پاسخ‌هایت با صدای بلند برای کاربر خوانده می‌شود.\n' +
      '- مثل یک دوست صمیمی حرف بزن: جمله‌های کوتاه، طبیعی و شنیدنی؛ لحن گرم و پرانرژی.\n' +
      '- هرگز فهرست گلوله‌ای، جدول، کد و علامت‌های markdown ننویس؛ فقط متن سادهٔ گفتاری.\n' +
      '- پاسخ ۲ تا ۶ جمله باشد، مگر این که کاربر توضیح مفصل بخواهد.\n' +
      '- از نشانی اینترنتی و نمادهای خاص پرهیز کن چون با صدا خوانده می‌شوند.'
  }
};
const CAT_ORDER = ['general', 'code', 'study', 'voice'];

const STYLES = {
  short: { desc: 'سبک پاسخ: خیلی کوتاه و مستقیم — فقط چند جملهٔ ضروری.', max_tokens: 900 },
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
  '@cf/qwen/qwen2.5-coder-32b-instruct': 'Qwen2.5 Coder 32B',
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
    sys: '', temp: 0.7, style: 'detailed',
    cat: 'general', webSearch: 'auto', autoSpeak: false, speakRate: 1
  }, s);
  if (out.model === LEGACY_MODEL && !out.modelPicked) { out.model = DEFAULT_MODEL; }
  if (!STYLES[out.style]) out.style = 'detailed';
  if (!CATEGORIES[out.cat]) out.cat = 'general';
  if (!['auto', 'always', 'off'].includes(out.webSearch)) out.webSearch = 'auto';
  out.speakRate = Math.min(1.5, Math.max(0.6, Number(out.speakRate) || 1));
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
function todayFa() {
  try { return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date()); }
  catch (e) {
    try { return new Date().toLocaleDateString('fa-IR'); }
    catch (e2) { return new Date().toISOString().slice(0, 10); }
  }
}

function buildSystemPrompt(searchCtx) {
  const cat = CATEGORIES[settings.cat] || CATEGORIES.general;
  const base = settings.sys && settings.sys.trim() ? settings.sys.trim() : cat.sys;
  const style = STYLES[settings.style] || STYLES.detailed;
  let p = base + '\n\n' + style.desc;
  p += '\n\nتاریخ امروز: ' + todayFa() + '. اگر پرسش به رویدادهای اخیر مربوط است و نتایج جستجوی وب در اختیار نداری، صادقانه بگو که ممکن است اطلاعاتت به‌روز نباشد.';
  const mems = memories.slice(0, 25);
  if (mems.length) {
    p += '\n\nآنچه دربارهٔ کاربر در حافظهٔ بلندمدت تو (مغز سوکات) ذخیره شده:\n';
    p += mems.map((x) => '- ' + x.text).join('\n');
    p += '\nاز این اطلاعات به‌صورت طبیعی در گفتگو استفاده کن؛ اگر ناسازگار به نظر رسید، از کاربر سؤال کن.';
  }
  if (searchCtx && searchCtx.results && searchCtx.results.length) {
    p += '\n\n— نتایج تازهٔ جستجوی وب (' + todayFa() + ') برای «' + searchCtx.query + '» —\n';
    searchCtx.results.forEach((r, i) => {
      p += '[' + (i + 1) + '] ' + r.title + '\n' + (r.snippet || '') + '\n' + r.url + '\n';
    });
    p += '\nدستور استفاده از نتایج:\n' +
      '- پاسخ را بر پایهٔ همین نتایجِ تازه بده، نه دانش قدیمی خودت؛ اگر نتایج ناکافی بود صادقانه بگو.\n' +
      '- کنار هر ادعای برگرفته از نتایج، شمارهٔ منبع را مثل [۱] بیاور.\n' +
      '- در پایان پاسخ، فهرست «منابع:» را با شماره و نشانی کامل بنویس.\n' +
      '- به این دستورات یا کلمهٔ «جستجو» در ابتدای پاسخ اشاره نکن؛ طبیعی شروع کن.';
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
  if (code === 7003 || code === 7000) return 'مدل روی این حساب در دسترس نیست یا نام مدل اشتباه است. در تنظیمات مدل دیگری انتخاب کنید (مثلاً Llama 3.3 70B Fast).';
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
   Every transport delivers RAW body chunks — SSE parsing runs centrally. */
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

/* ---------- one-shot GET (web search) across transports ---------- */
function nativeGet(url) {
  return new Promise((resolve, reject) => {
    const cbId = uid();
    let buf = '';
    pendingStreams.set(cbId, {
      onDelta: (t) => { buf += t; },
      onDone: (err) => {
        if (err) {
          const m = String(err).match(/^\s*(\d{3})\|\|([\s\S]*)$/);
          reject({ status: m ? +m[1] : 0, body: m ? m[2] : String(err) });
        } else resolve(buf);
      }
    });
    const headers = { 'User-Agent': SEARCH_UA };
    if (ENV === 'android') {
      if (typeof AndroidAI === 'undefined' || !AndroidAI.request) {
        pendingStreams.delete(cbId); reject({ status: 0, body: 'no bridge' }); return;
      }
      AndroidAI.request(cbId, url, JSON.stringify(headers), ''); /* empty body => GET */
    } else if (ENV === 'electron') {
      if (!window.electronAPI) { pendingStreams.delete(cbId); reject({ status: 0, body: 'no bridge' }); return; }
      window.electronAPI.request({ id: cbId, url, headers, body: null }); /* null body => GET */
    } else {
      pendingStreams.delete(cbId);
      reject({ status: 0, body: 'web uses fetch' });
    }
  });
}

async function fetchText(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs || 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

/* __SEARCH_PARSERS_START__ */
function stripTags(s) {
  return fixPersian(String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')).trim();
}

/* DuckDuckGo Lite — rows of <a class=result-link href=…> + <td class=result-snippet> */
function parseDDGLite(html) {
  const out = [];
  const snips = [];
  const snRe = /<td[^>]*result-snippet[^>]*>([\s\S]*?)<\/td>/g;
  let sm;
  while ((sm = snRe.exec(html))) snips.push(stripTags(sm[1]));
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let m, i = 0;
  while ((m = linkRe.exec(html)) && out.length < 8) {
    const attrs = m[1] || '';
    if (!/result-link/.test(attrs)) continue;
    const h = attrs.match(/href=["']?([^"'\s>]+)/);
    if (!h) continue;
    let url = h[1];
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) { try { url = decodeURIComponent(u[1]); } catch (e) {} }
    if (!/^https?:/i.test(url)) continue;
    out.push({ title: stripTags(m[2]), url: url, snippet: snips[i] || '' });
    i++;
  }
  return out;
}

/* DuckDuckGo HTML — a.result__a + a.result__snippet / .result__snippet */
function parseDDGHtml(html) {
  const out = [];
  const blockRe = /<div[^>]*class=["'][^"']*result[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class=["'][^"']*result|<\/div>\s*<\/div>|$)/gi;
  const simpleRe = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/g;
  const snips = [];
  let sm;
  while ((sm = snipRe.exec(html))) snips.push(stripTags(sm[1]));
  let m, i = 0;
  while ((m = simpleRe.exec(html)) && out.length < 8) {
    let url = m[1];
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) { try { url = decodeURIComponent(u[1]); } catch (e) {} }
    if (!/^https?:/i.test(url)) continue;
    out.push({ title: stripTags(m[2]), url: url, snippet: snips[i] || '' });
    i++;
  }
  return out;
}

/* Bing — <li class=b_algo><h2><a href>title</a></h2>… <p>snippet</p> */
function parseBing(html) {
  const out = [];
  const liRe = /<li\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) && out.length < 8) {
    const seg = m[1];
    const a = seg.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    if (!/^https?:/i.test(a[1])) continue;
    const p = seg.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    out.push({ title: stripTags(a[2]), url: a[1], snippet: p ? stripTags(p[1]) : '' });
  }
  return out;
}

/* Wikipedia (CORS-friendly everywhere) */
function parseWiki(jsonText, lang) {
  const j = JSON.parse(jsonText);
  const hits = (j.query && j.query.search) || [];
  return hits.map((h) => ({
    title: fixPersian(h.title || ''),
    url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(String(h.title || '').replace(/ /g, '_')),
    snippet: stripTags(h.snippet || '')
  }));
}
/* __SEARCH_PARSERS_END__ */

/* engine chain: native = direct GET; web = CORS proxies then Wikipedia (direct) */
async function viaProxies(url, parse) {
  const wrapped = [
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url)
  ];
  for (const p of wrapped) {
    try {
      const r = parse(await fetchText(p, 13000));
      if (r && r.length) return r;
    } catch (e) { /* next proxy */ }
  }
  return [];
}

/* engine race: all engines run in parallel with per-engine timeout;
   first engine that returns results wins (order preserved via small staggers).
   native = direct GET; web = CORS proxies then Wikipedia (direct). */
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('search timeout')), ms))]);
}

async function runEngineRace(engines) {
  const tasks = engines.map((run, i) =>
    withTimeout(
      new Promise((res) => setTimeout(res, i * 220)).then(run),
      12000
    ).then((r) => {
      if (!r || !r.length) throw new Error('engine ' + i + ': empty');
      return r.slice(0, 5);
    })
  );
  try { return await Promise.any(tasks); } catch (e) { return []; }
}

async function webSearch(query) {
  const q = encodeURIComponent(String(query).slice(0, 140));
  const engines = [];
  if (ENV === 'web') {
    engines.push(() => viaProxies('https://lite.duckduckgo.com/lite/?q=' + q, parseDDGLite));
    engines.push(() => viaProxies('https://html.duckduckgo.com/html/?q=' + q, parseDDGHtml));
    engines.push(() => viaProxies('https://www.bing.com/search?q=' + q, parseBing));
    engines.push(async () => parseWiki(await fetchText('https://fa.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=5&srsearch=' + q, 11000), 'fa'));
    engines.push(async () => parseWiki(await fetchText('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=5&srsearch=' + q, 11000), 'en'));
  } else {
    engines.push(async () => parseDDGLite(await nativeGet('https://lite.duckduckgo.com/lite/?q=' + q)));
    engines.push(async () => parseDDGHtml(await nativeGet('https://html.duckduckgo.com/html/?q=' + q)));
    engines.push(async () => parseBing(await nativeGet('https://www.bing.com/search?q=' + q)));
    engines.push(async () => parseWiki(await nativeGet('https://fa.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=5&srsearch=' + q), 'fa'));
    engines.push(async () => parseWiki(await nativeGet('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=5&srsearch=' + q), 'en'));
  }
  try { return await runEngineRace(engines); } catch (e) { return []; }
}

const SEARCH_HINTS = /(اخبار|خبرهای|خبر |امروز|دیروز|به تازگی|جدیدترین|آخرین|اکنون|الان|قیمت|نرخ|دلار|تومان|بیت.?کوین|ارز|بورس|آب و هوا|هوا.?شناسی|نتیجه|جدول|امتیاز|انتخابات|نسخه|آپدیت|به.?روز|چه کسی|کی بود|کجاست|چند شد|تاریخ امروز|تعطیل|سال (۲۰)?\d{2}|۱۴۰[۰-۹])/i;

function shouldSearch(text) {
  const mode = settings.webSearch || 'auto';
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return SEARCH_HINTS.test(text);
}

/* ---------- one-shot request used by "test connection" ---------- */
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

/* ---------- markdown-lite renderer (with copy-code blocks) ---------- */
function renderMD(text) {
  let s = esc(fixPersian(text));
  const blocks = [];
  s = s.replace(/```([\w+#.-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    const i = blocks.length;
    const label = lang ? lang.toUpperCase() : 'کد';
    blocks.push(
      '<div class="codeblock"><div class="code-bar">' +
      '<span class="lang" dir="ltr">' + esc(label) + '</span>' +
      '<button type="button" class="code-copy"><svg class="ic ic-sm"><use href="#i-copy"/></svg><span>کپی کد</span></button>' +
      '</div><pre><code dir="ltr">' + code.replace(/\n$/, '') + '</code></pre></div>'
    );
    return '\u0000B' + i + '\u0000';
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

/* ---------- clipboard (secure-context + legacy fallback for WebView file://) ---------- */
function copyText(txt, onDone) {
  const done = () => { if (onDone) onDone(); };
  const legacy = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) { done(); }
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(done, legacy);
  } else legacy();
}

/* ---------- TTS: خواندن پاسخ با صدا ---------- */
const TTS_NATIVE = () => ENV === 'android' && typeof AndroidAI !== 'undefined' && AndroidAI.speak;
const TTS_WEB = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
let ttsVoices = [];
function loadVoices() {
  try { ttsVoices = speechSynthesis.getVoices() || []; } catch (e) { ttsVoices = []; }
}
if (TTS_WEB()) {
  loadVoices();
  try { speechSynthesis.onvoiceschanged = loadVoices; } catch (e) {}
}
function pickVoice() {
  return ttsVoices.find((v) => /^fa/i.test(v.lang)) ||
         ttsVoices.find((v) => /persian|farsi|فارسی/i.test(v.name)) || null;
}

let speakActive = null; // {btn, timer}
function setSpeakBtn(btn, on) {
  if (!btn) return;
  btn.classList.toggle('speaking', on);
  btn.title = on ? 'توقف خواندن' : 'خواندن با صدا';
  const use = btn.querySelector('use');
  if (use) use.setAttribute('href', on ? '#i-stop' : '#i-speak');
}
function cleanForSpeech(t) {
  let s = stripThink(t).text;
  s = s.replace(/[*_#]*\s*(?:منابع|منبع|Sources?)\s*:?\s*[\s\S]*$/i, ' ');
  s = s.replace(/```[\s\S]*?```/g, ' قطعهٔ کد. ');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\[([^\]]{1,80})\]\([^)]*\)/g, '$1');
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/[#>*_~|]+/g, ' ');
  s = s.replace(/^[-•]+\s*/gm, '');
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]/gu, ' ');
  s = fixPersian(s).replace(/\s+/g, ' ').trim();
  return s;
}
function stopSpeak() {
  try { if (TTS_NATIVE()) AndroidAI.stopSpeak(); } catch (e) {}
  try { if (TTS_WEB()) speechSynthesis.cancel(); } catch (e) {}
  if (speakActive) {
    clearTimeout(speakActive.timer);
    setSpeakBtn(speakActive.btn, false);
    speakActive = null;
  }
}
window.__ttsDone = function () {
  if (speakActive) {
    clearTimeout(speakActive.timer);
    setSpeakBtn(speakActive.btn, false);
    speakActive = null;
  }
};
function speak(raw, btn) {
  if (!raw) return;
  if (speakActive && speakActive.btn === btn) { stopSpeak(); return; }
  stopSpeak();
  const clean = cleanForSpeech(raw).slice(0, 4000);
  if (!clean) { toast('متنی برای خواندن نیست', true); return; }
  if (TTS_NATIVE()) {
    try { AndroidAI.speak(clean); } catch (e) { toast('خواندن با صدا ممکن نشد', true); return; }
    speakActive = { btn: btn, timer: setTimeout(window.__ttsDone, 4000 + clean.length * 95) };
    setSpeakBtn(btn, true);
  } else if (TTS_WEB()) {
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'fa-IR';
    u.rate = Number(settings.speakRate) || 1;
    u.pitch = 1;
    u.onend = window.__ttsDone;
    u.onerror = window.__ttsDone;
    speakActive = { btn: btn, timer: null };
    setSpeakBtn(btn, true);
    speechSynthesis.speak(u);
  } else {
    toast('خواندن با صدا در این دستگاه پشتیبانی نمی‌شود', true);
  }
}

/* ---------- state ---------- */
let settings = loadSettings();
let chats = loadChats();
memories = loadMemories();
let currentId = chats.length ? chats[0].id : null;
let activeStream = null;
let sendLock = false;

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
      ? '<div class="meta">' +
        '<button class="speak-btn" title="خواندن با صدا"><svg class="ic ic-sm"><use href="#i-speak"/></svg></button>' +
        '<button class="copy-btn"><svg class="ic ic-sm"><use href="#i-copy"/></svg><span> کپی پاسخ</span></button>' +
        '<span class="src-chip hidden"><svg class="ic ic-sm"><use href="#i-globe"/></svg><span class="src-txt"></span></span>' +
        '</div>'
      : '') +
    '</div>';
  if (role === 'bot') {
    const bubble = w.querySelector('.bubble');
    w.querySelector('.copy-btn').addEventListener('click', () => {
      copyText(bubble.innerText, () => {
        const b = w.querySelector('.copy-btn');
        b.innerHTML = '<svg class="ic ic-sm"><use href="#i-check"/></svg><span> کپی شد</span>';
        setTimeout(() => { b.innerHTML = '<svg class="ic ic-sm"><use href="#i-copy"/></svg><span> کپی پاسخ</span>'; }, 1600);
      });
    });
    w.querySelector('.speak-btn').addEventListener('click', () => {
      speak(w.dataset.raw || bubble.innerText, w.querySelector('.speak-btn'));
    });
  }
  $('#messages').appendChild(w);
  return w;
}

function errorHTML(msg) {
  return '<p style="color:var(--err);display:flex;align-items:center;gap:8px">' +
    '<svg class="ic ic-sm" style="color:var(--err)"><use href="#i-alert"/></svg><span>' + esc(msg) + '</span></p>';
}

function showSources(w, results) {
  const chip = w.querySelector('.src-chip');
  if (!chip || !results) return;
  chip.querySelector('.src-txt').textContent = 'جستجوی وب · ' + results.length + ' منبع';
  chip.classList.remove('hidden');
  chip.title = results.map((r, i) => '[' + (i + 1) + '] ' + r.title).join('\n');
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
      const v = fixPersian(stripThink(m.c).text) || '[پاسخی ثبت نشد]';
      const w = addMsgDom('bot', renderMD(v));
      w.dataset.raw = v;
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

async function send(textRaw) {
  if (sendLock) return;
  const text = (textRaw !== undefined ? textRaw : $('#input').value).trim();
  if (!text) return;

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

  sendLock = true;
  setBusy(true);

  /* — جستجوی زندهٔ وب — */
  let searchResults = null;
  const searchMode = settings.webSearch || 'auto';
  if (shouldSearch(text)) {
    const botId0 = 'bot-' + uid();
    const w0 = addMsgDom('bot', '<div class="searching-note"><svg class="ic"><use href="#i-globe"/></svg><span>در حال جستجوی وب برای اطلاعات تازه…</span></div>', botId0);
    scrollBottom(true);
    try {
      const r = await webSearch(text);
      if (r && r.length) searchResults = r;
    } catch (e) { searchResults = null; }
    w0.remove();
    if (!searchResults) {
      toast('جستجوی وب نتیجه‌ای نداشت — با دانش خودم پاسخ می‌دهم', true);
    }
  }

  const botId = 'bot-' + uid();
  const w = addMsgDom('bot', '<span class="typing"><i></i><i></i><i></i></span>', botId);
  scrollBottom(true);

  const style = STYLES[settings.style] || STYLES.detailed;
  const body = {
    model: chosenModel(), stream: true,
    temperature: Number(settings.temp) || 0.7,
    max_tokens: style.max_tokens,
    messages: [{ role: 'system', content: buildSystemPrompt(searchResults ? { query: text, results: searchResults } : null) }].concat(buildHistory(c))
  };

  let acc = '';
  activeStream = streamRequest(apiUrl(), apiHeaders(), body,
    (delta) => {
      acc += delta;
      const v = stripThink(acc);
      const bubble = w.querySelector('.bubble');
      if (v.thinking) {
        bubble.innerHTML = '<div class="thinking-note"><svg class="ic"><use href="#i-chip"/></svg><span>دارم عمیق فکر می‌کنم…</span></div>';
      } else if (v.text) {
        const shown = fixPersian(v.text);
        bubble.innerHTML = renderMD(shown);
        w.dataset.raw = shown;
      } else {
        bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      }
      scrollBottom(false);
    },
    (err) => {
      activeStream = null; setBusy(false); sendLock = false;
      const bubble = w.querySelector('.bubble');
      let v = stripThink(acc);
      if (searchResults && searchResults.length && v.text && !/منابع|source/i.test(v.text)) {
        v = { text: v.text + '\n\n**منابع:**\n' + searchResults.map((r, i) => '- [' + (i + 1) + '] [' + r.title + '](' + r.url + ')').join('\n'), thinking: false };
      }
      const finalText = fixPersian(v.text || '');
      if (err) {
        if (!acc.trim()) bubble.innerHTML = errorHTML(err);
        else bubble.innerHTML = renderMD(finalText) + '<p style="color:var(--err);font-size:12px;margin-top:6px">' + esc(err) + '</p>';
      } else if (!finalText.trim()) {
        bubble.innerHTML = errorHTML('پاسخی دریافت نشد — مدل و Account ID را در تنظیمات بررسی کنید.');
      } else {
        bubble.innerHTML = renderMD(finalText);
      }
      if (searchResults) showSources(w, searchResults);
      w.dataset.raw = finalText;
      c.msgs.push({ r: 'assistant', c: (finalText || '[خطا] ' + (err || '')).slice(0, 20000) });
      saveChats(chats);
      scrollBottom(false);
      if (!err && finalText.trim() && settings.autoSpeak) {
        speak(finalText, w.querySelector('.speak-btn'));
      }
    }
  );
}

function stopStream() {
  if (activeStream) { activeStream.stop(); }
}

/* ---------- categories UI ---------- */
function catLabel(id) { return (CATEGORIES[id] || CATEGORIES.general).name; }
function applyCat(id, silent) {
  const c = CATEGORIES[id];
  if (!c) return;
  settings.cat = id;
  settings.model = c.model;
  settings.temp = c.temp;
  settings.style = c.style;
  settings.webSearch = c.web;
  settings.autoSpeak = c.autoSpeak;
  settings.modelPicked = true;
  saveSettings(settings);
  refreshStatus(); updateWebBtn(); markCatCards();
  if (!silent) toast('حالت «' + c.name + '» فعال شد — مدل: ' + prettyModel(c.model));
}
function markCatCards() {
  document.querySelectorAll('.cat-card').forEach((b) => {
    b.classList.toggle('active', b.dataset.cat === settings.cat);
  });
}
function refreshCatBadge() {
  const c = CATEGORIES[settings.cat] || CATEGORIES.general;
  const use = document.querySelector('#cat-badge use');
  if (use) use.setAttribute('href', '#' + c.icon);
  document.querySelector('#cat-badge .cat-name').textContent = c.name;
}

/* ---------- web-search toggle (composer) ---------- */
const WEB_STATES = { auto: 'خودکار', always: 'همیشه', off: 'خاموش' };
function updateWebBtn() {
  const b = $('#btn-web');
  const m = settings.webSearch || 'auto';
  b.dataset.mode = m;
  b.title = 'جستجوی وب: ' + WEB_STATES[m] + ' (کلیک برای تغییر)';
  b.classList.toggle('mode-off', m === 'off');
  b.classList.toggle('mode-always', m === 'always');
}
function cycleWebMode() {
  const order = ['auto', 'always', 'off'];
  const next = order[(order.indexOf(settings.webSearch || 'auto') + 1) % order.length];
  settings.webSearch = next;
  saveSettings(settings);
  updateWebBtn();
  toast('جستجوی وب: ' + WEB_STATES[next]);
}

/* ---------- settings modal ---------- */
function openSettings() {
  $('#set-token').value = settings.token;
  $('#set-account').value = settings.account;
  $('#set-base').value = settings.base;
  const sel = $('#set-model');
  const opts = Array.from(sel.querySelectorAll('option')).map((o) => o.value);
  sel.value = opts.includes(settings.model) ? settings.model : 'custom';
  $('#set-model-custom').value = settings.modelCustom || '';
  $('#set-model-custom').classList.toggle('hidden', sel.value !== 'custom');
  $('#set-sysprompt').value = settings.sys || '';
  $('#set-style').value = settings.style || 'detailed';
  $('#set-temp').value = settings.temp;
  $('#temp-val').textContent = settings.temp;
  $('#set-web').value = settings.webSearch || 'auto';
  $('#set-autospeak').checked = !!settings.autoSpeak;
  $('#set-rate').value = settings.speakRate || 1;
  $('#rate-val').textContent = settings.speakRate || 1;
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
    webSearch: $('#set-web').value,
    autoSpeak: $('#set-autospeak').checked,
    speakRate: Number($('#set-rate').value) || 1,
    cat: settings.cat,
    modelPicked: true
  };
}

function saveFromModal() {
  settings = readSettingsFromModal();
  saveSettings(settings);
  refreshStatus(); updateWebBtn(); closeSettings();
  toast('تنظیمات ذخیره شد');
}

function refreshStatus() {
  const ok = settings.token.trim() && settings.account.trim();
  $('#status-dot').className = 'dot ' + (ok ? 'dot-on' : 'dot-off');
  $('#status-text').textContent = ok ? 'متصل — Cloudflare Workers AI' : 'تنظیمات لازم است';
  $('#model-badge span').textContent = prettyModel(chosenModel());
  refreshCatBadge();
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
  $('#set-rate').addEventListener('input', () => { $('#rate-val').textContent = $('#set-rate').value; });

  /* categories: welcome cards + header badge + modal */
  document.querySelectorAll('.cat-card').forEach((b) => {
    b.addEventListener('click', () => {
      applyCat(b.dataset.cat, false);
      if ($('#cat-backdrop') && !$('#cat-backdrop').classList.contains('hidden')) closeCat();
    });
  });
  $('#cat-badge').addEventListener('click', () => { markCatCards(); $('#cat-backdrop').classList.remove('hidden'); });
  $('#btn-close-cat').addEventListener('click', closeCat);
  $('#cat-backdrop').addEventListener('click', (e) => { if (e.target.id === 'cat-backdrop') closeCat(); });
  function closeCat() { $('#cat-backdrop').classList.add('hidden'); }

  /* web search quick toggle */
  $('#btn-web').addEventListener('click', cycleWebMode);

  /* code-copy (event delegation — bubbles re-render while streaming) */
  $('#messages').addEventListener('click', (e) => {
    const btn = e.target.closest('.code-copy');
    if (!btn) return;
    const block = btn.closest('.codeblock');
    if (!block) return;
    copyText(block.querySelector('code').innerText, () => {
      btn.classList.add('copied');
      btn.innerHTML = '<svg class="ic ic-sm"><use href="#i-check"/></svg><span>کپی شد!</span>';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg class="ic ic-sm"><use href="#i-copy"/></svg><span>کپی کد</span>';
      }, 1800);
    });
  });

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

  markCatCards(); updateWebBtn();
  renderChatList(); renderMessages(); refreshStatus(); autoGrow();

  window.addEventListener('beforeunload', () => { try { stopSpeak(); } catch (e) {} });

  /* PWA: register service worker only when served over https */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
