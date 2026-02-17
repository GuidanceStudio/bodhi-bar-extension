 // popup.js - Bodhi Bar popup behavior
// Shared constants loaded from constants.js via <script> tag in popup.html

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
  if (!isPlainObject(raw)) return { ok: false, error: 'Invalid JSON: expected an object.' };

  const version = raw.wv || '1.0';
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
  const siteOverrides = payload.siteOverrides; // Optional

  if (pinnedTabs != null && !Array.isArray(pinnedTabs)) {
    return { ok: false, error: 'Invalid payload: "pinnedTabs" must be an array.' };
  }
  if (allTabGroups != null && !Array.isArray(allTabGroups)) {
    return { ok: false, error: 'Invalid payload: "allTabGroups" must be an array.' };
  }
  if (siteOverrides != null && !isPlainObject(siteOverrides)) {
    return { ok: false, error: 'Invalid payload: "siteOverrides" must be an object.' };
  }
  
  const visibilityRules = payload.visibilityRules; // Optional
  if (visibilityRules != null && !Array.isArray(visibilityRules)) {
    return { ok: false, error: 'Invalid payload: "visibilityRules" must be an array.' };
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

function storageGetWorkspaces() {
  return storageGet(STORAGE_KEY_WORKSPACES).then(obj => obj[STORAGE_KEY_WORKSPACES] || {});
}

function storageSetWorkspaces(map) {
  return storageSet({ [STORAGE_KEY_WORKSPACES]: map || {} });
}



async function migrateHiddenSitesToRules() {
  const oldData = await storageGet('tz_default_hidden_sites');
  const oldSites = oldData?.['tz_default_hidden_sites'] || [];
  
  if (oldSites.length > 0) {
    const rules = oldSites.map(site => ({ pattern: site, mode: VISIBILITY_MODES.HIDDEN }));
    await storageSet({ [STORAGE_KEY_VISIBILITY_RULES]: rules });
    await chrome.storage.local.remove('tz_default_hidden_sites');
    console.log('Bodhi Bar: Migrated hidden sites to visibility rules.');
  }
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

// isSystemPage and globToRegex are now imported from constants.js

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function getMatchingRule(url) {
  if (!url) return null;
  const data = await storageGet(STORAGE_KEY_VISIBILITY_RULES);
  const rules = data?.[STORAGE_KEY_VISIBILITY_RULES] || [];
  const matches = rules.filter(r => globToRegex(r.pattern).test(url));
  matches.sort((a, b) => b.pattern.length - a.pattern.length);
  return matches[0] || null;
}

async function saveRule(oldPattern, newPattern, mode) {
  const data = await storageGet(STORAGE_KEY_VISIBILITY_RULES);
  let rules = data?.[STORAGE_KEY_VISIBILITY_RULES] || [];
  if (oldPattern) {
    rules = rules.filter(r => r.pattern !== oldPattern);
  }
  if (newPattern) {
    rules = rules.filter(r => r.pattern !== newPattern);
    rules.push({ pattern: newPattern, mode });
  }
  await storageSet({ [STORAGE_KEY_VISIBILITY_RULES]: rules });
}

function applyMessageStyle(el, type) {
  // Reset classi
  el.className = 'msg-box';

  // Aggiunge classe specifica per il tipo
  
  if (type === 'success') {
    el.classList.add('msg-success');
  } else if (type === 'error') {
    el.classList.add('msg-error');
  } else {
    el.classList.add('msg-info');
  }
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
  applyMessageStyle(msg, 'info');
  msg.style.maxWidth = '320px';

  const select = document.getElementById('visibilityModeSelect');
  if (select && select.parentNode) {
    if (select.nextSibling) select.parentNode.insertBefore(msg, select.nextSibling);
    else select.parentNode.appendChild(msg);
  } else {
    document.body.appendChild(msg);
  }
  return msg;
}

function showInlineMessage(text, isSuccess) {
  const msg = document.createElement('div');
  msg.textContent = text;
  applyMessageStyle(msg, isSuccess ? 'success' : 'error');
  
  const container = document.getElementById('importContainer');
  if (container) {
    container.appendChild(msg);
    setTimeout(() => msg.remove(), 5000);
  }
}

function showNameInputForm(onSubmit) {
  const container = document.getElementById('importContainer');
  if (!container) return;
  
  container.innerHTML = '';
  
  const label = document.createElement('div');
  label.textContent = 'Workspace Name:';
  label.className = 'control-group label';
  
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'std-input';
  input.style.width = '100%';
  input.style.marginBottom = '8px';
  
  const buttonRow = document.createElement('div');
  buttonRow.className = 'rule-actions';
  buttonRow.style.justifyContent = 'flex-start';
  
  const save = document.createElement('button');
  save.textContent = 'Save';
  save.className = 'btn small success';
  save.onclick = () => {
    const name = sanitizeWorkspaceName(input.value);
    if (!name) {
      showInlineMessage('Please enter a name.', false);
      return;
    }
    onSubmit(name);
  };
  
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.className = 'btn small';
  cancel.onclick = () => {
    container.innerHTML = '';
    const btn = document.createElement('button');
    btn.textContent = 'Select JSON File...';
    btn.className = 'btn';
    btn.style.fontSize = '16px';
    btn.style.padding = '10px 20px';
    btn.onclick = handleImportFile;
    container.appendChild(btn);
  };
  
  buttonRow.appendChild(save);
  buttonRow.appendChild(cancel);
  
  container.appendChild(label);
  container.appendChild(input);
  container.appendChild(buttonRow);
  
  input.focus();
}

async function finishImport(name, payload, file) {
  const workspaces = await storageGetWorkspaces();
  let finalName = name;
  
  if (workspaces[finalName]) {
    // Show inline form for conflict resolution
    showConflictResolution(finalName, workspaces, payload);
    return;
  }
  
  workspaces[finalName] = {
    name: finalName,
    createdAt: Date.now(),
    payload
  };
  
  await storageSetWorkspaces(workspaces);
  showInlineMessage(`Imported workspace "${finalName}".`, true);
  setTimeout(() => window.close(), 1500);
}

function showConflictResolution(name, workspaces, payload) {
  const container = document.getElementById('importContainer');
  if (!container) return;
  
  container.innerHTML = '';
  
  const msg = document.createElement('div');
  msg.textContent = `A workspace named "${name}" already exists.`;
  applyMessageStyle(msg, 'error');
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = name;
  input.className = 'std-input';
  input.style.width = '100%';
  input.style.marginBottom = '8px';
  
  const buttonRow = document.createElement('div');
  buttonRow.className = 'rule-actions';
  buttonRow.style.justifyContent = 'flex-start';
  
  const overwrite = document.createElement('button');
  overwrite.textContent = 'Overwrite';
  overwrite.className = 'btn small';
  overwrite.onclick = async () => {
    workspaces[name] = {
      name,
      createdAt: Date.now(),
      payload
    };
    await storageSetWorkspaces(workspaces);
    showInlineMessage(`Overwrote "${name}".`, true);
    setTimeout(() => window.close(), 1500);
  };
  
  const rename = document.createElement('button');
  rename.textContent = 'Rename';
  rename.className = 'btn small success';
  rename.onclick = async () => {
    const newName = sanitizeWorkspaceName(input.value);
    if (!newName) {
      showInlineMessage('Please enter a new name.', false);
      return;
    }
    if (workspaces[newName]) {
      showInlineMessage(`"${newName}" already exists.`, false);
      return;
    }
    workspaces[newName] = {
      name: newName,
      createdAt: Date.now(),
      payload
    };
    await storageSetWorkspaces(workspaces);
    showInlineMessage(`Imported as "${newName}".`, true);
    setTimeout(() => window.close(), 1500);
  };
  
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.className = 'btn small';
  cancel.onclick = () => {
    container.innerHTML = '';
    const btn = document.createElement('button');
    btn.textContent = 'Select JSON File...';
    btn.className = 'btn';
    btn.style.fontSize = '16px';
    btn.style.padding = '10px 20px';
    btn.onclick = handleImportFile;
    container.appendChild(btn);
  };
  
  buttonRow.appendChild(overwrite);
  buttonRow.appendChild(rename);
  buttonRow.appendChild(cancel);
  
  container.appendChild(msg);
  container.appendChild(input);
  container.appendChild(buttonRow);
  
  input.focus();
}

function showWorkspacesMessage(text, status = 'info') {
  const id = 'workspaces-msg';
  const message = String(text || '').trim();
  if (!message) return null;

  // Map status: true -> success, 'error' -> error, else -> info
  let type = 'info';
  if (status === true || status === 'success') type = 'success';
  else if (status === 'error') type = 'error';

  const existing = document.getElementById(id);
  if (existing) {
    existing.textContent = message;
    applyMessageStyle(existing, type);
    existing.style.display = '';
    return existing;
  }

  const msg = document.createElement('div');
  msg.id = id;
  msg.textContent = message;
  applyMessageStyle(msg, type);

  const section = document.getElementById('workspaces-section');
  const note = document.getElementById('workspaces-note');
  if (section) {
    if (note && note.parentNode === section) section.insertBefore(msg, note);
    else section.appendChild(msg);
  } else {
    document.body.appendChild(msg);
  }

  // Ensure the message is visible
  msg.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return msg;
}

function handleImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.position = 'absolute';
  input.style.left = '-9999px';
  input.style.top = '0';
  input.style.opacity = '0';

  const cleanup = () => {
    try { input.remove(); } catch {}
  };

  input.addEventListener('change', async () => {
    try {
      const file = input.files && input.files[0] ? input.files[0] : null;
      if (!file) return;

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
        showInlineMessage('Invalid JSON file.', false);
        return;
      }

      const norm = normalizeImportedWorkspaceJson(parsed);
      if (!norm.ok) {
        showInlineMessage(norm.error || 'Invalid workspace file.', false);
        return;
      }

      let name = norm.name;
      if (!name) name = deriveWorkspaceNameFromFilename(file.name);
      if (!name) {
        // Show inline name input form
        showNameInputForm((enteredName) => {
          if (!enteredName) return;
          finishImport(enteredName, norm.payload, file);
        });
        return;
      }

      const workspaces = await storageGetWorkspaces();
      let finalName = name;

      if (workspaces[finalName]) {
        // Show conflict resolution inline
        showConflictResolution(finalName, workspaces, norm.payload);
        return;
      }

      workspaces[finalName] = {
        name: finalName,
        createdAt: Date.now(),
        payload: norm.payload
      };

      await storageSetWorkspaces(workspaces);
      showInlineMessage(`Imported workspace "${finalName}".`, true);
      setTimeout(() => window.close(), 1500);
    } catch (e) {
      showInlineMessage('Import failed: ' + String(e?.message || 'Unknown error'), false);
    } finally {
      cleanup();
    }
  }, { once: true });

  document.body.appendChild(input);
  input.click();
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
  importBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mode=import') });
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

    const nameSpan = document.createElement('span');
    nameSpan.className = 'workspace-title';
    nameSpan.textContent = name;
    nameSpan.title = name;

    const actions = document.createElement('div');
    actions.className = 'workspace-actions';
    actions.style.display = 'flex';
    actions.style.gap = '4px';
    actions.style.alignItems = 'center';

    // Helper for inline confirmation to avoid native dialogs
    const withConfirmation = (btn, text, onConfirm) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Hide all action buttons
        const children = Array.from(actions.children);
        children.forEach(c => c.style.display = 'none');

        const confirmDiv = document.createElement('div');
        confirmDiv.className = 'rule-actions';
        confirmDiv.style.gap = '4px';
        
        const label = document.createElement('span');
        label.textContent = text;
        label.style.fontSize = '11px';
        label.style.fontWeight = 'bold';
        label.style.color = '#f87171'; // Red from CSS

        const yes = document.createElement('button');
        yes.textContent = 'Yes';
        yes.className = 'btn small';
        yes.style.padding = '2px 6px';
        yes.style.fontSize = '10px';
        yes.style.minWidth = 'auto';
        yes.style.background = '#f87171';
        yes.style.color = '#fff';
        
        const no = document.createElement('button');
        no.textContent = 'No';
        no.className = 'btn small';
        no.style.padding = '2px 6px';
        no.style.fontSize = '10px';
        no.style.minWidth = 'auto';

        yes.onclick = async (ev) => {
          ev.stopPropagation();
          confirmDiv.remove();
          await onConfirm();
        };

        no.onclick = (ev) => {
          ev.stopPropagation();
          confirmDiv.remove();
          children.forEach(c => c.style.display = '');
        };

        confirmDiv.appendChild(label);
        confirmDiv.appendChild(yes);
        confirmDiv.appendChild(no);
        actions.appendChild(confirmDiv);
      });
    };

    const restoreIcon = document.createElement('span');
    restoreIcon.className = 'workspace-action-icon restore';
    restoreIcon.innerHTML = '&#128260;';
    restoreIcon.title = 'Restore';
    
    withConfirmation(restoreIcon, 'Restore?', async () => {
      const payload = workspacesMap[name]?.payload;
      if (!payload) return;

      showWorkspacesMessage('Restoring workspace...');
      try {
        if (payload.siteOverrides) {
          const currentOverrides = await storageGet(STORAGE_KEY_OVERRIDES);
          const merged = { ...(currentOverrides?.[STORAGE_KEY_OVERRIDES] || {}), ...payload.siteOverrides };
          await storageSet({ [STORAGE_KEY_OVERRIDES]: merged });
        }

        const res = await runtimeSendMessage({ action: 'APPLY_WORKSPACE', payload });
        if (!res?.ok) {
          showWorkspacesMessage(res?.error || 'Restore failed.', 'error');
          // Restore buttons if failed
          Array.from(actions.children).forEach(c => {
             if (c.classList.contains('workspace-action-icon')) c.style.display = '';
          });
        } else {
          showWorkspacesMessage('Workspace restored!', true);
          setTimeout(() => window.close(), 1000);
        }
      } catch (e) {
        showWorkspacesMessage('Error: ' + e.message, 'error');
      }
    });

    const renameIcon = document.createElement('span');
    renameIcon.className = 'workspace-action-icon rename';
    renameIcon.innerHTML = '&#9997;';
    renameIcon.title = 'Rename';
    renameIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Hide display elements
      nameSpan.style.display = 'none';
      actions.style.display = 'none';

      // Create edit UI
      const editContainer = document.createElement('div');
      editContainer.className = 'rule-actions';
      editContainer.style.flex = '1';
      editContainer.style.width = '100%';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = name;
      input.className = 'std-input';
      input.style.flex = '1';
      input.style.minWidth = '0';

      const save = document.createElement('button');
      save.innerHTML = '&#10003;'; // Checkmark
      save.className = 'btn-icon success';

      const cancel = document.createElement('button');
      cancel.innerHTML = '&#10005;'; // X
      cancel.className = 'btn-icon';

      const cleanup = () => {
        editContainer.remove();
        nameSpan.style.display = '';
        actions.style.display = 'flex';
      };

      cancel.onclick = (ev) => {
        ev.stopPropagation();
        cleanup();
      };

      save.onclick = async (ev) => {
        ev.stopPropagation();
        const newName = sanitizeWorkspaceName(input.value);
        if (!newName) {
           cleanup();
           return;
        }
        
        if (newName === name) {
          cleanup();
          return;
        }

        const cur = await storageGetWorkspaces();
        if (cur[newName]) {
          showWorkspacesMessage(`Name "${newName}" already exists.`, 'error');
          return;
        }

        const existing = cur[name];
        if (!existing) {
           showWorkspacesMessage('Original workspace missing.', 'error');
           renderWorkspacesList(cur);
           return;
        }

        delete cur[name];
        cur[newName] = { ...existing, name: newName };
        await storageSetWorkspaces(cur);
        renderWorkspacesList(cur);
        showWorkspacesMessage(`Renamed to "${newName}".`);
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') save.click();
        if (ev.key === 'Escape') cancel.click();
        ev.stopPropagation();
      });

      editContainer.appendChild(input);
      editContainer.appendChild(save);
      editContainer.appendChild(cancel);
      
      li.insertBefore(editContainer, actions);
      input.focus();
    });

    const exportIcon = document.createElement('span');
    exportIcon.className = 'workspace-action-icon export';
    exportIcon.innerHTML = '&#128228;';
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
          showWorkspacesMessage(res?.error || 'Export failed.', 'error');
        }
      } finally {
        exportIcon.style.opacity = '1';
      }
    });

    const delIcon = document.createElement('span');
    delIcon.className = 'workspace-action-icon delete';
    delIcon.innerHTML = '&#128465;';
    delIcon.title = 'Delete';
    
    withConfirmation(delIcon, 'Delete?', async () => {
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
  if (window.location.search.includes('mode=import')) {
    document.body.innerHTML = '';
    document.body.style.padding = '40px';
    document.body.style.textAlign = 'center';
    document.body.style.width = '100%';
    document.body.style.height = '100vh';
    
    const h2 = document.createElement('h2');
    h2.textContent = 'Import Workspace';
    h2.style.marginBottom = '20px';
    
    const btn = document.createElement('button');
    btn.textContent = 'Select JSON File...';
    btn.className = 'btn';
    btn.style.fontSize = '16px';
    btn.style.padding = '10px 20px';
    btn.onclick = handleImportFile;

    const container = document.createElement('div');
    container.id = 'importContainer';
    container.style.marginTop = '20px';
    container.style.width = '100%';
    container.style.maxWidth = '400px';
    container.style.marginLeft = 'auto';
    container.style.marginRight = 'auto';

    document.body.appendChild(h2);
    document.body.appendChild(btn);
    document.body.appendChild(container);
    return;
  }

  const select = document.getElementById('visibilityModeSelect');
  if (!select) return;

  select.disabled = true;
  select.value = 'push';

  try {
    if (!chrome.tabs?.query) {
      showToggleMessage('Bodhi Bar is not available on this page.');
      return;
    }

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      const tab = (tabs && tabs[0]) ? tabs[0] : null;
      const url = tab?.url || tab?.pendingUrl || '';
      const hostname = getHostname(url);
      const tabId = tab?.id;

      // --- Workspaces Init ---
      const createBtn = document.getElementById('createWorkspace');
      const titleRow = document.querySelector('.workspaces-title-row');

      // Helper to reset UI to default button
      const resetSaveUI = () => {
        const form = document.getElementById('save-workspace-form');
        if (form) form.remove();
        createBtn.style.display = '';
      };

      // Helper to perform the actual save operation
      const executeSave = async (name, workspaces) => {
        createBtn.disabled = true;
        try {
          const exp = await runtimeSendMessage({ action: 'GET_EXPORT_PAYLOAD' });
          if (!exp?.ok || !exp?.payload) {
            showWorkspacesMessage(exp?.error || 'Error getting payload.', 'error');
            resetSaveUI();
            return;
          }

          // Capture current site overrides and visibility rules
          const [overridesData, rulesData] = await Promise.all([
            storageGet(STORAGE_KEY_OVERRIDES),
            storageGet(STORAGE_KEY_VISIBILITY_RULES)
          ]);
          const currentOverrides = overridesData?.[STORAGE_KEY_OVERRIDES] || {};
          const currentRules = rulesData?.[STORAGE_KEY_VISIBILITY_RULES] || [];
          exp.payload.siteOverrides = currentOverrides;
          exp.payload.visibilityRules = currentRules;

          workspaces[name] = { name, createdAt: Date.now(), payload: exp.payload };
          await storageSetWorkspaces(workspaces);
          renderWorkspacesList(workspaces);
          showWorkspacesMessage(`Saved "${name}".`, 'success');
        } finally {
          createBtn.disabled = false;
          resetSaveUI();
        }
      };

      // Helper to show the overwrite confirmation UI
      const showOverwriteConfirmation = (name, container, workspaces) => {
        container.innerHTML = '';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '8px';

        const msg = document.createElement('span');
        msg.textContent = `Overwrite "${name}"?`;
        msg.style.fontSize = '12px';
        msg.style.color = '#f87171'; // Red
        msg.style.flex = '1';

        const yesBtn = document.createElement('button');
        yesBtn.textContent = 'Yes';
        yesBtn.className = 'btn small';

        const noBtn = document.createElement('button');
        noBtn.textContent = 'No';
        noBtn.className = 'btn small';

        container.appendChild(msg);
        container.appendChild(yesBtn);
        container.appendChild(noBtn);

        yesBtn.onclick = () => executeSave(name, workspaces);
        noBtn.onclick = resetSaveUI;
      };

      // Helper to show the input form
      const showSaveWorkspaceForm = () => {
        createBtn.style.display = 'none';

        const container = document.createElement('div');
        container.id = 'save-workspace-form';
        container.className = 'input-row';
        container.style.flex = '1';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'std-input';
        input.placeholder = 'Workspace name...';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.className = 'btn small';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn small';

        container.appendChild(input);
        container.appendChild(saveBtn);
        container.appendChild(cancelBtn);

        if (titleRow) titleRow.appendChild(container);
        input.focus();

        cancelBtn.onclick = resetSaveUI;

        saveBtn.onclick = async () => {
          const name = sanitizeWorkspaceName(input.value);
          if (!name) return;

          const currentWorkspaces = await storageGetWorkspaces();
          if (currentWorkspaces[name]) {
            showOverwriteConfirmation(name, container, currentWorkspaces);
          } else {
            executeSave(name, currentWorkspaces);
          }
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveBtn.click();
          if (e.key === 'Escape') resetSaveUI();
        });
      };

      if (createBtn) {
        createBtn.onclick = showSaveWorkspaceForm;
      }
      const workspaces = await storageGetWorkspaces();
      renderWorkspacesList(workspaces);

      // --- Visibility Init ---
      if (!tab || isSystemPage(String(url || ''))) {
        select.style.display = 'none';
        showToggleMessage('Bodhi Bar is not available on system pages.');
        return;
      }

      const getModeForTab = async () => {
        // 1. Check Explicit Tab Override
        const modeData = await storageGet(STORAGE_KEY_VISIBILITY_MODE);
        const tabModes = modeData?.[STORAGE_KEY_VISIBILITY_MODE] || {};
        if (tabId && tabModes[String(tabId)]) {
          return tabModes[String(tabId)];
        }

        // 2. Check Rules
        const ruleData = await storageGet(STORAGE_KEY_VISIBILITY_RULES);
        const rules = ruleData?.[STORAGE_KEY_VISIBILITY_RULES] || [];
        const matches = rules.filter(r => globToRegex(r.pattern).test(url));
        // Sort by length (longest = most specific wins)
        matches.sort((a, b) => b.pattern.length - a.pattern.length);
        
        if (matches.length > 0) {
          return matches[0].mode;
        }

        // 3. Default
        return VISIBILITY_MODES.PUSH;
      };

      const currentMode = await getModeForTab();
      select.value = currentMode;
      select.disabled = false;

      // Setup Domain Rules & CSS
      const rulesSection = document.getElementById('domain-rules-section');
      const rulesListEl = document.getElementById('activeRulesList');
      const btnAddRule = document.getElementById('btnAddRule');
      const btnEditCss = document.getElementById('btnEditCss');
      const cssEditorContainer = document.getElementById('cssEditorContainer');
      const cssEditorInput = document.getElementById('cssEditorInput');
      const btnSaveCss = document.getElementById('btnSaveCss');
      const domainBadge = document.getElementById('currentDomain');

      if (hostname && rulesSection) {
        rulesSection.style.display = 'block';
        if (domainBadge) domainBadge.textContent = hostname;

        // CSS Override Logic
        const loadCss = async () => {
          if (!cssEditorInput) return;
          const data = await storageGet(STORAGE_KEY_OVERRIDES);
          const overrides = data?.[STORAGE_KEY_OVERRIDES] || {};
          const css = overrides[hostname] || '';
          cssEditorInput.value = css;
          if (btnEditCss) {
            if (css) {
              btnEditCss.classList.add('active');
              btnEditCss.style.color = 'var(--accent)';
            } else {
              btnEditCss.classList.remove('active');
              btnEditCss.style.color = '';
            }
          }
        };
        await loadCss();

        if (btnEditCss) {
          btnEditCss.onclick = () => {
            const isHidden = cssEditorContainer.style.display === 'none';
            cssEditorContainer.style.display = isHidden ? 'block' : 'none';
            if (isHidden) cssEditorInput.focus();
          };
        }

        if (btnSaveCss) {
          btnSaveCss.onclick = async () => {
            const css = cssEditorInput.value;
            const data = await storageGet(STORAGE_KEY_OVERRIDES);
            const overrides = data?.[STORAGE_KEY_OVERRIDES] || {};
            
            if (css.trim()) {
              overrides[hostname] = css;
            } else {
              delete overrides[hostname];
            }
            
            await storageSet({ [STORAGE_KEY_OVERRIDES]: overrides });
            await loadCss();
            
            try {
              await chrome.tabs.sendMessage(tabId, { action: 'REFRESH_BAR' });
            } catch (e) {}
            
            const originalText = btnSaveCss.textContent;
            btnSaveCss.textContent = 'Saved!';
            setTimeout(() => {
              btnSaveCss.textContent = originalText;
              cssEditorContainer.style.display = 'none';
            }, 800);
          };
        }

        // Rules Logic
        const createRowUI = (rule, isNew, onSave, onDelete, onCancel) => {
            const row = document.createElement('div');
            row.className = 'rule-row';
            
            const currentMode = rule.mode || 'push';

            const viewDiv = document.createElement('div');
            viewDiv.style.display = isNew ? 'none' : 'flex';
            viewDiv.style.flex = '1';
            viewDiv.style.alignItems = 'center';
            viewDiv.style.gap = '6px';
            viewDiv.style.minWidth = '0';

            const badge = document.createElement('span');
            badge.className = `mode-badge mode-${currentMode}`;
            const modeLabels = { push: 'PUSH', overlay: 'OVER', hidden: 'HIDE' };
            badge.textContent = modeLabels[currentMode] || 'PUSH';
            
            const patternSpan = document.createElement('span');
            patternSpan.className = 'pattern-display';
            patternSpan.textContent = rule.pattern;
            patternSpan.title = rule.pattern;

            const viewActions = document.createElement('div');
            viewActions.className = 'rule-actions';
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-icon';
            btnEdit.innerHTML = '&#9997;';
            const btnDel = document.createElement('button');
            btnDel.className = 'btn-icon delete';
            btnDel.innerHTML = '&#128465;';
            
            viewActions.appendChild(btnEdit);
            viewActions.appendChild(btnDel);
            viewDiv.appendChild(badge);
            viewDiv.appendChild(patternSpan);
            viewDiv.appendChild(viewActions);

            const editDiv = document.createElement('div');
            editDiv.style.display = isNew ? 'flex' : 'none';
            editDiv.style.flex = '1';
            editDiv.style.alignItems = 'center';
            editDiv.style.gap = '2px';
            editDiv.style.minWidth = '0';

            const modeSelect = document.createElement('select');
            modeSelect.className = 'edit-mode-select';
            ['push', 'overlay', 'hidden'].forEach(m => {
              const opt = document.createElement('option');
              opt.value = m;
              opt.textContent = modeLabels[m];
              if (m === currentMode) opt.selected = true;
              modeSelect.appendChild(opt);
            });

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pattern-input';
            input.value = rule.pattern;
            input.spellcheck = false;

            const editActions = document.createElement('div');
            editActions.className = 'rule-actions';
            const btnSave = document.createElement('button');
            btnSave.className = 'btn-icon success';
            btnSave.innerHTML = '&#10003;';
            const btnCancel = document.createElement('button');
            btnCancel.className = 'btn-icon';
            btnCancel.innerHTML = '&#10005;';

            editActions.appendChild(btnSave);
            editActions.appendChild(btnCancel);
            editDiv.appendChild(modeSelect);
            editDiv.appendChild(input);
            editDiv.appendChild(editActions);

            const toggle = (e) => {
                viewDiv.style.display = e ? 'none' : 'flex';
                editDiv.style.display = e ? 'flex' : 'none';
                if (e) input.focus();
            };

            btnEdit.onclick = () => toggle(true);
            btnCancel.onclick = () => {
                if (isNew) onCancel(row);
                else { 
                  input.value = rule.pattern; 
                  modeSelect.value = rule.mode || 'push';
                  toggle(false); 
                }
            };
            btnSave.onclick = () => onSave(rule.pattern, input.value.trim(), modeSelect.value);
            btnDel.onclick = () => {
                // Inline confirmation instead of native confirm()
                viewDiv.style.display = 'none';
                editDiv.style.display = 'none';

                const confirmDiv = document.createElement('div');
                confirmDiv.className = 'rule-actions';
                confirmDiv.style.flex = '1';
                confirmDiv.style.gap = '6px';

                const label = document.createElement('span');
                label.textContent = 'Delete?';
                label.style.fontSize = '11px';
                label.style.fontWeight = 'bold';
                label.style.color = '#f87171';

                const yes = document.createElement('button');
                yes.textContent = 'Yes';
                yes.className = 'btn-icon delete';
                yes.style.fontSize = '10px';

                const no = document.createElement('button');
                no.textContent = 'No';
                no.className = 'btn-icon';
                no.style.fontSize = '10px';

                yes.onclick = () => { confirmDiv.remove(); onDelete(rule.pattern); };
                no.onclick = () => { confirmDiv.remove(); viewDiv.style.display = 'flex'; };

                confirmDiv.appendChild(label);
                confirmDiv.appendChild(yes);
                confirmDiv.appendChild(no);
                row.appendChild(confirmDiv);
            };
            
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') btnSave.click();
              if (e.key === 'Escape') btnCancel.click();
            });

            row.appendChild(viewDiv);
            row.appendChild(editDiv);
            return row;
        };

        const refreshList = async () => {
             const data = await storageGet(STORAGE_KEY_VISIBILITY_RULES);
             const allRules = data?.[STORAGE_KEY_VISIBILITY_RULES] || [];
             
             // Show rules that match the current URL OR belong to this hostname (approx)
             // This ensures that if you add a rule for a specific path that isn't current, it still shows up.
             const coreHost = hostname.replace(/^www\./, '');
             const matching = allRules.filter(r => {
               return globToRegex(r.pattern).test(url) || r.pattern.includes(hostname) || r.pattern.includes(coreHost);
             });

             matching.sort((a, b) => b.pattern.length - a.pattern.length);
             
             rulesListEl.innerHTML = '';
             matching.forEach((r, idx) => {
                 const row = createRowUI(r, false,
                    async (oldP, newP, m) => {
                        await saveRule(oldP, newP, m);
                        refreshList();
                    },
                    async (p) => {
                        await saveRule(p, null, null);
                        refreshList();
                    }
                 );
                 if (idx === 0) row.classList.add('winning');
                 rulesListEl.appendChild(row);
             });
        };

        await refreshList();

        btnAddRule.onclick = () => {
            const tempPattern = '*' + hostname + '/*';
            const row = createRowUI({ pattern: tempPattern, mode: select.value }, true,
                async (oldP, newP, m) => {
                    await saveRule(null, newP, m);
                    refreshList();
                },
                () => {},
                (r) => r.remove()
            );
            rulesListEl.appendChild(row);
            row.querySelector('input').focus();
        };
      }

      select.onchange = async () => {
        const newMode = select.value;
        const data = await storageGet(STORAGE_KEY_VISIBILITY_MODE);
        const map = data?.[STORAGE_KEY_VISIBILITY_MODE] || {};
        map[String(tabId)] = newMode;
        await storageSet({ [STORAGE_KEY_VISIBILITY_MODE]: map });

        try {
          await chrome.tabs.sendMessage(tabId, { action: 'SET_VISIBILITY_MODE', mode: newMode });
          await runtimeSendMessage({ action: 'REFRESH_TAB', tabId });
        } catch (e) {}
      };

      await migrateHiddenSitesToRules();
    });
  } catch {
    if (select) select.style.display = 'none';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
