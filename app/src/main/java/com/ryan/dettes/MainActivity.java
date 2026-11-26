package com.ryan.dettes;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;

import androidx.webkit.WebViewAssetLoader;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.ResultPoint;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends Activity {

    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";

    private static final String BASE_URL = "https://appassets.androidplatform.net/";

    private static final int REQ_SAVE = 4101;
    private static final int REQ_FILE = 4102;
    private static final int REQ_CAMERA = 4103;

    private WebView webView;
    private String pendingSaveText;
    private ValueCallback<Uri[]> fileCallback;
    private WebView printWebView; // يبقى مرجعه حيًّا حتى تنتهي الطباعة
    private WebViewAssetLoader assetLoader;
    private LinearLayout rootLayout;

    // الماسح الحيّ (السلة السريعة): شريط كاميرا فوق الصفحة يبقى مفتوحًا بين الباركودات
    private DecoratedBarcodeView scanView;
    private boolean scanning = false;
    private String lastScanned = null;
    private ToneGenerator tone;

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

        LinearLayout root = new LinearLayout(this);
        rootLayout = root;
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);
        scanView = new DecoratedBarcodeView(this);
        scanView.setVisibility(View.GONE);
        int scanHeight = (int) (getResources().getDisplayMetrics().heightPixels * 0.32f);
        root.addView(scanView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, scanHeight));
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

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

    /** يغيّر لون شريطي الحالة والتنقل وخلفية الصفحة بحسب المظهر (فاتح/داكن). */
    public void setBarColors(String hex, boolean darkIcons) {
        int c;
        try {
            c = Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return;
        }
        getWindow().setStatusBarColor(c);
        getWindow().setNavigationBarColor(c);
        getWindow().getDecorView().setBackgroundColor(c);
        if (rootLayout != null) rootLayout.setBackgroundColor(c);
        if (webView != null) webView.setBackgroundColor(c);
        View decor = getWindow().getDecorView();
        int flags = decor.getSystemUiVisibility();
        int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) mask |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(darkIcons ? (flags | mask) : (flags & ~mask));
    }

    // ---------- الماسح الحيّ ----------

    private void js(String code) {
        if (webView != null) webView.evaluateJavascript(code, null);
    }

    private void beep() {
        try {
            if (tone == null) tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 80);
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, 120);
        } catch (Exception ignored) {
            // الصوت اختياري
        }
    }

    /** يبدأ الماسح الحيّ (يطلب إذن الكاميرا أولًا). تصل الباركودات إلى window.__onScanCode. */
    public void scanStart() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
            return;
        }
        beginScan();
    }

    private void beginScan() {
        if (!scanning) {
            scanning = true;
            lastScanned = null;
            scanView.setVisibility(View.VISIBLE);
            scanView.setStatusText("وجّه الكاميرا نحو الباركود");
            List<BarcodeFormat> formats = Arrays.asList(
                    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
                    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
                    BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX);
            scanView.getBarcodeView().setDecoderFactory(new DefaultDecoderFactory(formats));
            scanView.decodeContinuous(new BarcodeCallback() {
                @Override
                public void barcodeResult(BarcodeResult result) {
                    String text = result == null ? null : result.getText();
                    if (text == null || text.length() == 0) return;
                    // لا نكرّر نفس الباركود مرتين متتاليتين (الكاميرا تلتقطه في عدة إطارات)
                    if (text.equals(lastScanned)) return;
                    lastScanned = text;
                    beep();
                    js("window.__onScanCode && window.__onScanCode(" + JSONObject.quote(text) + ")");
                }

                @Override
                public void possibleResultPoints(List<ResultPoint> resultPoints) {
                }
            });
        }
        scanView.resume();
        js("window.__onScanState && window.__onScanState('started')");
    }

    public void scanStop() {
        if (!scanning) return;
        scanning = false;
        scanView.pause();
        scanView.setVisibility(View.GONE);
        js("window.__onScanState && window.__onScanState('stopped')");
    }

    public void scanTorch(boolean on) {
        if (!scanning) return;
        if (on) scanView.setTorchOn(); else scanView.setTorchOff();
    }

    /** يسمح بمسح الباركود الأخير مجددًا (مثلًا بعد حذفه من السلة). */
    public void scanResetLast() {
        lastScanned = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                beginScan();
            } else {
                js("window.__onScanState && window.__onScanState('denied')");
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (scanning) scanView.resume();
    }

    @Override
    protected void onPause() {
        if (scanning) scanView.pause();
        super.onPause();
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
        if (scanView != null) scanView.pause();
        if (tone != null) tone.release();
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
