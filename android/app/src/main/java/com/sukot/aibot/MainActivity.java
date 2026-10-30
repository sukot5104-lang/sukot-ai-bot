package com.sukot.aibot;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
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

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
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

        /* ---- Persian TTS bridge ---- */
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
    }
}
