package com.sukot.aibot;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Sukot AI Bot — Android WebView wrapper.
 * The UI lives in assets/web (same files as Windows/browser version).
 * Native bridge "AndroidAI" performs streaming HTTP so the app is not
 * affected by browser CORS restrictions against api.cloudflare.com.
 */
public class MainActivity extends Activity {

    private WebView webView;
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
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
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
                        conn.setRequestMethod("POST");
                        conn.setDoOutput(true);
                        conn.setConnectTimeout(20000);
                        conn.setReadTimeout(180000);
                        // avoid transparent gzip so we get real-time chunks
                        conn.setRequestProperty("Accept-Encoding", "identity");
                        JSONObject hj = new JSONObject(headersJson);
                        Iterator<String> keys = hj.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            conn.setRequestProperty(k, hj.optString(k, ""));
                        }
                        OutputStream os = conn.getOutputStream();
                        os.write(bodyJson.getBytes(StandardCharsets.UTF_8));
                        os.flush();
                        os.close();

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
    }
}
