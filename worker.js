/* worker.js : डेटा को पर्दे के पीछे डेटाबेस में भरता है, ताकि स्क्रीन न अटके. */
'use strict';

importScripts('db.js');

var BATCH = 400;

function post(msg) {
  self.postMessage(msg);
}

self.onmessage = function (ev) {
  var d = ev.data || {};
  if (d.type !== 'import') return;
  runImport(d).then(
    function (r) {
      post({ type: 'done', count: r.count, skipped: r.skipped });
    },
    function (err) {
      post({ type: 'error', message: String((err && err.message) || err) });
    }
  );
};

async function readLines(res, onLine, onFraction) {
  if (!res.body || !res.body.getReader) {
    var text = await res.text();
    var all = text.split('\n');
    for (var i = 0; i < all.length; i++) {
      await onLine(all[i]);
    }
    return;
  }
  var total = res.headers.get('content-encoding') ? 0 : parseInt(res.headers.get('content-length') || '0', 10);
  var read = 0;
  var reader = res.body.getReader();
  var dec = new TextDecoder('utf-8');
  var buf = '';
  for (;;) {
    var r = await reader.read();
    if (r.done) break;
    read += r.value.length;
    if (total > 0) onFraction(Math.min(1, read / total));
    buf += dec.decode(r.value, { stream: true });
    var parts = buf.split('\n');
    buf = parts.pop();
    for (var p = 0; p < parts.length; p++) {
      await onLine(parts[p]);
    }
  }
  buf += dec.decode();
  if (buf) await onLine(buf);
}

async function runImport(d) {
  var files = d.files || [];
  var base = d.base || '';
  var counter = 0;
  var skipped = 0;
  var batch = [];
  var fileIndex = 0;
  var fraction = 0;

  function add(obj) {
    if (!obj || typeof obj.q !== 'string' || typeof obj.a !== 'string') {
      skipped++;
      return false;
    }
    var q = obj.q.trim();
    var k = AvityDB.normalize(q);
    if (!k) {
      skipped++;
      return false;
    }
    counter++;
    batch.push({ id: counter, q: q, a: obj.a, k: k, w: AvityDB.words(k) });
    return batch.length >= BATCH;
  }

  async function flush() {
    if (!batch.length) return;
    var rows = batch;
    batch = [];
    await AvityDB.putBatch(rows);
    post({ type: 'progress', count: counter, fileIndex: fileIndex, fileTotal: files.length, fraction: fraction });
  }

  async function onLine(line) {
    var s = line.trim();
    if (!s) return;
    var obj;
    try {
      obj = JSON.parse(s);
    } catch (e) {
      skipped++;
      return;
    }
    if (add(obj)) await flush();
  }

  await AvityDB.clearAll();

  for (fileIndex = 0; fileIndex < files.length; fileIndex++) {
    var name = files[fileIndex];
    var res = await fetch(base + name, { cache: 'no-cache' });
    if (!res.ok) throw new Error('फाइल नहीं मिली: ' + name);
    fraction = 0;
    if (/\.jsonl$/i.test(name)) {
      await readLines(res, onLine, function (f) {
        fraction = f;
      });
    } else {
      var arr = await res.json();
      if (!Array.isArray(arr)) throw new Error('फाइल में सूची [ ] होनी चाहिए: ' + name);
      for (var j = 0; j < arr.length; j++) {
        if (add(arr[j])) await flush();
      }
    }
    fraction = 1;
    await flush();
  }

  await AvityDB.setMeta('version', String(d.version));
  await AvityDB.setMeta('count', counter);
  return { count: counter, skipped: skipped };
      }
