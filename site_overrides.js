/*
 site_overrides.js
 Per-site CSS patches only. Injected by background.js into all frames.
*/

(() => {
  function ensureStyleTag(key) {
    const head = document.head || document.documentElement;
    if (!head) return null;

    const attr = 'data-tz-site-overrides';
    const existing = head.querySelector(`style[${attr}="${key}"]`);
    if (existing) return existing;

    const st = document.createElement('style');
    st.setAttribute(attr, key);
    head.appendChild(st);
    return st;
  }

  function addCss(key, cssText) {
    const css = String(cssText || '').trim();
    if (!css) return;
    const st = ensureStyleTag(key);
    if (!st) return;

    // Idempotent: if already applied, do nothing.
    if (st.textContent && st.textContent.includes(css)) return;

    st.textContent = (st.textContent ? (st.textContent + '\n') : '') + css + '\n';
  }

  function hostIs(host, suffix) {
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  const host = String(location.hostname || '');
  const path = String(location.pathname || '');

  // ---- YouTube: avoid masthead collision by forcing transform-based offset ----
  if (hostIs(host, 'youtube.com')) {
    addCss('youtube.com', `
      /* Bodhi Bar site override: YouTube masthead */
      #masthead-container{
        transform: translateY(var(--tz-h, 0px)) !important;
        will-change: transform !important;
      }
    `);
  }

  // ---- Google Sheets: ensure bottom safe area doesn't get clipped by grid container ----
  // Previously this was done by selecting a "safe bottom container" in JS.
  // Now we apply a CSS padding-bottom patch to the known container.
  if (host === 'docs.google.com' && path.includes('/spreadsheets/')) {
    addCss('docs.google.com/spreadsheets', `
      /* Bodhi Bar site override: Google Sheets bottom clipper */
      #0-grid-container{
        padding-bottom: min(var(--tz-h, 0px), 48px) !important;
        box-sizing: border-box !important;
      }
    `);
  }
})();
