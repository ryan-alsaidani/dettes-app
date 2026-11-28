package com.ryan.dettes;

import android.util.Base64;
import android.webkit.JavascriptInterface;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import java.util.EnumMap;
import java.util.Map;

/** جسر JavaScript → أندرويد. تُستدعى دوالّه من خيط خلفي، لذا الواجهة تمرّ عبر runOnUiThread. */
public class Bridge {

    private final MainActivity activity;

    public Bridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String version() {
        return "0.10.0";
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

    /** يفتح قائمة المشاركة لنص (رمز الجهاز للتجديد). */
    @JavascriptInterface
    public void shareText(final String text) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.shareText(text);
            }
        });
    }

    /** الماسح الحيّ: شريط كاميرا يبقى مفتوحًا ويرسل كل باركود جديد إلى window.__onScanCode. */
    @JavascriptInterface
    public void scanStart() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.scanStart();
            }
        });
    }

    @JavascriptInterface
    public void scanStop() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.scanStop();
            }
        });
    }

    @JavascriptInterface
    public void scanTorch(final boolean on) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.scanTorch(on);
            }
        });
    }

    @JavascriptInterface
    public void scanResetLast() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.scanResetLast();
            }
        });
    }

    /** لون شريطي الحالة والتنقل بحسب مظهر التطبيق. */
    @JavascriptInterface
    public void setBarColors(final String hex, final boolean darkIcons) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.setBarColors(hex, darkIcons);
            }
        });
    }

    /** يحفظ بايتات (Base64) مثل ZIP في ملف يختار المستخدم موضعه. */
    @JavascriptInterface
    public void saveFileB64(final String name, final String mime, final String b64) {
        final byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.startSaveBytes(name, mime, bytes);
            }
        });
    }

    /** مصفوفة QR كأسطر من 0/1 (مكتبة ZXing). فارغ عند الفشل (النص أطول من السعة). level: L|M|Q|H. */
    @JavascriptInterface
    public String qrMatrix(String text, String level) {
        try {
            Map<EncodeHintType, Object> hints = new EnumMap<EncodeHintType, Object>(EncodeHintType.class);
            hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.valueOf(level));
            hints.put(EncodeHintType.MARGIN, 0);
            BitMatrix m = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints);
            StringBuilder sb = new StringBuilder();
            int w = m.getWidth();
            int h = m.getHeight();
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) sb.append(m.get(x, y) ? '1' : '0');
                if (y < h - 1) sb.append('\n');
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public void folderPick() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.folderPick();
            }
        });
    }

    @JavascriptInterface
    public void folderOp(String id, String op, String treeUri, String subDir, String name, String mime, String b64) {
        activity.folderOp(id, op, treeUri, subDir, name, mime, b64);
    }

    @JavascriptInterface
    public void keepAwake(final boolean on) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.keepAwake(on);
            }
        });
    }
}
