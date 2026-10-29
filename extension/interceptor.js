// interceptor.js - Roda no contexto principal (MAIN world) para capturar o tráfego do Power BI
(function() {
  if (window.__leopoldina_interceptor_loaded) return;
  window.__leopoldina_interceptor_loaded = true;

  console.log('[Leopoldina] Interceptor ativado no frame:', window.location.href);

  function despacharDados(payload, url) {
    try {
      window.dispatchEvent(new CustomEvent('LEOPOLDINA_PBI_INTERCEPT', {
        detail: {
          url: url || '',
          data: payload,
          timestamp: Date.now()
        }
      }));
    } catch (err) {
      console.warn('[Leopoldina] Erro ao despachar dados:', err);
    }
  }

  // Intercepta XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._pbiUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      try {
        const urlStr = String(this._pbiUrl || '').toLowerCase();
        if (urlStr.includes('querydata') || urlStr.includes('explore/reports') || urlStr.includes('analysis.windows.net') || urlStr.includes('executequeries')) {
          if (this.responseText && this.responseText.trim().startsWith('{')) {
            const parsed = JSON.parse(this.responseText);
            despacharDados(parsed, this._pbiUrl);
          }
        }
      } catch (e) {}
    });
    return originalSend.apply(this, arguments);
  };

  // Intercepta Fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const urlStr = String(args[0] || '').toLowerCase();
      if (urlStr.includes('querydata') || urlStr.includes('explore/reports') || urlStr.includes('analysis.windows.net') || urlStr.includes('executequeries')) {
        const clone = response.clone();
        clone.json().then(data => {
          despacharDados(data, urlStr);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };
})();
