package com.ryan.dettes;

import android.webkit.JavascriptInterface;

/** جسر JavaScript. في المرحلة 0 دالة اختبار واحدة فقط. */
public class Bridge {

    @JavascriptInterface
    public String version() {
        return "0.0.1";
    }
}
