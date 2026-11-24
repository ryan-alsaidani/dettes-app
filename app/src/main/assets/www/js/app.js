// المرحلة 0: اختبارات سريعة فقط. ستُستبدل بالتطبيق الفعلي في المرحلة 1.

function mark(id, ok, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.add(ok ? 'ok' : 'bad');
}

function testIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dettes-phase0', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('t');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('t', 'readwrite');
      tx.objectStore('t').put('ok', 'k');
      tx.oncomplete = () => {
        const get = db.transaction('t').objectStore('t').get('k');
        get.onsuccess = () => { db.close(); resolve(get.result === 'ok'); };
        get.onerror = () => reject(get.error);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

mark('st-js', true, 'يعمل');

testIndexedDB()
  .then(ok => mark('st-db', ok, ok ? 'يعمل' : 'فشل'))
  .catch(() => mark('st-db', false, 'فشل'));

try {
  const v = window.Android && window.Android.version();
  mark('st-bridge', !!v, v ? 'يعمل ' + v : 'غير موجود');
} catch (e) {
  mark('st-bridge', false, 'فشل');
}

let n = 0;
document.getElementById('btn').addEventListener('click', (e) => {
  n += 1;
  e.currentTarget.textContent = 'ضغطت ' + n + ' مرة';
});
