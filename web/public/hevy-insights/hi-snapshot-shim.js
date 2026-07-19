/**
 * Phone/Vercel Hevy Insights bootstrap.
 * 1) Loads /mirror-snapshot.json
 * 2) Seeds localStorage CSV mode (same path as Hevy Insights offline import)
 * 3) Patches /api/hi/* as a fallback
 * Must finish before the Vue app boots (see index.html).
 */
(function () {
  'use strict';

  var SNAP_URL = '/mirror-snapshot.json';

  function loadSnap() {
    return fetch(SNAP_URL + '?_=' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error('snapshot ' + r.status);
      return r.json();
    });
  }

  function seedCsvMode(snap) {
    var workouts = Array.isArray(snap.hevy_workouts) ? snap.hevy_workouts : [];
    var status = snap.hevy_status || {};
    var username =
      status.username ||
      (workouts[0] && workouts[0].username) ||
      'local';

    // Hevy Insights treats this as authenticated without calling the API.
    localStorage.setItem('hevy_access_token', 'csv_mode');
    localStorage.setItem('data_source', 'csv');
    localStorage.setItem('csv_workouts', JSON.stringify(workouts));
    // Usman Biotracker default: pounds
    localStorage.setItem('weight_unit', 'lbs');

    // Helpful for UI bits that still peek at account-ish keys
    try {
      localStorage.setItem(
        'hi_snapshot_meta',
        JSON.stringify({
          username: username,
          workout_count: workouts.length,
          exported_at: snap.exported_at || null,
        })
      );
    } catch (e) {
      /* ignore quota on meta */
    }

    return { workouts: workouts, username: username, status: status };
  }

  function parseUrl(input) {
    try {
      return new URL(input, window.location.origin);
    } catch (e) {
      return null;
    }
  }

  function isHi(url) {
    return url && url.pathname.indexOf('/api/hi') === 0;
  }

  function paginateWorkouts(workouts, searchParams) {
    var offset = parseInt(searchParams.get('offset') || '0', 10);
    if (isNaN(offset) || offset < 0) offset = 0;
    // Match Vue free-mode page size of 5 so pagination terminates cleanly
    var limit = 5;
    return { workouts: workouts.slice(offset, offset + limit) };
  }

  function installApiFallback(ctx) {
    var workouts = ctx.workouts;
    var username = ctx.username;
    var status = ctx.status;

    function handleHi(method, url) {
      var path = url.pathname.replace(/\/+$/, '') || url.pathname;
      var sub = path.slice('/api/hi'.length) || '/';

      if (sub === '/auth/status' || sub === 'auth/status') {
        return Promise.resolve({
          authenticated: workouts.length > 0,
          auth_mode: workouts.length > 0 ? 'local_cache' : null,
        });
      }
      if (sub === '/user/account' || sub === 'user/account') {
        return Promise.resolve({
          username: username,
          email: (status && status.email) || '',
        });
      }
      if (sub === '/workouts' || sub === 'workouts') {
        return Promise.resolve(paginateWorkouts(workouts, url.searchParams));
      }
      if (sub === '/body_measurements' || sub === 'body_measurements') {
        return Promise.resolve([]);
      }
      if (sub === '/version/check' || sub === 'version/check') {
        return Promise.resolve({
          current_version: 'embedded',
          latest_version: 'embedded',
          update_available: false,
        });
      }
      if (method === 'POST') {
        return Promise.resolve({ message: 'ok', status: 'ok' });
      }
      return Promise.resolve({ detail: 'Not found: ' + sub });
    }

    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url =
        typeof input === 'string'
          ? parseUrl(input)
          : input && input.url
            ? parseUrl(input.url)
            : null;
      if (!isHi(url)) return origFetch(input, init);
      var method = (
        (init && init.method) ||
        (input && input.method) ||
        'GET'
      ).toUpperCase();
      return handleHi(method, url).then(function (data) {
        var statusCode =
          data && data.detail && String(data.detail).indexOf('Not found') === 0
            ? 404
            : 200;
        return new Response(JSON.stringify(data), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' },
        });
      });
    };

    var OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
      var xhr = new OrigXHR();
      var _method = 'GET';
      var _url = '';
      var open = xhr.open;
      xhr.open = function (method, url, async, user, password) {
        _method = (method || 'GET').toUpperCase();
        _url = url;
        return open.call(xhr, method, url, async !== false, user, password);
      };
      var send = xhr.send;
      xhr.send = function (body) {
        var parsed = parseUrl(_url);
        if (!isHi(parsed)) return send.call(xhr, body);

        var self = xhr;
        handleHi(_method, parsed)
          .then(function (data) {
            var statusCode =
              data &&
              data.detail &&
              String(data.detail).indexOf('Not found') === 0
                ? 404
                : 200;
            var text = JSON.stringify(data);

            Object.defineProperty(self, 'readyState', {
              configurable: true,
              get: function () {
                return 4;
              },
            });
            Object.defineProperty(self, 'status', {
              configurable: true,
              get: function () {
                return statusCode;
              },
            });
            Object.defineProperty(self, 'statusText', {
              configurable: true,
              get: function () {
                return 'OK';
              },
            });
            Object.defineProperty(self, 'responseText', {
              configurable: true,
              get: function () {
                return text;
              },
            });
            Object.defineProperty(self, 'response', {
              configurable: true,
              get: function () {
                return text;
              },
            });
            self.getAllResponseHeaders = function () {
              return 'content-type: application/json\r\n';
            };
            self.getResponseHeader = function (h) {
              if (String(h).toLowerCase() === 'content-type') {
                return 'application/json';
              }
              return null;
            };

            if (typeof self.onreadystatechange === 'function') {
              self.onreadystatechange();
            }
            if (typeof self.onload === 'function') self.onload();
            try {
              self.dispatchEvent(new Event('readystatechange'));
              self.dispatchEvent(new Event('load'));
              self.dispatchEvent(new Event('loadend'));
            } catch (e) {
              /* older browsers */
            }
          })
          .catch(function (err) {
            Object.defineProperty(self, 'readyState', {
              configurable: true,
              get: function () {
                return 4;
              },
            });
            Object.defineProperty(self, 'status', {
              configurable: true,
              get: function () {
                return 500;
              },
            });
            Object.defineProperty(self, 'responseText', {
              configurable: true,
              get: function () {
                return JSON.stringify({
                  detail: String(err && err.message ? err.message : err),
                });
              },
            });
            if (typeof self.onreadystatechange === 'function') {
              self.onreadystatechange();
            }
            if (typeof self.onerror === 'function') self.onerror();
            try {
              self.dispatchEvent(new Event('error'));
              self.dispatchEvent(new Event('loadend'));
            } catch (e) {
              /* ignore */
            }
          });
      };
      return xhr;
    }
    PatchedXHR.prototype = OrigXHR.prototype;
    PatchedXHR.UNSENT = 0;
    PatchedXHR.OPENED = 1;
    PatchedXHR.HEADERS_RECEIVED = 2;
    PatchedXHR.LOADING = 3;
    PatchedXHR.DONE = 4;
    window.XMLHttpRequest = PatchedXHR;
  }

  window.__HI_SNAPSHOT_READY__ = loadSnap()
    .then(function (snap) {
      var ctx = seedCsvMode(snap);
      installApiFallback(ctx);
      return ctx;
    })
    .catch(function (err) {
      console.error('[hi-snapshot-shim]', err);
      // Still install empty fallback so Vue can show login instead of hanging
      installApiFallback({ workouts: [], username: 'local', status: {} });
      throw err;
    });
})();
