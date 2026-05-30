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

  if (pinnedTabs != null && !Array.isArray(pinnedTabs)) {
    return { ok: false, error: 'Invalid payload: "pinnedTabs" must be an array.' };
  }
  if (allTabGroups != null && !Array.isArray(allTabGroups)) {
    return { ok: false, error: 'Invalid payload: "allTabGroups" must be an array.' };
  }
  // Legacy payloads may carry siteOverrides / visibilityRules; those features
  // were removed, so they are accepted and ignored (not validated).

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

function applyMessageStyle(el, type) {
  el.className = 'msg-box';
  if (type === 'success') {
    el.classList.add('msg-success');
  } else if (type === 'error') {
    el.classList.add('msg-error');
  } else {
    el.classList.add('msg-info');
  }
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

  const cleanup = () => { input.remove(); };

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
          yes.disabled = true;
          no.disabled = true;
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

    const editIcon = document.createElement('span');
    editIcon.className = 'workspace-action-icon edit';
    editIcon.innerHTML = '&#9999;&#65039;'; // ✏️
    editIcon.title = 'Edit workspace contents';
    editIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = chrome.runtime.getURL('editor.html') + '?ws=' + encodeURIComponent(name);
      chrome.tabs.create({ url });
      window.close();
    });

    actions.appendChild(restoreIcon);
    actions.appendChild(editIcon);
    actions.appendChild(renameIcon);
    actions.appendChild(exportIcon);
    actions.appendChild(delIcon);

    li.appendChild(nameSpan);
    li.appendChild(actions);
    ul.appendChild(li);
  }

  appendImportRow(ul);
}

// --- initPopup helpers ---

function initImportMode() {
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
}

async function initWorkspacesSection() {
  const createBtn = document.getElementById('createWorkspace');
  const titleRow = document.querySelector('.workspaces-title-row');

  const resetSaveUI = () => {
    const form = document.getElementById('save-workspace-form');
    if (form) form.remove();
    createBtn.style.display = '';
  };

  const executeSave = async (name, workspaces) => {
    createBtn.disabled = true;
    try {
      const exp = await runtimeSendMessage({ action: 'GET_EXPORT_PAYLOAD' });
      if (!exp?.ok || !exp?.payload) {
        showWorkspacesMessage(exp?.error || 'Error getting payload.', 'error');
        resetSaveUI();
        return;
      }

      workspaces[name] = { name, createdAt: Date.now(), payload: exp.payload };
      await storageSetWorkspaces(workspaces);
      renderWorkspacesList(workspaces);
      showWorkspacesMessage(`Saved "${name}".`, 'success');
    } finally {
      createBtn.disabled = false;
      resetSaveUI();
    }
  };

  const showOverwriteConfirmation = (name, container, workspaces) => {
    container.innerHTML = '';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';

    const msg = document.createElement('span');
    msg.textContent = `Overwrite "${name}"?`;
    msg.style.fontSize = '12px';
    msg.style.color = '#f87171';
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
}

function initPopup() {
  if (window.location.search.includes('mode=import')) {
    initImportMode();
    return;
  }
  initWorkspacesSection();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
