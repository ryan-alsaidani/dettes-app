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
        return "0.2.0";
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
}
