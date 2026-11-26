package com.ryan.dettes;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {

    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";

    private static final String BASE_URL = "https://appassets.androidplatform.net/";

    private static final int REQ_SAVE = 4101;
    private static final int REQ_FILE = 4102;

    private WebView webView;
    private String pendingSaveText;
    private ValueCallback<Uri[]> fileCallback;
    private WebView printWebView; // يبقى مرجعه حيًّا حتى تنتهي الطباعة
    private WebViewAssetLoader assetLoader;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int bg = Color.parseColor("#0D0D12");
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        getWindow().getDecorView().setBackgroundColor(bg);

        webView = new WebView(this);
        webView.setBackgroundColor(bg);
        setContentView(webView);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        // لازم لـ <input type="file"> (استيراد النسخة الاحتياطية)
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new Bridge(this), "Android");

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /** يُستدعى من الجسر على خيط الواجهة. */
    public void startScan() {
        IntentIntegrator integrator = new IntentIntegrator(this);
        integrator.setPrompt("وجّه الكاميرا نحو الباركود");
        integrator.setBeepEnabled(false);
        integrator.setOrientationLocked(false);
        integrator.initiateScan();
    }

    /** قائمة المشاركة الأصلية (واتساب، رسائل...) لنص معيّن، مثل رمز الجهاز. */
    public void shareText(String text) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("text/plain");
        intent.putExtra(Intent.EXTRA_TEXT, text);
        startActivity(Intent.createChooser(intent, "إرسال رمز الجهاز"));
    }

    /** يفتح «حفظ ملف» الأصلي. النتيجة تصل إلى window.__onSaved(ok, message). */
    public void startSave(String name, String mime, String text) {
        pendingSaveText = text;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(intent, REQ_SAVE);
        } catch (Exception e) {
            pendingSaveText = null;
            webView.evaluateJavascript("window.__onSaved && window.__onSaved(false, " + JSONObject.quote("تعذّر فتح نافذة الحفظ") + ")", null);
        }
    }

    private void finishSave(int resultCode, Intent data) {
        String text = pendingSaveText;
        pendingSaveText = null;
        if (resultCode != RESULT_OK || data == null || data.getData() == null || text == null) {
            webView.evaluateJavascript("window.__onSaved && window.__onSaved(false, null)", null);
            return;
        }
        try {
            OutputStream os = getContentResolver().openOutputStream(data.getData(), "wt");
            if (os == null) throw new java.io.IOException("لا يمكن الكتابة في هذا الموضع");
            try {
                os.write(text.getBytes(StandardCharsets.UTF_8));
            } finally {
                os.close();
            }
            webView.evaluateJavascript("window.__onSaved && window.__onSaved(true, null)", null);
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "فشل الحفظ" : e.getMessage();
            webView.evaluateJavascript("window.__onSaved && window.__onSaved(false, " + JSONObject.quote(msg) + ")", null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_SAVE) {
            finishSave(resultCode, data);
            return;
        }
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (result != null) {
            String contents = result.getContents();
            String arg = contents == null ? "null" : JSONObject.quote(contents);
            webView.evaluateJavascript("window.__onBarcode && window.__onBarcode(" + arg + ")", null);
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    /** طباعة HTML عبر حوار الطباعة الأصلي (طابعة أو «حفظ كـPDF»). يُستدعى على خيط الواجهة. */
    public void printHtml(final String html) {
        final WebView pv = new WebView(this);
        pv.getSettings().setJavaScriptEnabled(false);
        pv.getSettings().setAllowFileAccess(false);
        final boolean[] started = {false};
        pv.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(final WebView view, String url) {
                if (started[0]) return;
                started[0] = true;
                // مهلة قصيرة ليكتمل تحميل الخط قبل التقاط الصفحة
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                        String job = "دفتر الديون";
                        PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(job);
                        PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .build();
                        pm.print(job, adapter, attrs);
                    }
                }, 700);
            }
        });
        printWebView = pv;
        pv.loadDataWithBaseURL(BASE_URL, html, "text/html", "utf-8", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
