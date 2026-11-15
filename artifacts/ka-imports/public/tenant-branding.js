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

  function isMainStoreBrand(data) {
    var flag = String((data && data.is_main_store) || "").trim().toLowerCase();
    if (flag === "1" || flag === "true" || flag === "yes" || flag === "on") return true;
    if (flag === "0" || flag === "false" || flag === "no" || flag === "off") return false;
    var tenantId = String((data && data.tenant_id) || "").trim();
    if (tenantId) return tenantId === "tenant_loja1";
    return host === "ka-imports.com" || host === "www.ka-imports.com";
  }

  function upsertLink(rel, attrs) {
    var selector = 'link[rel="' + rel + '"]';
    if (attrs.sizes) selector += '[sizes="' + attrs.sizes + '"]';
    else if (rel === "icon") selector += ":not([sizes])";
    var link = document.head.querySelector(selector);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    Object.keys(attrs).forEach(function (key) {
      link.setAttribute(key, attrs[key]);
    });
    link.setAttribute("data-store-icon", "ka");
  }

  function applyMainStoreIcons() {
    upsertLink("icon", { type: "image/svg+xml", href: "/brand/ka/favicon.svg" });
    upsertLink("icon", { type: "image/png", sizes: "32x32", href: "/brand/ka/favicon-32.png" });
    upsertLink("apple-touch-icon", { sizes: "180x180", href: "/brand/ka/apple-touch-icon.png" });
    upsertLink("manifest", { href: "/brand/ka/manifest.webmanifest" });
  }

  function applyBranchIcons() {
    var extra = document.head.querySelectorAll('link[data-store-icon="ka"]');
    for (var i = 0; i < extra.length; i++) extra[i].parentNode.removeChild(extra[i]);
    var icon = document.head.querySelector('link[rel="icon"]:not([sizes])');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.setAttribute("type", "image/svg+xml");
    icon.setAttribute("href", "/favicon.svg");
  }

  function applyMainStoreShareImage(data) {
    if (!isMainStoreBrand(data)) return;
    var saved = String((data && data.logo) || "").trim();
    var image = saved || (window.location.origin + "/brand/ka/og.png");
    upsertMeta("property", "og:image", image);
    upsertMeta("name", "twitter:image", image);
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
    if (isMainStoreBrand(cached)) {
      applyMainStoreIcons();
      if (cached && cached.site_name) applyBranding(cached.site_name);
      applyMainStoreShareImage(cached);
    } else if (isMainStoreHost(host) && cached && cached.site_name) {
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
      if (isMainStoreBrand(result.data)) applyMainStoreIcons();
      else applyBranchIcons();
      applyMainStoreShareImage(result.data);
    })
    .catch(function () {
      // ignore fetch errors
    });
})();
