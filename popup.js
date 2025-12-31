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
const STORAGE_KEY_WORKSPACES = 'tz_workspaces_v1';
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

function sanitizeWorkspaceName(name) {
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

function storageGetWorkspaces() {
  return storageGet(STORAGE_KEY_WORKSPACES).then(obj => obj[STORAGE_KEY_WORKSPACES] || {});
}

function storageSetWorkspaces(map) {
  return storageSet({ [STORAGE_KEY_WORKSPACES]: map || {} });
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
  msg.style.margin = '8px 0 0 0';
  msg.style.fontSize = '12px';
  msg.style.lineHeight = '1.3';
  msg.style.color = '#1a1a1a';
  msg.style.background = '#fff7e6';
  msg.style.border = '1px solid #f1d9a8';
  msg.style.borderRadius = '4px';
  msg.style.maxWidth = '320px';
  msg.style.wordBreak = 'break-word';

  // Insert directly under the toggle button (preferred UX).
  const btn = getToggleButton();
  if (btn && btn.parentNode) {
    if (btn.nextSibling) btn.parentNode.insertBefore(msg, btn.nextSibling);
    else btn.parentNode.appendChild(msg);
  } else {
    // Fallback: append to body
    document.body.appendChild(msg);
  }
  return msg;
}

function appendImportRow(ul) {
  const li = document.createElement('li');
  li.className = 'workspace-item import-row';

  const spacer = document.createElement('div');
  spacer.className = 'workspace-title';
  spacer.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'workspace-actions';

  const importBtn = document.createElement('button');
  importBtn.className = 'btn small';
  importBtn.textContent = 'Import';
  importBtn.addEventListener('click', () => {
    // TODO: implement import from JSON file
  });

  actions.appendChild(importBtn);
  li.appendChild(spacer);
  li.appendChild(actions);
  ul.appendChild(li);
}

function renderWorkspacesList(workspacesMap) {
  const ul = document.getElementById('workspacesList');
  if (!ul) return;

  ul.innerHTML = '';

  const names = Object.keys(workspacesMap || {}).sort((a, b) => a.localeCompare(b));
  if (!names.length) {
    const li = document.createElement('li');
    li.className = 'workspace-item empty';
    li.textContent = 'No workspaces saved yet.';
    ul.appendChild(li);
    appendImportRow(ul);
    return;
  }

  for (const name of names) {
    const li = document.createElement('li');
    li.className = 'workspace-item';

    const title = document.createElement('div');
    title.className = 'workspace-title';
    title.textContent = name;

    const actions = document.createElement('div');
    actions.className = 'workspace-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn small';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', async () => {
      // TODO: implement restore/apply workspace
    });

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn small';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        const payload = workspacesMap[name]?.payload || null;
        if (!payload) return;

        const filename = `bodhi-workspace_${escapeFilenamePart(name)}.json`;
        await runtimeSendMessage({ action: 'DOWNLOAD_JSON', filename, payload });
      } finally {
        exportBtn.disabled = false;
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn small danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete workspace "${name}"?`)) return;
      const cur = await storageGetWorkspaces();
      delete cur[name];
      await storageSetWorkspaces(cur);
      renderWorkspacesList(cur);
    });

    actions.appendChild(restoreBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(delBtn);

    li.appendChild(title);
    li.appendChild(actions);
    ul.appendChild(li);
  }

  appendImportRow(ul);
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

      // Workspaces UI (available even on restricted pages)
      const createBtn = document.getElementById('createWorkspace');
      if (createBtn) {
        createBtn.onclick = null;
        createBtn.addEventListener('click', async () => {
          const raw = prompt('Workspace name:');
          const workspaceName = sanitizeWorkspaceName(raw);
          if (!workspaceName) return;

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

            const workspaces = await storageGetWorkspaces();
            if (workspaces[workspaceName]) {
              const overwrite = confirm(`Workspace "${workspaceName}" already exists. Overwrite?`);
              if (!overwrite) return;
            }

            workspaces[workspaceName] = {
              name: workspaceName,
              createdAt: Date.now(),
              payload: exp.payload
            };

            await storageSetWorkspaces(workspaces);
            renderWorkspacesList(workspaces);

            // Finally: download the JSON using the workspace name
            const filename = `bodhi-workspace_${escapeFilenamePart(workspaceName)}.json`;
            await runtimeSendMessage({ action: 'DOWNLOAD_JSON', filename, payload: exp.payload });
          } finally {
            createBtn.disabled = false;
          }
        }, { once: false });
      }

      // Initial workspaces list render
      const workspaces = await storageGetWorkspaces();
      renderWorkspacesList(workspaces);

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
