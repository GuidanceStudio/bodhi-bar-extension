/*
 site_overrides.js
 Per-site CSS patches.
 Fetches overrides from storage and applies them ONLY if visibility mode is PUSH.
*/

(async () => {
  const STORAGE_KEY_OVERRIDES = 'tz_site_overrides';
  const STORAGE_KEY_MODE = 'tz_visibility_mode';
  const STORAGE_KEY_RULES = 'tz_visibility_rules';
  const VISIBILITY_MODES = { PUSH: 'push', OVERLAY: 'overlay', HIDDEN: 'hidden' };

  // Helper: Get storage
  const getStorage = (keys) => new Promise(r => chrome.storage.local.get(keys, r));

  // Helper: Get Tab ID
  const getTabId = () => new Promise(r => chrome.runtime.sendMessage({ action: 'GET_TAB_ID' }, res => r(res?.tabId)));

  // Helper: Glob matcher
  function globToRegex(glob) {
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const pattern = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${pattern}$`, 'i');
  }

  // Helper: Inject/Remove CSS
  const updateStyle = (css) => {
    const id = 'bodhi-site-override';
    let st = document.getElementById(id);
    if (!css) {
      if (st) st.remove();
      return;
    }
    if (!st) {
      st = document.createElement('style');
      st.id = id;
      (document.head || document.documentElement).appendChild(st);
    }
    if (st.textContent !== css) st.textContent = css;
  };

  const apply = async () => {
    const data = await getStorage([STORAGE_KEY_OVERRIDES, STORAGE_KEY_MODE, STORAGE_KEY_RULES]);
    
    const hostname = location.hostname;
    const overrides = data[STORAGE_KEY_OVERRIDES] || {};
    const css = overrides[hostname];

    if (!css) {
      updateStyle(null);
      return;
    }

    // Determine Mode
    let mode = null;

    // 1. Explicit Tab Override
    try {
      const tabId = await getTabId();
      if (tabId) {
        const tabModes = data[STORAGE_KEY_MODE] || {};
        if (tabModes[tabId]) {
          mode = tabModes[tabId];
        }
      }
    } catch (e) { /* ignore */ }

    // 2. Rules (only if no explicit override)
    if (!mode) {
      const rules = data[STORAGE_KEY_RULES] || [];
      const url = location.href;
      const matches = rules.filter(r => globToRegex(r.pattern).test(url));
      matches.sort((a, b) => b.pattern.length - a.pattern.length);
      if (matches.length > 0) {
        mode = matches[0].mode;
      }
    }

    // 3. Default
    if (!mode) {
      mode = VISIBILITY_MODES.PUSH;
    }

    // 3. Apply only if PUSH
    if (mode === VISIBILITY_MODES.PUSH) {
      updateStyle(css);
    } else {
      updateStyle(null);
    }
  };

  // Initial run
  apply();

  // Listen for changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes[STORAGE_KEY_OVERRIDES] || changes[STORAGE_KEY_MODE] || changes[STORAGE_KEY_RULES]) {
        apply();
      }
    }
  });
  
  // Listen for direct messages (e.g. from popup toggles)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'REFRESH_BAR' || msg.action === 'SET_VISIBILITY_MODE') {
      apply();
    }
  });
})();
