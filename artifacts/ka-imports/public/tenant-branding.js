(function () {
  var host = window.location && window.location.hostname ? window.location.hostname : "";
  if (!host) return;

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
    if (cached && cached.site_name) {
      applyBranding(cached.site_name);
    }
  } catch (_err) {
    // ignore cache parse errors
  }

  var url = '/api/settings?domain=' + encodeURIComponent(host);
  fetch(url, { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) return null;
      return response.json();
    })
    .then(function (data) {
      if (!data || typeof data !== 'object') return;
      try {
        localStorage.setItem('siteSettings', JSON.stringify(data));
      } catch (_err) {
        // ignore storage errors
      }
      applyBranding(data.site_name);
    })
    .catch(function () {
      // ignore fetch errors
    });
})();
