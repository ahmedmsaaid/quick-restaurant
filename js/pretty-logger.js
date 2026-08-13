// Lightweight pretty logger for debugging in browser consoles
(function () {
  const cssBase = 'background:#111;color:#fff;padding:4px 8px;border-radius:4px;font-weight:700';
  const cssInfo = 'background:linear-gradient(90deg,#06b6d4,#7c3aed);color:#fff;padding:3px 8px;border-radius:4px';
  const cssWarn = 'background:orange;color:#111;padding:3px 8px;border-radius:4px';
  const cssErr = 'background:#ef4444;color:#fff;padding:3px 8px;border-radius:4px';

  function fmtLabel(level) {
    return `%c[APP] %c${level}`;
  }

  const Logger = {
    info: (...args) => console.log(fmtLabel('INFO'), cssBase, cssInfo, ...args),
    log: (...args) => console.log(fmtLabel('LOG'), cssBase, cssInfo, ...args),
    warn: (...args) => console.warn(fmtLabel('WARN'), cssBase, cssWarn, ...args),
    error: (...args) => console.error(fmtLabel('ERROR'), cssBase, cssErr, ...args),
    event: (name, payload) => console.log(fmtLabel('EVENT'), cssBase, cssInfo, name, payload),
    setRemote: (url) => { Logger._remote = url; Logger.info('Remote logging set to', url); },
    _remote: null
  };

  // expose global
  window.__prettyLogger = Logger;

  // capture global errors
  window.addEventListener('error', (ev) => {
    try { Logger.error('Uncaught error', ev.message || ev.error || ev); } catch (e) { }
  });

  window.addEventListener('unhandledrejection', (ev) => {
    try { Logger.error('UnhandledPromiseRejection', ev.reason); } catch (e) { }
  });

  // wrap fetch to log requests/responses
  if (window.fetch) {
    const _fetch = window.fetch;
    window.fetch = function (resource, init) {
      try { Logger.event('fetch.req', { resource, init }); } catch (e) { }
      return _fetch.apply(this, arguments).then(async (res) => {
        try {
          const clone = res.clone();
          let text = '';
          try { text = await clone.text(); } catch (e) { text = '[body unreadable]'; }
          Logger.event('fetch.res', { url: res.url, status: res.status, bodyPreview: text.slice(0, 512) });
        } catch (e) { Logger.warn('fetch logging failed', e); }
        return res;
      }).catch((err) => {
        Logger.error('fetch.error', err);
        throw err;
      });
    };
  }

  // simple XHR logging for legacy code
  (function () {
    const X = window.XMLHttpRequest;
    if (!X) return;
    function Wrapped() {
      const xhr = new X();
      const open = xhr.open;
      xhr.open = function (method, url) {
        this._log_method = method; this._log_url = url;
        return open.apply(this, arguments);
      };
      xhr.addEventListener('loadend', function () {
        try { Logger.event('xhr', { method: this._log_method, url: this._log_url, status: this.status }); } catch (e) { }
      });
      return xhr;
    }
    try { window.XMLHttpRequest = Wrapped; } catch (e) { }
  })();

})();
