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
const STORAGE_KEY_PRESETS = 'tz_presets_v1';
const PRESET_NAME_MAX_LEN = 60;

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

function sanitizePresetName(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.slice(0, PRESET_NAME_MAX_LEN);
}

function escapeFilenamePart(name) {
  // Keep it simple and cross-platform safe
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.+$/g, '')
    .slice(0, 80) || 'preset';
}

function storageGetPresets() {
  return storageGet(STORAGE_KEY_PRESETS).then(obj => obj[STORAGE_KEY_PRESETS] || {});
}

function storageSetPresets(map) {
  return storageSet({ [STORAGE_KEY_PRESETS]: map || {} });
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

function renderPresetsList(presetsMap) {
  const ul = document.getElementById('presetsList');
  if (!ul) return;

  ul.innerHTML = '';

  const names = Object.keys(presetsMap || {}).sort((a, b) => a.localeCompare(b));
  if (!names.length) {
    const li = document.createElement('li');
    li.className = 'preset-item empty';
    li.textContent = 'No presets saved yet.';
    ul.appendChild(li);
    return;
  }

  for (const name of names) {
    const li = document.createElement('li');
    li.className = 'preset-item';

    const title = document.createElement('div');
    title.className = 'preset-title';
    title.textContent = name;

    const actions = document.createElement('div');
    actions.className = 'preset-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn small';
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', async () => {
      downloadBtn.disabled = true;
      try {
        const payload = presetsMap[name]?.payload || null;
        if (!payload) return;

        const filename = `bodhi-preset_${escapeFilenamePart(name)}.json`;
        await runtimeSendMessage({ action: 'DOWNLOAD_JSON', filename, payload });
      } finally {
        downloadBtn.disabled = false;
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn small danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete preset "${name}"?`)) return;
      const cur = await storageGetPresets();
      delete cur[name];
      await storageSetPresets(cur);
      renderPresetsList(cur);
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(delBtn);

    li.appendChild(title);
    li.appendChild(actions);
    ul.appendChild(li);
  }
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

      // Presets UI (available even on restricted pages)
      const createBtn = document.getElementById('createPreset');
      if (createBtn) {
        createBtn.onclick = null;
        createBtn.addEventListener('click', async () => {
          const raw = prompt('Preset name:');
          const presetName = sanitizePresetName(raw);
          if (!presetName) return;

          createBtn.disabled = true;
          try {
            // Request the export payload (no download)
            const exp = await runtimeSendMessage({ action: 'GET_EXPORT_PAYLOAD' });
            if (!exp?.ok || !exp?.payload) {
              const m = showRestrictedMessage();
              m.textContent = exp?.error || 'Could not get export payload.';
              m.style.display = '';
              return;
            }

            const presets = await storageGetPresets();
            if (presets[presetName]) {
              const overwrite = confirm(`Preset "${presetName}" already exists. Overwrite?`);
              if (!overwrite) return;
            }

            presets[presetName] = {
              name: presetName,
              createdAt: Date.now(),
              payload: exp.payload
            };

            await storageSetPresets(presets);
            renderPresetsList(presets);

            // Finally: download the JSON using the preset name
            const filename = `bodhi-preset_${escapeFilenamePart(presetName)}.json`;
            await runtimeSendMessage({ action: 'DOWNLOAD_JSON', filename, payload: exp.payload });
          } finally {
            createBtn.disabled = false;
          }
        }, { once: false });
      }

      // Initial presets list render
      const presets = await storageGetPresets();
      renderPresetsList(presets);

      if (!tab || isRestrictedUrl(String(url || ''))) {
        // Restricted: keep a single disabled button + show message
        setButtonState({ text: 'Not available on this page', disabled: true });
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
