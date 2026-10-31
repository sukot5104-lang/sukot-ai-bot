package com.sukot.aibot;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Sukot AI Bot — Android WebView wrapper.
 * The UI lives in assets/web (same files as Windows/browser version).
 * Native bridge "AndroidAI" performs streaming HTTP so the app is not
 * affected by browser CORS restrictions against api.cloudflare.com,
 * and speaks answers aloud via Android TextToSpeech.
 */
public class MainActivity extends Activity {

    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

    private WebView webView;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 41001;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, AtomicBoolean> cancelled = new ConcurrentHashMap<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                /* keep the app inside the WebView; open external links in the browser */
                if (url != null && url.startsWith("file://")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) { }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            /* ---- file/image picker for the chat attachments (paperclip button, v1.4.0) ---- */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    try { filePathCallback.onReceiveValue(null); } catch (Exception ignored) { }
                }
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
        webView.addJavascriptInterface(new Bridge(), "AndroidAI");
        webView.loadUrl("file:///android_asset/web/index.html");

        /* Persian text-to-speech for reading answers aloud */
        try {
            tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    if (status == TextToSpeech.SUCCESS && tts != null) {
                        try {
                            int r = tts.setLanguage(new Locale("fa", "IR"));
                            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                                tts.setLanguage(new Locale("fa"));
                                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                                    tts.setLanguage(Locale.getDefault());
                                }
                            }
                            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                                @Override
                                public void onStart(String utteranceId) { }

                                @Override
                                public void onDone(String utteranceId) {
                                    js("window.__ttsDone && window.__ttsDone();");
                                }

                                @Override
                                public void onError(String utteranceId) {
                                    js("window.__ttsDone && window.__ttsDone();");
                                }
                            });
                            ttsReady = true;
                        } catch (Exception ignored) { }
                    }
                }
            });
        } catch (Exception ignored) { }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    /* ---- result of the file/image picker → forward to the WebView ---- */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    int count = Math.min(clip.getItemCount(), 4);
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) results[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
            }
            if (filePathCallback != null) {
                try { filePathCallback.onReceiveValue(results); } catch (Exception ignored) { }
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) { }
        }
        if (webView != null) webView.destroy();
        pool.shutdownNow();
        super.onDestroy();
    }

    private void js(final String script) {
        ui.post(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private void emitChunk(String id, String chunk) {
        js("window.__aiChunk(" + JSONObject.quote(id) + "," + JSONObject.quote(chunk) + ");");
    }

    private void emitDone(String id, String error) {
        js("window.__aiDone(" + JSONObject.quote(id) + "," + (error == null ? "null" : JSONObject.quote(error)) + ");");
    }

    class Bridge {

        @JavascriptInterface
        public void request(final String id, final String url, final String headersJson, final String bodyJson) {
            final AtomicBoolean flag = new AtomicBoolean(false);
            cancelled.put(id, flag);
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection conn = null;
                    try {
                        conn = (HttpURLConnection) new URL(url).openConnection();
                        /* empty body (or "null") => GET (used by web search);
                           otherwise POST with the JSON body */
                        String body = bodyJson == null ? "" : bodyJson;
                        boolean isGet = body.isEmpty() || "null".equals(body);
                        conn.setRequestMethod(isGet ? "GET" : "POST");
                        conn.setDoOutput(!isGet);
                        conn.setConnectTimeout(20000);
                        conn.setReadTimeout(180000);
                        conn.setRequestProperty("Accept-Encoding", "identity");
                        conn.setRequestProperty("User-Agent", UA);
                        JSONObject hj = new JSONObject(headersJson);
                        Iterator<String> keys = hj.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            if (k == null) continue;
                            conn.setRequestProperty(k, hj.optString(k, ""));
                        }
                        if (!isGet) {
                            OutputStream os = conn.getOutputStream();
                            os.write(body.getBytes(StandardCharsets.UTF_8));
                            os.flush();
                            os.close();
                        }

                        int code = conn.getResponseCode();
                        if (code >= 400) {
                            BufferedReader br = new BufferedReader(
                                    new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8));
                            StringBuilder sb = new StringBuilder();
                            String l;
                            while ((l = br.readLine()) != null) sb.append(l).append('\n');
                            br.close();
                            emitDone(id, code + "||" + sb);
                            return;
                        }

                        BufferedReader br = new BufferedReader(
                                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                        char[] buf = new char[4096];
                        int n;
                        while ((n = br.read(buf)) != -1) {
                            if (flag.get()) {
                                emitDone(id, null);
                                br.close();
                                return;
                            }
                            emitChunk(id, new String(buf, 0, n));
                        }
                        br.close();
                        emitDone(id, null);
                    } catch (Exception e) {
                        if (flag.get()) emitDone(id, null);
                        else emitDone(id, "000||خطای شبکه: " + e.getMessage());
                    } finally {
                        cancelled.remove(id);
                        if (conn != null) conn.disconnect();
                    }
                }
            });
        }

        @JavascriptInterface
        public void cancel(String id) {
            AtomicBoolean f = cancelled.get(id);
            if (f != null) f.set(true);
        }

        /* ---- open external links (e.g. Telegram channel) in the system browser ---- */
        @JavascriptInterface
        public void openUrl(final String url) {
            if (url == null || !url.startsWith("http")) return;
            ui.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) { }
                }
            });
        }

        /* ---- Persian TTS bridge ---- */
        /* آیا موتور گفتار دستگاه صدای فارسی دارد؟ */
        @JavascriptInterface
        public boolean hasFaTts() {
            if (!ttsReady || tts == null) return false;
            try {
                if (Build.VERSION.SDK_INT >= 21) {
                    Set<Locale> langs = tts.getAvailableLanguages();
                    if (langs != null) {
                        for (Locale l : langs) {
                            if (l != null && l.getLanguage() != null && l.getLanguage().startsWith("fa")) return true;
                        }
                    }
                }
                int r = tts.isLanguageAvailable(new Locale("fa", "IR"));
                return r >= TextToSpeech.LANG_AVAILABLE;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void speak(final String text) {
            if (!ttsReady || tts == null || text == null || text.trim().isEmpty()) return;
            try {
                tts.stop();
                HashMap<String, String> params = new HashMap<String, String>();
                params.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "sukot-" + System.currentTimeMillis());
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, params);
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void stopSpeak() {
            if (ttsReady && tts != null) {
                try { tts.stop(); } catch (Exception ignored) { }
            }
        }

        /* ---- v1.5.0: ذخیرهٔ عکس ساخته‌شده (data URL) در گالری/حافظه ---- */
        @JavascriptInterface
        public String saveImage(final String name, final String dataUrl) {
            try {
                if (dataUrl == null || !dataUrl.startsWith("data:image/")) return "";
                int comma = dataUrl.indexOf(',');
                if (comma < 0) return "";
                final byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                final String fname = (name == null || name.trim().isEmpty())
                        ? ("sukot-image-" + System.currentTimeMillis() + ".jpg") : name;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Images.Media.DISPLAY_NAME, fname);
                    cv.put(MediaStore.Images.Media.MIME_TYPE,
                            dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg");
                    cv.put(MediaStore.Images.Media.RELATIVE_PATH,
                            Environment.DIRECTORY_PICTURES + "/Sukot");
                    Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return "";
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) return "";
                    os.write(bytes);
                    os.flush();
                    os.close();
                    return "Pictures/Sukot/" + fname;
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Sukot");
                    if (!dir.exists()) dir.mkdirs();
                    File f = new File(dir, fname);
                    FileOutputStream fo = new FileOutputStream(f);
                    fo.write(bytes);
                    fo.flush();
                    fo.close();
                    return f.getAbsolutePath();
                }
            } catch (Exception e) {
                return "";
            }
        }
    }
}
