/**
 * Same-origin Hevy Insights API shim for Vercel/phone.
 * Intercepts axios (XHR) + fetch for /api/hi/* and serves mirror-snapshot workouts.
 * Loaded before the Vue app in hevy-insights/index.html.
 */
(function () {
  'use strict';

  var SNAP_URL = '/mirror-snapshot.json';
  var snapPromise = null;
  var snap = null;

  function loadSnap() {
    if (snap) return Promise.resolve(snap);
    if (snapPromise) return snapPromise;
    snapPromise = fetch(SNAP_URL + '?_=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error('snapshot ' + r.status);
        return r.json();
      })
      .then(function (j) {
        snap = j;
        return snap;
      });
    return snapPromise;
  }

  function jsonResponse(data, status) {
    status = status || 200;
    return new Response(JSON.stringify(data), {
      status: status,
      headers: { 'Content-Type': 'application/json' },
    });
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
    var pageSize = parseInt(searchParams.get('page_size') || '5', 10);
    if (isNaN(pageSize) || pageSize < 1) pageSize = 5;
    var limit = Math.min(50, pageSize);
    var page = parseInt(searchParams.get('page') || '0', 10);
    if (offset === 0 && page > 1) {
      offset = (page - 1) * limit;
    }
    return { workouts: workouts.slice(offset, offset + limit) };
  }

  function handleHi(method, url) {
    var path = url.pathname.replace(/\/+$/, '') || url.pathname;
    var sub = path.slice('/api/hi'.length) || '/';

    return loadSnap().then(function (s) {
      var workouts = Array.isArray(s.hevy_workouts) ? s.hevy_workouts : [];
      var status = s.hevy_status || {};
      var hasData = workouts.length > 0 || status.has_local_data;

      if (sub === '/auth/status' || sub === 'auth/status') {
        return {
          authenticated: !!hasData,
          auth_mode: hasData ? 'local_cache' : null,
        };
      }
      if (sub === '/user/account' || sub === 'user/account') {
        return {
          username:
            status.username ||
            (workouts[0] && workouts[0].username) ||
            'local',
          email: status.email || '',
        };
      }
      if (sub === '/workouts' || sub === 'workouts') {
        return paginateWorkouts(workouts, url.searchParams);
      }
      if (sub === '/body_measurements' || sub === 'body_measurements') {
        return [];
      }
      if (sub === '/version/check' || sub === 'version/check') {
        return {
          current_version: 'embedded',
          latest_version: 'embedded',
          update_available: false,
        };
      }
      if (sub === '/health' || sub === 'health') {
        return { status: 'ok', mode: 'snapshot' };
      }
      if (method === 'POST') {
        return { message: 'ok', status: 'ok' };
      }
      return { detail: 'Not found in snapshot shim: ' + sub };
    });
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
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    return handleHi(method, url).then(function (data) {
      var status =
        data && data.detail && String(data.detail).indexOf('Not found') === 0
          ? 404
          : 200;
      return jsonResponse(data, status);
    });
  };

  var OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    var xhr = new OrigXHR();
    var _method = 'GET';
    var _url = '';
    var _async = true;
    var open = xhr.open;
    xhr.open = function (method, url, async, user, password) {
      _method = (method || 'GET').toUpperCase();
      _url = url;
      _async = async !== false;
      return open.call(xhr, method, url, _async, user, password);
    };
    var send = xhr.send;
    xhr.send = function (body) {
      var parsed = parseUrl(_url);
      if (!isHi(parsed)) {
        return send.call(xhr, body);
      }
      var self = xhr;
      handleHi(_method, parsed)
        .then(function (data) {
          var status =
            data && data.detail && String(data.detail).indexOf('Not found') === 0
              ? 404
              : 200;
          var text = JSON.stringify(data);
          Object.defineProperty(self, 'readyState', { configurable: true, get: function () { return 4; } });
          Object.defineProperty(self, 'status', { configurable: true, get: function () { return status; } });
          Object.defineProperty(self, 'statusText', { configurable: true, get: function () { return 'OK'; } });
          Object.defineProperty(self, 'responseText', { configurable: true, get: function () { return text; } });
          Object.defineProperty(self, 'response', { configurable: true, get: function () { return text; } });
          self.getAllResponseHeaders = function () {
            return 'content-type: application/json\r\n';
          };
          self.getResponseHeader = function (h) {
            if (String(h).toLowerCase() === 'content-type') return 'application/json';
            return null;
          };
          if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
          if (typeof self.onload === 'function') self.onload();
        })
        .catch(function (err) {
          Object.defineProperty(self, 'readyState', { configurable: true, get: function () { return 4; } });
          Object.defineProperty(self, 'status', { configurable: true, get: function () { return 500; } });
          Object.defineProperty(self, 'responseText', {
            configurable: true,
            get: function () {
              return JSON.stringify({ detail: String(err && err.message ? err.message : err) });
            },
          });
          if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
          if (typeof self.onerror === 'function') self.onerror();
        });
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  loadSnap().catch(function () {});
})();
