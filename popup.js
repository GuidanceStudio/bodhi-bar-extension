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

const STORAGE_KEY_HIDDEN_BY_TAB = 'tz_hidden_by_tab';
const STORAGE_KEY_WORKSPACES = 'tz_workspaces_v1';
const STORAGE_KEY_HIDDEN_SITES = 'tz_default_hidden_sites';
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

function promptForUniqueWorkspaceName(initialName, workspaces, promptText) {
  const ws = workspaces || {};
  const base = sanitizeWorkspaceName(initialName);

  let name = base;
  if (!name) {
    name = sanitizeWorkspaceName(prompt(promptText || 'Workspace name:'));
  }
  if (!name) return '';

  while (ws[name]) {
    const next = prompt(`Workspace "${name}" already exists. Enter a new name:`);
    if (!next) return '';
    name = sanitizeWorkspaceName(next);
    if (!name) return '';
  }
  return name;
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

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeImportedWorkspaceJson(raw) {
  // Expected export format:
  // { name: string, payload: { pinnedTabs: [{url}], allTabGroups: [{title,color,tabs:[{url}]}] } }
  if (!isPlainObject(raw)) return { ok: false, error: 'Invalid JSON: expected an object.' };

  const version = raw.wv || '1.0';
  // Supported versions
  const SUPPORTED_VERSIONS = ['1.0'];
  if (!SUPPORTED_VERSIONS.includes(version)) {
    return { 
      ok: false, 
      error: `Unsupported workspace version: ${version}. Please update the extension.` 
    };
  }
  const payload = raw.payload;
  if (!isPlainObject(payload)) return { ok: false, error: 'Invalid workspace file: missing "payload" object.' };

  const pinnedTabs = payload.pinnedTabs;
  const allTabGroups = payload.allTabGroups;

  if (pinnedTabs != null && !Array.isArray(pinnedTabs)) {
    return { ok: false, error: 'Invalid payload: "pinnedTabs" must be an array.' };
  }
  if (allTabGroups != null && !Array.isArray(allTabGroups)) {
    return { ok: false, error: 'Invalid payload: "allTabGroups" must be an array.' };
  }

  const name = (typeof raw.name === 'string') ? sanitizeWorkspaceName(raw.name) : '';
  return { ok: true, name, payload };
}

function deriveWorkspaceNameFromFilename(filename) {
  const base = String(filename || '').trim();
  if (!base) return '';
  const noExt = base.replace(/\.[^.]+$/, '');
  const stripped = noExt.replace(/^bodhi-workspace[_-]*/i, '');
  return sanitizeWorkspaceName(stripped || noExt);
}

function storageGetHiddenByTab() {
  return storageGet(STORAGE_KEY_HIDDEN_BY_TAB).then(obj => {
    const map = obj?.[STORAGE_KEY_HIDDEN_BY_TAB];
    return (map && typeof map === 'object') ? map : {};
  });
}

function storageSetHiddenByTab(map) {
  return storageSet({ [STORAGE_KEY_HIDDEN_BY_TAB]: map || {} });
}

function storageGetWorkspaces() {
  return storageGet(STORAGE_KEY_WORKSPACES).then(obj => obj[STORAGE_KEY_WORKSPACES] || {});
}

function storageSetWorkspaces(map) {
  return storageSet({ [STORAGE_KEY_WORKSPACES]: map || {} });
}

function storageGetHiddenSites() {
  return storageGet(STORAGE_KEY_HIDDEN_SITES).then(obj => obj[STORAGE_KEY_HIDDEN_SITES] || []);
}

function storageSetHiddenSites(list) {
  return storageSet({ [STORAGE_KEY_HIDDEN_SITES]: list || [] });
}

function renderHiddenSitesList() {
  const ul = document.getElementById('hiddenSitesList');
  if (!ul) return;

  storageGetHiddenSites().then(sites => {
    ul.innerHTML = '';

    if (!sites.length) {
      const li = document.createElement('li');
      li.className = 'workspace-item empty';
      li.textContent = 'No hidden sites configured.';
      ul.appendChild(li);
      return;
    }

    sites.forEach(site => {
      const li = document.createElement('li');
      li.className = 'workspace-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'workspace-title';
      nameSpan.textContent = site;
      nameSpan.style.wordBreak = 'break-all';

      const actions = document.createElement('div');
      actions.className = 'workspace-actions';

      const delIcon = document.createElement('span');
      delIcon.className = 'workspace-action-icon delete';
      delIcon.innerHTML = '&#128465;'; // 🗑️
      delIcon.title = 'Remove';
      delIcon.style.cursor = 'pointer';
      delIcon.onclick = async () => {
        const updated = sites.filter(s => s !== site);
        await storageSetHiddenSites(updated);
        renderHiddenSitesList();
      };

      actions.appendChild(delIcon);
      li.appendChild(nameSpan);
      li.appendChild(actions);
      ul.appendChild(li);
    });
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

function showToggleMessage(text) {
  const id = 'toggle-msg';
  const message = String(text || '').trim();
  if (!message) return null;

  const existing = document.getElementById(id);
  if (existing) {
    existing.textContent = message;
    existing.style.display = '';
    return existing;
  }

  const msg = document.createElement('div');
  msg.id = id;
  msg.textContent = message;

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

  const btn = getToggleButton();
  if (btn && btn.parentNode) {
    if (btn.nextSibling) btn.parentNode.insertBefore(msg, btn.nextSibling);
    else btn.parentNode.appendChild(msg);
  } else {
    document.body.appendChild(msg);
  }
  return msg;
}

function showWorkspacesMessage(text, isSuccess = false) {
  const id = 'workspaces-msg';
  const message = String(text || '').trim();
  if (!message) return null;

  const existing = document.getElementById(id);
  if (existing) {
    existing.textContent = message;
    existing.className = isSuccess ? 'success' : '';
    existing.style.display = '';
    return existing;
  }

  const msg = document.createElement('div');
  msg.id = id;
  msg.textContent = message;

  if (isSuccess) {
    msg.style.color = '#166534';
    msg.style.background = '#dcfce7';
    msg.style.border = '1px solid #86efac';
  } else {
    msg.style.color = '#1a1a1a';
    msg.style.background = '#fff7e6';
    msg.style.border = '1px solid #f1d9a8';
  }
  msg.style.padding = '8px 10px';
  msg.style.margin = '8px 0 0 0';
  msg.style.fontSize = '12px';
  msg.style.lineHeight = '1.3';
  msg.style.borderRadius = '4px';
  msg.style.wordBreak = 'break-word';

  const section = document.getElementById('workspaces-section');
  const note = document.getElementById('workspaces-note');
  if (section) {
    if (note && note.parentNode === section) section.insertBefore(msg, note);
    else section.appendChild(msg);
  } else {
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
  importBtn.style.marginLeft = '8px';
  importBtn.addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';

    const cleanup = () => {
      try { input.remove(); } catch {}
    };

    input.addEventListener('change', async () => {
      try {
        const file = input.files && input.files[0] ? input.files[0] : null;
        if (!file) return;

        importBtn.disabled = true;

        const text = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onerror = () => reject(new Error('Could not read file.'));
          r.onload = () => resolve(String(r.result || ''));
          r.readAsText(file);
        });

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          alert('Invalid JSON file.');
          return;
        }

        const norm = normalizeImportedWorkspaceJson(parsed);
        if (!norm.ok) {
          alert(norm.error || 'Invalid workspace file.');
          return;
        }

        // Determine name: JSON name > filename-derived > prompt
        let name = norm.name;
        if (!name) name = deriveWorkspaceNameFromFilename(file.name);
        if (!name) {
          const raw = prompt('Workspace name:');
          name = sanitizeWorkspaceName(raw);
        }
        if (!name) return;

        const workspaces = await storageGetWorkspaces();
        let finalName = name;

        if (workspaces[finalName]) {
          // Ask for a new name
          const newName = sanitizeWorkspaceName(prompt(`A workspace named "${finalName}" already exists. Enter a different name to import:`));
          if (!newName) {
            showWorkspacesMessage('Import cancelled.');
            return;
          }

          // Check if the new name also exists
          while (workspaces[newName]) {
            alert(`A workspace named "${newName}" already exists. Please choose a different name.`);
            const again = sanitizeWorkspaceName(prompt(`Enter a different name to import:`));
            if (!again) {
              showWorkspacesMessage('Import cancelled.');
              return;
            }
            finalName = again;
          }
          finalName = newName;
        }

        workspaces[finalName] = {
          name: finalName,
          createdAt: Date.now(),
          payload: norm.payload
        };

        await storageSetWorkspaces(workspaces);
        renderWorkspacesList(workspaces);
        showWorkspacesMessage(`Imported workspace "${finalName}".`, true);
      } catch (e) {
        alert('Import failed: ' + String(e?.message || 'Unknown error'));
      } finally {
        importBtn.disabled = false;
        cleanup();
      }
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  });

  actions.appendChild(importBtn);
  li.appendChild(spacer);
  li.appendChild(actions);
  ul.appendChild(li);
}

function renderWorkspacesList(workspacesMap) {
  const ul = document.getElementById('workspacesList');
  if (!ul) return;

  const msg = document.getElementById('workspaces-msg');
  if (msg) msg.style.display = 'none';

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

    // Workspace name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'workspace-title';
    nameSpan.textContent = name;
    nameSpan.title = name;

    // Actions container
    const actions = document.createElement('div');
    actions.className = 'workspace-actions';
    actions.style.display = 'flex';
    actions.style.gap = '4px';
    actions.style.alignItems = 'center';

    const restoreIcon = document.createElement('span');
    restoreIcon.className = 'workspace-action-icon restore';
    restoreIcon.innerHTML = '&#128260;'; // 🔄
    restoreIcon.title = 'Restore';
    restoreIcon.addEventListener('click', async () => {
      const payload = workspacesMap[name]?.payload;
      if (!payload) return;

      const confirmed = confirm('This will close all current tabs and groups and replace them with the workspace tabs. Continue?');
      if (!confirmed) return;

      restoreIcon.style.opacity = '0.5';
      try {
        const res = await runtimeSendMessage({ action: 'APPLY_WORKSPACE', payload });
        if (!res?.ok) {
          showWorkspacesMessage(res?.error || 'Restore failed.');
        } else {
          window.close();
        }
      } finally {
        restoreIcon.style.opacity = '1';
      }
    });

    const renameIcon = document.createElement('span');
    renameIcon.className = 'workspace-action-icon rename';
    renameIcon.innerHTML = '&#9997;'; // ✏️
    renameIcon.title = 'Rename';
    renameIcon.addEventListener('click', async () => {
      const oldName = name;
      const cur = await storageGetWorkspaces();
      const existing = cur[oldName];
      if (!existing) {
        alert('Workspace not found (it may have been deleted).');
        return;
      }

      let newName = sanitizeWorkspaceName(prompt(`Rename workspace "${oldName}" to:`));
      if (!newName) return;

      while (newName !== oldName && cur[newName]) {
        alert(`A workspace named "${newName}" already exists. Please choose a different name.`);
        newName = sanitizeWorkspaceName(prompt(`Rename workspace "${oldName}" to:`));
        if (!newName) return;
      }

      if (newName === oldName) return;

      delete cur[oldName];
      cur[newName] = { ...existing, name: newName };

      await storageSetWorkspaces(cur);
      renderWorkspacesList(cur);
      showWorkspacesMessage(`Renamed workspace to "${newName}".`);
    });

    const exportIcon = document.createElement('span');
    exportIcon.className = 'workspace-action-icon export';
    exportIcon.innerHTML = '&#128228;'; // 📤
    exportIcon.title = 'Export';
    exportIcon.addEventListener('click', async () => {
      exportIcon.style.opacity = '0.5';
      try {
        const payload = workspacesMap[name]?.payload || null;
        if (!payload) return;

        const filename = `bodhi-workspace_${escapeFilenamePart(name)}.json`;
        const exportObj = { wv: '1.0', name, payload };
        const res = await runtimeSendMessage({ action: 'DOWNLOAD_JSON', filename, payload: exportObj });
        if (!res?.ok) {
          showWorkspacesMessage(res?.error || 'Export failed.');
        }
      } finally {
        exportIcon.style.opacity = '1';
      }
    });

    const delIcon = document.createElement('span');
    delIcon.className = 'workspace-action-icon delete';
    delIcon.innerHTML = '&#128465;'; // 🗑️
    delIcon.title = 'Delete';
    delIcon.addEventListener('click', async () => {
      if (!confirm(`Delete workspace "${name}"?`)) return;
      const cur = await storageGetWorkspaces();
      delete cur[name];
      await storageSetWorkspaces(cur);
      renderWorkspacesList(cur);
    });

    actions.appendChild(restoreIcon);
    actions.appendChild(renameIcon);
    actions.appendChild(exportIcon);
    actions.appendChild(delIcon);

    li.appendChild(nameSpan);
    li.appendChild(actions);
    ul.appendChild(li);
  }

  appendImportRow(ul);
}


function initPopup() {
  setButtonState({ text: 'Loading...', disabled: true });

  try {
    if (!chrome.tabs?.query) {
      showToggleMessage('Bodhi Bar is not available on this type of page (browser internal/restricted pages). Open a regular website tab to use Show/Hide.');
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
              showWorkspacesMessage(exp?.error || 'Could not get export payload.');
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
        setButtonState({ text: 'Bar not available on this page', disabled: true });
        showToggleMessage('Bodhi Bar is not available on this type of page (browser internal/restricted pages). Open a regular website tab to use Show/Hide.');
        return;
      }

      // Normal page: enable toggle behavior
      const btn = getToggleButton();
      if (!btn) {
        showToggleMessage('Bodhi Bar is not available on this type of page (browser internal/restricted pages). Open a regular website tab to use Show/Hide.');
        return;
      }

      const tabId = tab.id;

      const hiddenByTab = await storageGetHiddenByTab();
      let hidden = !!hiddenByTab[String(tabId)];

      const render = () => {
        setButtonState({ text: hidden ? 'Show Bar' : 'Hide Bar', disabled: false });
      };

      btn.onclick = null;
      btn.addEventListener('click', async () => {
        hidden = !hidden;
        render();

        const map = await storageGetHiddenByTab();
        map[String(tabId)] = hidden;
        await storageSetHiddenByTab(map);

        await sendVisibilityToTab(tabId, hidden);
      }, { once: false });

      render();

      // --- START: Hidden Sites Logic ---

      const hideCurrentBtn = document.getElementById('hideCurrentSiteBtn');
      const addHiddenBtn = document.getElementById('addHiddenSiteBtn');
      const newHiddenInput = document.getElementById('newHiddenSiteInput');

      if (hideCurrentBtn) {
        hideCurrentBtn.onclick = async () => {
          if (!tab || !tab.url) return;
          let siteToAdd = '';
          try {
            // Use hostname for cleaner list (e.g. "github.com")
            siteToAdd = new URL(tab.url).hostname;
          } catch { 
            // Fallback to full URL if parsing fails
            siteToAdd = tab.url; 
          }

          if (!siteToAdd) return;

          const sites = await storageGetHiddenSites();
          if (!sites.includes(siteToAdd)) {
            sites.push(siteToAdd);
            await storageSetHiddenSites(sites);
            renderHiddenSitesList();
          } else {
            alert('This site is already in the hidden list.');
          }
        };
      }

      if (addHiddenBtn && newHiddenInput) {
        addHiddenBtn.onclick = async () => {
          const val = newHiddenInput.value.trim();
          if (!val) return;

          const sites = await storageGetHiddenSites();
          if (!sites.includes(val)) {
            sites.push(val);
            await storageSetHiddenSites(sites);
            newHiddenInput.value = '';
            renderHiddenSitesList();
          } else {
            alert('This site is already in the hidden list.');
          }
        };
      }

      // Initial render of the hidden sites list
      renderHiddenSitesList();

      // --- END: Hidden Sites Logic ---
    });
  } catch {
    // Fail closed: don't leave "Loading..." forever
    setButtonState({ text: 'Error', disabled: true });
    showToggleMessage('Bodhi Bar is not available on this type of page (browser internal/restricted pages). Open a regular website tab to use Show/Hide.');
  }
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
