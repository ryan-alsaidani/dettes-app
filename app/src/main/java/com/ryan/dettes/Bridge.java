package com.ryan.dettes;

import android.webkit.JavascriptInterface;

/** جسر JavaScript → أندرويد. تُستدعى دوالّه من خيط خلفي، لذا الواجهة تمرّ عبر runOnUiThread. */
public class Bridge {

    private final MainActivity activity;

    public Bridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String version() {
        return "0.6.0";
    }

    /** يفتح ماسح الباركود. النتيجة تصل لاحقًا إلى window.__onBarcode(text|null). */
    @JavascriptInterface
    public void scanBarcode() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.startScan();
            }
        });
    }

    /** يفتح حوار الطباعة لصفحة HTML كاملة. */
    @JavascriptInterface
    public void printHtml(final String html) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.printHtml(html);
            }
        });
    }

    /** يحفظ نصًّا (نسخة احتياطية JSON) في ملف يختار المستخدم موضعه. */
    @JavascriptInterface
    public void saveFile(final String name, final String mime, final String text) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.startSave(name, mime, text);
            }
        });
    }
}
