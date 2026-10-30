# 🤖 Sukot AI Bot — ربات هوش مصنوعی فارسی

ربات گفتگوی هوشمند فارسی‌زبان با قدرت **Cloudflare Workers AI** — یک بار بساز، همه‌جا اجرا کن:

| پلتفرم | فایل | وضعیت ساخت |
|---|---|---|
| 🤖 اندروید (APK) | `Sukot-AI-Bot-android.apk` | ![Android](https://github.com/sukot5104-lang/sukot-ai-bot/actions/workflows/android.yml/badge.svg) |
| 🪟 ویندوز (نصبی + پرتابل) | `Sukot-AI-Bot-Setup-1.0.0.exe` | ![Windows](https://github.com/sukot5104-lang/sukot-ai-bot/actions/workflows/windows.yml/badge.svg) |
| 🌐 وب / PWA | پوشه `web/` | همیشه با repo |

> 📦 **دانلود فایل‌های آماده:** بخش [Releases](../../releases) این ریپازیتوری.

## ✨ امکانات

- 💬 چت هوشمند با جریان پاسخ (streaming) — کلمه به کلمه مثل ChatGPT
- 🇮🇷 رابط کاربری کاملاً فارسی و راست‌به‌چپ
- 🧠 انتخاب مدل: Llama 3.1 / Llama 3.3 70B / DeepSeek R1 / Qwen / Mistral / Gemma یا مدل دلخواه
- 🗂️ چند گفتگوی همزمان با ذخیره خودکار
- ⚙️ تنظیم شخصیت ربات (System Prompt)، درجه خلاقیت (Temperature) و تست اتصال
- 📋 کپی پاسخ، توقف تولید، کد فنی با استایل مخصوص
- 🔐 توکن فقط روی دستگاه خودت ذخیره می‌شود (localStorage) — هیچ توکنی داخل کد نیست

## 🚀 راه‌اندازی (۳ دقیقه)

1. فایل APK یا EXE را از [Releases](../../releases) نصب کن (یا پوشه `web` را روی هاست بگذار)
2. در پنل کلادفلر: `dash.cloudflare.com` → **Workers AI** → **Use REST API** → توکن و **Account ID** را کپی کن
3. در ربات روی **⚙️ تنظیمات** بزن، توکن و Account ID را وارد کن → **💾 ذخیره** → **🔌 تست اتصال**
4. تمام! حالا هر سوالی داری بپرس ✨

> 💡 توکن باید دسترسی **Workers AI — Edit** داشته باشد. اگر هنگام ساخت توکن گزینه «IP Address Filtering» فعال بود، آن را حذف کن وگرنه خطای `9109` می‌گیری.

## 🛠 ساخت از سورس

```bash
# اندروید (نیاز به JDK 17 و Android SDK)
gradle -p android assembleDebug
# خروجی: android/app/build/outputs/apk/debug/app-debug.apk

# ویندوز (نیاز به Node 20)
cd electron && npm install && npm run dist
# خروجی: electron/dist/Sukot-AI-Bot-Setup-1.0.0.exe + نسخه Portable
```

بیلد هم به‌صورت خودکار با GitHub Actions انجام می‌شود — هر push به `main` یک APK و EXE تازه می‌سازد (تب Actions).

## 🌐 نسخه وب (اختیاری)

مرورگرها به‌خاطر سیاست CORS نمی‌توانند مستقیم به `api.cloudflare.com` وصل شوند. نسخه اندروید و ویندوز این مشکل را با پل بومی (Native Bridge) دور می‌زنند. اگر نسخه وب را می‌خواهی:

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

MIT — آزاد برای استفاده، تغییر و انتشار.
