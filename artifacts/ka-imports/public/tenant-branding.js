(function () {
  var host = window.location && window.location.hostname ? window.location.hostname : "";
  if (!host) return;

  function isMainStoreHost(value) {
    var name = String(value || "").trim().toLowerCase();
    if (!name) return false;
    if (name === "localhost" || name === "127.0.0.1" || name === "::1") return true;
    if (name === "vercel.app" || name.endsWith(".vercel.app")) return true;
    if (name === "ondigitalocean.app" || name.endsWith(".ondigitalocean.app")) return true;
    return name === "ka-imports.com" || name === "www.ka-imports.com";
  }

  document.title = isMainStoreHost(host) ? "KA Imports" : "Loja";

  function upsertMeta(attr, key, content) {
    var selector = 'meta[' + attr + '="' + key + '"]';
    var meta = document.head.querySelector(selector);
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute(attr, key);
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', content);
  }

  function applyBranding(siteName) {
    var normalized = String(siteName || '').trim();
    if (!normalized) return;
    document.title = normalized;
    var description = 'Confira os produtos da loja ' + normalized + '.';
    upsertMeta('name', 'description', description);
    upsertMeta('property', 'og:title', normalized);
    upsertMeta('property', 'og:site_name', normalized);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', window.location.href);
    upsertMeta('name', 'twitter:title', normalized);
    upsertMeta('name', 'twitter:description', description);
  }

  try {
    var cached = JSON.parse(localStorage.getItem('siteSettings') || '{}');
    if (isMainStoreHost(host) && cached && cached.site_name) {
      applyBranding(cached.site_name);
    }
  } catch (_err) {
    // ignore cache parse errors
  }

  // Manter em sincronia com src/lib/maintenance.ts.
  // Para desligar: MAINTENANCE_MODE = false aqui E MAINTENANCE_MODE_DEFAULT = false lá, depois redeploy.
  var MAINTENANCE_MODE = false;
  if (MAINTENANCE_MODE) return;

  var url = '/api/settings?domain=' + encodeURIComponent(host);
  fetch(url, { cache: 'no-store' })
    .then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, data: data };
      }).catch(function () {
        return null;
      });
    })
    .then(function (result) {
      if (!result || !result.data || typeof result.data !== 'object') return;
      if (result.data.store_not_configured === true || result.data.error === 'store_not_configured') {
        try {
          localStorage.removeItem('siteSettings');
        } catch (_err) {
          // ignore storage errors
        }
        var path = window.location.pathname || "";
        var isAdmin = path === "/admin" || path.indexOf("/admin/") === 0;
        if (!isAdmin) document.title = "Loja em configuração";
        return;
      }
      if (!result.ok) return;
      try {
        localStorage.setItem('siteSettings', JSON.stringify(result.data));
      } catch (_err) {
        // ignore storage errors
      }
      applyBranding(result.data.site_name || (isMainStoreHost(host) ? 'KA Imports' : 'Loja'));
    })
    .catch(function () {
      // ignore fetch errors
    });
})();
