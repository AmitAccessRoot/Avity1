/* app.js : स्क्रीन, सूची, खोज, बैक बटन, पहली बार डेटा तैयार करना. */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // SETTINGS (सिर्फ यहीं बदलना है)
  // ---------------------------------------------------------------------
  var CFG = {
    title: 'दैनिक जीवन मार्गदर्शिका',
    searchHint: 'खोजें...',
    empty: 'अभी कोई विषय नहीं है।',
    noResult: 'कोई परिणाम नहीं मिला।',
    moreHint: 'और परिणाम हो सकते हैं। खोज में और शब्द जोड़ें।',
    notFound: 'यह विषय नहीं मिला।',
    loadError: 'डेटा लोड नहीं हो सका। data/files.json और डेटा फाइलें जांचें।',
    needNet: 'पहली बार ऐप खोलने के लिए इंटरनेट चाहिए।',
    preparing: 'डेटा तैयार हो रहा है…',
    pageSize: 60,
    searchCap: 300,
    searchScanCap: 60000,
    dataBase: 'data/',
    manifestFile: 'data/files.json'
  };

  // ---------------------------------------------------------------------

  function $(id) {
    return document.getElementById(id);
  }

  var bar = $('bar');
  var views = { home: $('homeScroll'), search: $('searchScroll'), item: $('itemScroll') };
  var homeList = $('homeList');
  var homeNote = $('homeNote');
  var searchList = $('searchList');
  var searchNote = $('searchNote');
  var searchMore = $('searchMore');
  var qInput = $('q');
  var btnClear = $('btnClear');
  var dTitle = $('dTitle');
  var dBody = $('dBody');
  var boot = $('boot');
  var bootSpin = $('bootSpin');
  var bootText = $('bootText');
  var bootBarWrap = $('bootBarWrap');
  var bootBar = $('bootBar');
  var bootCount = $('bootCount');
  var bootRetry = $('bootRetry');

  var current = null;
  var saved = { home: 0, search: 0, item: 0 };

  $('appTitle').textContent = CFG.title;
  qInput.placeholder = CFG.searchHint;

  // ---------------------------------------------------------------------
  // स्क्रीन बदलना
  // ---------------------------------------------------------------------
  function setView(name) {
    if (current) saved[current] = views[current].scrollTop;
    current = name;
    for (var k in views) {
      views[k].hidden = k !== name;
    }
    bar.setAttribute('data-mode', name);
    views[name].scrollTop = name === 'item' ? 0 : saved[name];
  }

  function showNote(el, text) {
    el.textContent = text;
    el.hidden = false;
  }

  function hideNote(el) {
    el.hidden = true;
    el.textContent = '';
  }

  function appendCards(parent, rows) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < rows.length; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.setAttribute('data-id', String(rows[i].id));
      var s = document.createElement('span');
      s.className = 'card-t';
      s.textContent = rows[i].q;
      b.appendChild(s);
      frag.appendChild(b);
    }
    parent.appendChild(frag);
  }

  function onCardClick(e) {
    var t = e.target;
    var b = t && t.closest ? t.closest('.card') : null;
    if (!b) return;
    var id = parseInt(b.getAttribute('data-id'), 10);
    if (id > 0) go('#/item/' + id);
  }

  // ---------------------------------------------------------------------
  // नेविगेशन: बैक बटन एक-एक कदम पीछे जाता है
  // ---------------------------------------------------------------------
  function go(hash) {
    try {
      history.pushState({ inApp: true }, '', hash);
    } catch (e) {
      location.hash = hash;
      return;
    }
    route();
  }

  function goBack() {
    if (history.state && history.state.inApp) {
      history.back();
      return;
    }
    try {
      history.replaceState(null, '', '#/');
    } catch (e) {
      location.hash = '#/';
      return;
    }
    route();
  }

  function route() {
    var h = location.hash || '';
    var m = /^#\/item\/(\d+)$/.exec(h);
    if (m) {
      showItem(parseInt(m[1], 10));
    } else if (h === '#/search') {
      showSearch();
    } else {
      showHome();
    }
  }

  // ---------------------------------------------------------------------
  // होम सूची (60-60 करके लोड होती है)
  // ---------------------------------------------------------------------
  var home = { lastId: 0, loading: false, done: false };
  var ticking = false;

  function loadHome() {
    if (home.loading || home.done) return Promise.resolve();
    home.loading = true;
    return AvityDB.page(home.lastId, CFG.pageSize)
      .then(function (rows) {
        if (rows.length) {
          appendCards(homeList, rows);
          home.lastId = rows[rows.length - 1].id;
        }
        if (rows.length < CFG.pageSize) home.done = true;
        if (home.done && !homeList.firstChild) showNote(homeNote, CFG.empty);
      })
      .catch(function () {
        home.done = true;
        if (!homeList.firstChild) showNote(homeNote, CFG.loadError);
      })
      .then(function () {
        home.loading = false;
        checkHomeFill();
      });
  }

  function checkHomeFill() {
    if (home.done || current !== 'home') return;
    var sc = views.home;
    if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 1200) loadHome();
  }

  function onHomeScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      checkHomeFill();
    });
  }

  function showHome() {
    if (searchActive) {
      searchActive = false;
      resetSearch();
    }
    setView('home');
    checkHomeFill();
  }

  // ---------------------------------------------------------------------
  // खोज
  // ---------------------------------------------------------------------
  var searchActive = false;
  var searchSeq = 0;
  var searchTimer = 0;

  function resetSearch() {
    searchSeq++;
    clearTimeout(searchTimer);
    qInput.value = '';
    searchList.textContent = '';
    hideNote(searchNote);
    hideNote(searchMore);
    btnClear.hidden = true;
  }

  function onSearchInput() {
    var v = qInput.value;
    btnClear.hidden = !v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      runSearch(v);
    }, 200);
  }

  function runSearch(v) {
    var q = v.trim();
    var seq = ++searchSeq;
    if (!q) {
      searchList.textContent = '';
      hideNote(searchNote);
      hideNote(searchMore);
      return;
    }
    AvityDB.search(q, CFG.searchCap, CFG.searchScanCap)
      .then(function (rows) {
        if (seq !== searchSeq) return;
        searchList.textContent = '';
        views.search.scrollTop = 0;
        if (!rows.length) {
          showNote(searchNote, CFG.noResult);
          hideNote(searchMore);
          return;
        }
        hideNote(searchNote);
        appendCards(searchList, rows);
        if (rows.length >= CFG.searchCap) showNote(searchMore, CFG.moreHint);
        else hideNote(searchMore);
      })
      .catch(function () {
        if (seq === searchSeq) showNote(searchNote, CFG.loadError);
      });
  }

  function showSearch() {
    var first = !searchActive;
    searchActive = true;
    setView('search');
    if (first) resetSearch();
    if (!qInput.value) {
      setTimeout(function () {
        qInput.focus();
      }, 0);
    }
  }

  // ---------------------------------------------------------------------
  // अंदर का पेज
  // ---------------------------------------------------------------------
  var itemSeq = 0;

  function showItem(id) {
    setView('item');
    var seq = ++itemSeq;
    dTitle.textContent = '';
    dBody.textContent = '';
    AvityDB.detail(id)
      .then(function (d) {
        if (seq !== itemSeq) return;
        if (!d) {
          dBody.textContent = CFG.notFound;
          return;
        }
        dTitle.textContent = d.q;
        dBody.textContent = d.a;
      })
      .catch(function () {
        if (seq === itemSeq) dBody.textContent = CFG.loadError;
      });
  }

  // ---------------------------------------------------------------------
  // पहली बार डेटा तैयार करना
  // ---------------------------------------------------------------------
  var manifestError = '';

  function formatNum(n) {
    try {
      return Number(n).toLocaleString('en-IN');
    } catch (e) {
      return String(n);
    }
  }

  function showBoot(text) {
    bootSpin.hidden = false;
    bootText.textContent = text;
    bootBarWrap.hidden = true;
    bootCount.textContent = '';
    bootRetry.hidden = true;
    boot.hidden = false;
  }

  function setProgress(i, n, f, count) {
    bootBarWrap.hidden = false;
    var p = n > 0 ? (i + (f || 0)) / n : 0;
    bootBar.style.width = Math.max(2, Math.min(100, Math.round(p * 100))) + '%';
    bootCount.textContent = formatNum(count) + ' विषय तैयार';
  }

  function showFatal(msg) {
    bootSpin.hidden = true;
    bootText.textContent = msg;
    bootBarWrap.hidden = true;
    bootCount.textContent = '';
    bootRetry.hidden = false;
    boot.hidden = false;
  }

  function validateManifest(j) {
    if (!j || typeof j !== 'object' || !Array.isArray(j.files) || j.version === undefined || j.version === null) {
      throw new Error('data/files.json में "version" और "files" चाहिए।');
    }
    for (var i = 0; i < j.files.length; i++) {
      var f = j.files[i];
      if (typeof f !== 'string' || !/^[A-Za-z0-9._\-]+$/.test(f) || f.indexOf('..') !== -1) {
        throw new Error('data/files.json में फाइल का नाम गलत है।');
      }
    }
    return j;
  }

  function fetchManifest() {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctl) ctl.abort();
    }, 7000);
    return fetch(CFG.manifestFile, { cache: 'no-cache', signal: ctl ? ctl.signal : undefined }).then(
      function (res) {
        clearTimeout(timer);
        if (!res.ok) return null;
        return res
          .json()
          .then(function (j) {
            return validateManifest(j);
          })
          .catch(function (e) {
            manifestError = e && e.message ? e.message : CFG.loadError;
            return null;
          });
      },
      function () {
        clearTimeout(timer);
        return null;
      }
    );
  }

  function importData(man) {
    return new Promise(function (resolve, reject) {
      var w;
      try {
        w = new Worker('worker.js');
      } catch (e) {
        reject(e);
        return;
      }
      showBoot(CFG.preparing);
      w.onmessage = function (ev) {
        var d = ev.data || {};
        if (d.type === 'progress') {
          setProgress(d.fileIndex, d.fileTotal, d.fraction, d.count);
        } else if (d.type === 'done') {
          w.terminate();
          resolve(d);
        } else if (d.type === 'error') {
          w.terminate();
          reject(new Error(d.message || CFG.loadError));
        }
      };
      w.onerror = function () {
        w.terminate();
        reject(new Error(CFG.loadError));
      };
      w.postMessage({
        type: 'import',
        base: CFG.dataBase,
        files: man.files,
        version: String(man.version)
      });
    });
  }

  function prepareData() {
    return Promise.all([AvityDB.getMeta('version'), fetchManifest()]).then(function (r) {
      var stored = r[0];
      var man = r[1];
      var has = stored !== undefined && stored !== null;
      if (!man) {
        if (!has) throw new Error(manifestError || CFG.needNet);
        return null;
      }
      if (has && String(man.version) === String(stored)) return null;
      return importData(man);
    });
  }

  // ---------------------------------------------------------------------
  // शुरुआत
  // ---------------------------------------------------------------------
  function startApp() {
    boot.hidden = true;
    route();
    loadHome();
  }

  function bindEvents() {
    homeList.addEventListener('click', onCardClick);
    searchList.addEventListener('click', onCardClick);
    views.home.addEventListener('scroll', onHomeScroll, { passive: true });
    $('btnSearch').addEventListener('click', function () {
      go('#/search');
    });
    $('btnBackS').addEventListener('click', goBack);
    $('btnBackI').addEventListener('click', goBack);
    btnClear.addEventListener('click', function () {
      qInput.value = '';
      onSearchInput();
      qInput.focus();
    });
    qInput.addEventListener('input', onSearchInput);
    qInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') qInput.blur();
    });
    bootRetry.addEventListener('click', function () {
      location.reload();
    });
    window.addEventListener('popstate', route);
    window.addEventListener('unhandledrejection', function (e) {
      e.preventDefault();
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  function main() {
    bindEvents();
    registerSW();
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(function () {});
      }
    } catch (e) {}
    AvityDB.open()
      .then(prepareData)
      .then(startApp)
      .catch(function (err) {
        showFatal(err && err.message ? err.message : CFG.loadError);
      });
  }

  main();
})();
