/* sw.js : ऐप की फाइलें फोन में सेव करता है, ताकि बिना इंटरनेट के चले. */
'use strict';

// कोड वाली फाइलें बदलने पर चाहें तो इस नाम का नंबर बढ़ा दें (v1 -> v2)
var CACHE = 'avity-shell-v1';

var CORE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'db.js',
  'worker.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(function (c) {
        return c.addAll(CORE);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== CACHE;
            })
            .map(function (k) {
              return caches.delete(k);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function networkFirst(req) {
  return fetch(req)
    .then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) {
          c.put(req, copy);
        });
      }
      return res;
    })
    .catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || Response.error();
      });
    });
}

function staleWhileRevalidate(e) {
  var req = e.request;
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req)
        .then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(function () {
          return null;
        });
      if (hit) {
        e.waitUntil(net);
        return hit;
      }
      return net.then(function (res) {
        if (res) return res;
        if (req.mode === 'navigate') return cache.match('index.html');
        return Response.error();
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // डेटा फाइलें कैश नहीं होतीं (वे डेटाबेस में रहती हैं). सिर्फ files.json.
  if (url.pathname.indexOf('/data/') !== -1) {
    if (/\/data\/files\.json$/.test(url.pathname)) {
      e.respondWith(networkFirst(req));
    }
    return;
  }

  e.respondWith(staleWhileRevalidate(e));
});
