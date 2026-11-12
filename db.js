/* db.js : IndexedDB (SQLite की जगह). ऐप और worker.js दोनों इसे इस्तेमाल करते हैं. */
(function (g) {
  'use strict';

  var DB_NAME = 'avity_guide';
  var DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('items')) {
          var items = db.createObjectStore('items', { keyPath: 'id' });
          items.createIndex('w', 'w', { multiEntry: true });
        }
        if (!db.objectStoreNames.contains('answers')) {
          db.createObjectStore('answers', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      r.onsuccess = function () {
        var db = r.result;
        db.onversionchange = function () {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      r.onerror = function () {
        dbPromise = null;
        reject(r.error);
      };
      r.onblocked = function () {
        dbPromise = null;
        reject(new Error('डेटाबेस दूसरे टैब में खुला है'));
      };
    });
    return dbPromise;
  }

  function run(stores, mode, work) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var result;
        var tx = db.transaction(stores, mode);
        tx.oncomplete = function () {
          resolve(result);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
        tx.onabort = function () {
          reject(tx.error || new Error('IndexedDB abort'));
        };
        work(tx, function (v) {
          result = v;
        });
      });
    });
  }

  function normalize(s) {
    return String(s)
      .normalize('NFD')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .trim();
  }

  function words(k) {
    var parts = k.split(' ');
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < parts.length && out.length < 16; i++) {
      var w = parts[i];
      if (!w) continue;
      if (w.length > 40) w = w.slice(0, 40);
      if (!seen[w]) {
        seen[w] = true;
        out.push(w);
      }
    }
    return out;
  }

  function getMeta(key) {
    return run('meta', 'readonly', function (tx, set) {
      var r = tx.objectStore('meta').get(key);
      r.onsuccess = function () {
        set(r.result ? r.result.value : undefined);
      };
    });
  }

  function setMeta(key, value) {
    return run('meta', 'readwrite', function (tx) {
      tx.objectStore('meta').put({ key: key, value: value });
    });
  }

  function clearAll() {
    return run(['items', 'answers', 'meta'], 'readwrite', function (tx) {
      tx.objectStore('items').clear();
      tx.objectStore('answers').clear();
      tx.objectStore('meta').clear();
    });
  }

  function putBatch(rows) {
    return run(['items', 'answers'], 'readwrite', function (tx) {
      var items = tx.objectStore('items');
      var answers = tx.objectStore('answers');
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        items.put({ id: r.id, q: r.q, k: r.k, w: r.w });
        answers.put({ id: r.id, a: r.a });
      }
    });
  }

  function page(afterId, limit) {
    return run('items', 'readonly', function (tx, set) {
      var r = tx.objectStore('items').getAll(IDBKeyRange.lowerBound(afterId, true), limit);
      r.onsuccess = function () {
        var rows = r.result;
        var out = [];
        for (var i = 0; i < rows.length; i++) {
          out.push({ id: rows[i].id, q: rows[i].q });
        }
        set(out);
      };
    });
  }

  // हर शब्द की थोड़ी गिनती करके सबसे दुर्लभ शब्द से खोज शुरू होती है (तेज़ रहने के लिए)
  var SAMPLE = 400;

  function search(query, cap, scanCap) {
    var toks = normalize(query).split(' ').filter(Boolean);
    if (!toks.length) return Promise.resolve([]);
    return run('items', 'readonly', function (tx, set) {
      var out = [];
      set(out);
      var idx = tx.objectStore('items').index('w');
      var info = [];
      var pending = toks.length;

      function scan(probe) {
        var seen = Object.create(null);
        var scanned = 0;
        var c = idx.openCursor(IDBKeyRange.bound(probe, probe + '\uffff'));
        c.onsuccess = function () {
          var cur = c.result;
          if (!cur) return;
          var v = cur.value;
          scanned++;
          if (!seen[v.id]) {
            var ok = true;
            for (var j = 0; j < toks.length; j++) {
              if (v.k.indexOf(toks[j]) === -1) {
                ok = false;
                break;
              }
            }
            if (ok) {
              seen[v.id] = true;
              out.push({ id: v.id, q: v.q });
            }
          }
          if (out.length >= cap || scanned >= scanCap) return;
          cur.continue();
        };
      }

      function choose() {
        var best = null;
        var i;
        for (i = 0; i < info.length; i++) {
          if (info[i].full && (best === null || info[i].n < best.n)) best = info[i];
        }
        if (best === null) {
          best = info[0];
          for (i = 1; i < info.length; i++) {
            if (info[i].t.length > best.t.length) best = info[i];
          }
        }
        scan(best.t);
      }

      toks.forEach(function (t, ti) {
        var n = 0;
        var kc = idx.openKeyCursor(IDBKeyRange.bound(t, t + '\uffff'));
        kc.onsuccess = function () {
          var cur = kc.result;
          if (cur) n++;
          if (!cur || n >= SAMPLE) {
            info[ti] = { t: t, n: n, full: !cur };
            pending--;
            if (pending === 0) choose();
            return;
          }
          cur.continue();
        };
      });
    }).then(function (rows) {
      rows.sort(function (a, b) {
        return a.id - b.id;
      });
      return rows;
    });
  }

  function detail(id) {
    return run(['items', 'answers'], 'readonly', function (tx, set) {
      var a = tx.objectStore('items').get(id);
      var b = tx.objectStore('answers').get(id);
      b.onsuccess = function () {
        set(a.result && b.result ? { q: a.result.q, a: b.result.a } : null);
      };
    });
  }

  g.AvityDB = {
    open: open,
    normalize: normalize,
    words: words,
    getMeta: getMeta,
    setMeta: setMeta,
    clearAll: clearAll,
    putBatch: putBatch,
    page: page,
    search: search,
    detail: detail
  };
})(self);
