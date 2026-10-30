# سوکات AI — دستیار هوشمند فارسی

<div align="center">
<img src="web/img/hero.jpg" width="180" alt="سوکات AI" style="border-radius:24px;box-shadow:0 8px 40px rgba(168,85,247,.45)"/>
</div>

ربات گفتگوی هوشمند فارسی‌زبان با «مغز بزرگ» و حافظهٔ بلندمدت، با قدرت **Cloudflare Workers AI** — طراحی و ساخت **Sukot** · نسخه **1.1.0**

| پلتفرم | فایل | وضعیت ساخت |
|---|---|---|
| 🤖 اندروید (APK) | `Sukot-AI-Bot-android.apk` | ![Android](https://github.com/sukot5104-lang/sukot-ai-bot/actions/workflows/android.yml/badge.svg) |
| 🪟 ویندوز (نصبی + پرتابل) | `Sukot-AI-Bot-Setup-1.1.0.exe` / `Sukot-AI-Bot-Portable-1.1.0.exe` | ![Windows](https://github.com/sukot5104-lang/sukot-ai-bot/actions/workflows/windows.yml/badge.svg) |
| 🌐 وب / PWA | پوشه `web/` | همیشه با repo |

> 📦 **دانلود فایل‌های آماده:** بخش [Releases](../../releases) این ریپازیتوری.
> 🌐 **نسخه آنلاین (بدون نصب):** https://sukot5104-lang.github.io/sukot-ai-bot/

## ✨ امکانات

### مغز بزرگ (جدید در 1.1.0)
- 🧠 **حافظهٔ بلندمدت**: هر چیزی که دربارهٔ خودت بگویی (اسم، شهر، علاقه‌ها، شغل…) یا دستی در «مغز و حافظه» بنویسی، برای همیشه یادش می‌ماند و در همهٔ گفتگوها از آن استفاده می‌کند
- 📚 **پنجرهٔ متن بلند**: تا ۲۴ پیام آخر گفتگو در حافظهٔ کوتاه‌مدت مدل می‌ماند
- 🧩 پشتیبانی از مدل‌های **استدلالی** (DeepSeek R1، QwQ) — مرحلهٔ فکر کردنِ مدل به‌صورت خودکار از پاسخ جدا می‌شود

### هوشمندتر و کامل‌تر
- 🎛 **۱۶ مدل هوش مصنوعی**: Llama 3.3 70B (سریع/دقیق)، GPT-OSS 120B/20B، Llama 4 Scout، Qwen 3، QwQ، DeepSeek R1، Mistral Small، Gemma 3 و… + مدل دلخواه
- ✍️ **سبک پاسخ**: کوتاه / متعادل / مفصل (پیش‌فرض: مفصل — با مثال و جمع‌بندی)
- 👑 شخصیت بومی «سوکات»: فارسیِ خودمانی، پاسخ‌های منظم با markdown — و می‌داند سازنده‌اش **Sukot** است

### طراحی و تجربه
- 🌌 تم «شبِ بنفش» با تصویر اختصاصی، افکت درخشش و گلبرگ‌های شناور
- 🧭 آیکون‌های SVG تمیز (بدون ایموجی)، دکمهٔ ارسال/توقف، کپی پاسخ
- 🗂 چند گفتگوی همزمان با ذخیرهٔ خودکار، توقف تولید، تست اتصال
- 📱 یک کد، سه پلتفرم: Android WebView (پل بومی) · Electron Windows (IPC) · PWA

## 🚀 راه‌اندازی (۳ دقیقه)

1. فایل APK یا EXE را از [Releases](../../releases) نصب کن (یا پوشه `web` را روی هاست بگذار)
2. در پنل کلادفلر: `dash.cloudflare.com` → **Workers AI** → **Use REST API** → توکن و **Account ID** را کپی کن
3. در ربات روی **تنظیمات** بزن، توکن و Account ID را وارد کن → **ذخیره** → **تست اتصال**
4. تمام! حالا هر سوالی داری بپرس ✨

> 💡 توکن باید دسترسی **Workers AI — Edit** داشته باشد. اگر هنگام ساخت توکن گزینهٔ «IP Address Filtering» فعال بود، آن را حذف کن وگرنه خطای `9109` می‌گیری.

## 🛠 ساخت از سورس

```bash
# اندروید (نیاز به JDK 17 و Android SDK)
gradle -p android assembleDebug
# خروجی: android/app/build/outputs/apk/debug/app-debug.apk

# ویندوز (نیاز به Node 20)
cd electron && npm install && npm run dist
# خروجی: electron/dist/Sukot-AI-Bot-Setup-1.1.0.exe + نسخهٔ Portable
```

بیلد هم به‌صورت خودکار با GitHub Actions انجام می‌شود — هر push به `main` یک APK و EXE تازه می‌سازد (تب Actions).

## 🌐 نسخهٔ وب (اختیاری)

مرورگرها به‌خاطر سیاست CORS نمی‌توانند مستقیم به `api.cloudflare.com` وصل شوند. نسخهٔ اندروید و ویندوز این مشکل را با پل بومی (Native Bridge) دور می‌زنند. اگر نسخهٔ وب را می‌خواهی:

1. در کلادفلر: **Workers & Pages → Create → Worker**
2. محتوای فایل [`worker/worker.js`](worker/worker.js) را داخلش Paste کن و Deploy بزن
3. در تنظیمات ربات، «آدرس API» را بگذار: `https://<your-worker>.workers.dev/cf/<ACCOUNT_ID>`

## 🧪 تست محلی بدون کلادفلر

```bash
node scripts/mock-cf-server.js 8787
# سپس http://127.0.0.1:8787 را باز کن
```

## 🔐 امنیت

- هیچ توکن یا رمزی داخل کد ذخیره نشده — توکن فقط در دستگاه خودت (localStorage) می‌ماند
- اگر توکنی را جایی عمومی فرستادی (چت، اسکرین‌شات…)، حتماً از پنل آن را **Rotate/حذف** کن

## 📜 مجوز

MIT — آزاد برای استفاده، تغییر و انتشار. ساخت ❤️ **Sukot**
