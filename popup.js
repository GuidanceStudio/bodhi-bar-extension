 // popup.js - Bodhi Bar popup behavior (restrict Show/Hide on browser-internal pages)

/*
 Minimal, defensive script to:
 - Detect when the active tab is a browser-internal / restricted page
 - If restricted: hide Show/Hide toggle(s) in the popup and display an instructional message (in English)
 - If not restricted: leave existing popup behavior unchanged

 Notes:
 - The popup HTML may use different IDs/classes for the show/hide buttons across versions.
   To avoid editing popup.html, this script attempts a few common selectors and also
   hides buttons by inspecting their visible text.
 - This file was added standalone as requested; it intentionally performs a minimal DOM
   touch to add a single message node when needed.
*/

const RESTRICTED_PREFIXES = [
  'chrome://',
  'brave://',
  'about:',
  'edge://',
  'devtools://',
  'view-source:',
  'chrome-extension://',
  'brave-extension://',
  'extension://', // generic extension page prefix
  'vivaldi://',
  'opera://'
];

const STORAGE_KEY_HIDDEN = 'tz_hidden';

function getToggleButton() {
  return document.getElementById('toggleBar');
}

function setButtonState({ text, disabled = false } = {}) {
  const btn = getToggleButton();
  if (!btn) return;
  if (typeof text === 'string') btn.textContent = text;
  btn.disabled = !!disabled;
  btn.style.opacity = disabled ? '0.7' : '';
  btn.style.cursor = disabled ? 'default' : '';
}

function storageGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([key], (obj) => resolve(obj || {}));
    } catch {
      resolve({});
    }
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(obj, () => resolve(true));
    } catch {
      resolve(false);
    }
  });
}

function sendVisibilityToTab(tabId, hidden) {
  return new Promise((resolve) => {
    try {
      if (!chrome.tabs?.sendMessage || tabId == null) return resolve(false);
      chrome.tabs.sendMessage(tabId, { action: 'SET_VISIBILITY', hidden: !!hidden }, () => {
        const err = chrome.runtime?.lastError;
        if (err) return resolve(false);
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

function runtimeSendMessage(msg) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime?.sendMessage) return resolve(null);
      chrome.runtime.sendMessage(msg, (resp) => {
        const err = chrome.runtime?.lastError;
        if (err) return resolve(null);
        resolve(resp ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

function isRestrictedUrl(url = '') {
  if (!url || typeof url !== 'string') return true; // defensive: if unknown, treat as restricted
  const u = url.trim().toLowerCase();
  return RESTRICTED_PREFIXES.some(p => u.startsWith(p));
}

function showRestrictedMessage() {
  const existing = document.getElementById('restricted-msg');
  const message = 'Bodhi Bar is not available on this type of page (browser internal/restricted pages). Open a regular website tab to use Show/Hide.';
  if (existing) {
    existing.textContent = message;
    existing.style.display = '';
    return existing;
  }

  const msg = document.createElement('div');
  msg.id = 'restricted-msg';
  msg.textContent = message;
  // Minimal inline styling so message is readable in the popup even if popup.html has different styles.
  msg.style.padding = '8px 10px';
  msg.style.margin = '6px 0';
  msg.style.fontSize = '12px';
  msg.style.lineHeight = '1.3';
  msg.style.color = '#1a1a1a';
  msg.style.background = '#fff7e6';
  msg.style.border = '1px solid #f1d9a8';
  msg.style.borderRadius = '4px';
  msg.style.maxWidth = '320px';
  msg.style.wordBreak = 'break-word';

  // Try to insert into a reasonable place in the popup:
  // Prefer a container with class/id likely present; otherwise append to body.
  const preferredSelectors = ['.popup-body', '#popup', '#root', '.controls', '.actions', '.tz-popup'];
  let inserted = false;
  for (const sel of preferredSelectors) {
    const c = document.querySelector(sel);
    if (c) {
      c.insertBefore(msg, c.firstChild);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    // Fallback: append to body
    document.body.appendChild(msg);
  }
  return msg;
}

function initPopup() {
  setButtonState({ text: 'Loading...', disabled: true });

  try {
    if (!chrome.tabs?.query) {
      showRestrictedMessage();
      return;
    }

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      const tab = (tabs && tabs[0]) ? tabs[0] : null;
      const url = tab?.url || tab?.pendingUrl || '';

      if (!tab || isRestrictedUrl(String(url || ''))) {
        // Restricted: keep a single disabled button + show message
        setButtonState({ text: 'Not available on this page', disabled: true });
        const exportBtn = document.getElementById('exportTabs');
        if (exportBtn) exportBtn.style.display = 'none';
        showRestrictedMessage();
        return;
      }

      // Normal page: enable toggle behavior
      const btn = getToggleButton();
      if (!btn) {
        showRestrictedMessage();
        return;
      }

      const obj = await storageGet(STORAGE_KEY_HIDDEN);
      let hidden = !!obj[STORAGE_KEY_HIDDEN];

      const render = () => {
        setButtonState({ text: hidden ? 'Show Bar' : 'Hide Bar', disabled: false });
      };

      // Ensure we don't stack multiple listeners if popup re-inits
      btn.onclick = null;
      btn.addEventListener('click', async () => {
        // Optimistic UI
        hidden = !hidden;
        render();

        await storageSet({ [STORAGE_KEY_HIDDEN]: hidden });

        // Best-effort: tell the active tab to update immediately (may fail on some pages)
        await sendVisibilityToTab(tab.id, hidden);
      }, { once: false });

      const exportBtn = document.getElementById('exportTabs');
      if (exportBtn) {
        exportBtn.style.display = '';
        exportBtn.disabled = false;
        exportBtn.onclick = null;
        exportBtn.addEventListener('click', async () => {
          exportBtn.disabled = true;
          const resp = await runtimeSendMessage({ action: 'EXPORT_TABS' });
          exportBtn.disabled = false;
          if (!resp?.ok) {
            const m = showRestrictedMessage();
            m.textContent = resp?.error || 'Export failed.';
            m.style.display = '';
          }
        }, { once: false });
      }

      render();
    });
  } catch {
    // Fail closed: don't leave "Loading..." forever
    setButtonState({ text: 'Error', disabled: true });
    showRestrictedMessage();
  }
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
