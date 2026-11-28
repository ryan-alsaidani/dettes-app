package com.ryan.dettes;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * قراءة/كتابة ملفات داخل مجلد اختاره المستخدم (Storage Access Framework): يعمل مع التخزين الداخلي
 * وبطاقة الذاكرة وأي مزوّد مستندات (مثل Google Drive إن كان مثبّتًا) دون صلاحيات تخزين واسعة.
 */
public class FolderStore {

    private static final String DIR = DocumentsContract.Document.MIME_TYPE_DIR;

    private final ContentResolver cr;

    public FolderStore(ContentResolver cr) {
        this.cr = cr;
    }

    /** اسم المجلد للعرض. */
    public static String displayName(ContentResolver cr, Uri tree) {
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            Cursor c = cr.query(doc, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null);
            try {
                if (c != null && c.moveToFirst()) return c.getString(0);
            } finally {
                if (c != null) c.close();
            }
        } catch (Exception ignored) {
            // الاسم للعرض فقط
        }
        return "مجلد محدد";
    }

    private String findChildId(Uri tree, String parentId, String name, boolean dirOnly) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        Cursor c = cr.query(children, new String[]{
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null);
        try {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1)) && (!dirOnly || DIR.equals(c.getString(2)))) return c.getString(0);
            }
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    /** معرّف مجلد فرعي تحت جذر الشجرة (subDir فارغ = الجذر). ينشئه إن طُلب. */
    private String resolveDir(Uri tree, String subDir, boolean create) throws IOException {
        String rootId = DocumentsContract.getTreeDocumentId(tree);
        if (subDir == null || subDir.length() == 0) return rootId;
        String existing = findChildId(tree, rootId, subDir, true);
        if (existing != null) return existing;
        if (!create) return null;
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, rootId);
        Uri created = DocumentsContract.createDocument(cr, parent, DIR, subDir);
        if (created == null) throw new IOException("تعذّر إنشاء المجلد");
        return DocumentsContract.getDocumentId(created);
    }

    /** يكتب ملفًا (وينشئ المجلد الفرعي إن لزم). overwrite=true يستبدل ملفًا بنفس الاسم (مثل latest.json). */
    public void write(Uri tree, String subDir, String name, String mime, byte[] bytes, boolean overwrite) throws IOException {
        String dirId = resolveDir(tree, subDir, true);
        Uri target = null;
        if (overwrite) {
            String id = findChildId(tree, dirId, name, false);
            if (id != null) target = DocumentsContract.buildDocumentUriUsingTree(tree, id);
        }
        if (target == null) {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, dirId);
            target = DocumentsContract.createDocument(cr, parent, mime, name);
        }
        if (target == null) throw new IOException("تعذّر إنشاء الملف");
        OutputStream os = cr.openOutputStream(target, "wt");
        if (os == null) throw new IOException("لا يمكن الكتابة في هذا المجلد");
        try {
            os.write(bytes);
        } finally {
            os.close();
        }
    }

    /** يقرأ ملفًا بالاسم؛ null إن لم يوجد. */
    public byte[] read(Uri tree, String subDir, String name) throws IOException {
        String dirId = resolveDir(tree, subDir, false);
        if (dirId == null) return null;
        String id = findChildId(tree, dirId, name, false);
        if (id == null) return null;
        InputStream is = cr.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id));
        if (is == null) throw new IOException("تعذّرت قراءة الملف");
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } finally {
            is.close();
        }
    }

    /** قائمة محتويات المجلد: [{name, dir, size, modified}] بصيغة JSON. */
    public String list(Uri tree, String subDir) throws IOException, JSONException {
        String dirId = resolveDir(tree, subDir, false);
        JSONArray arr = new JSONArray();
        if (dirId == null) return arr.toString();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId);
        Cursor c = cr.query(children, new String[]{
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null);
        try {
            while (c != null && c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("name", c.getString(0));
                o.put("dir", DIR.equals(c.getString(1)));
                o.put("size", c.isNull(2) ? 0 : c.getLong(2));
                o.put("modified", c.isNull(3) ? 0 : c.getLong(3));
                arr.put(o);
            }
        } finally {
            if (c != null) c.close();
        }
        return arr.toString();
    }
}
