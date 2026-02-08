 // popup.js - Bodhi Bar popup behavior

const RESTRICTED_PREFIXES = [
  'chrome://',
  'brave://',
  'about:',
  'edge://',
  'devtools://',
  'view-source:',
  'chrome-extension://',
  'brave-extension://',
  'extension://',
  'vivaldi://',
  'opera://'
];

const STORAGE_KEY_HIDDEN_BY_TAB = 'tz_hidden_by_tab';
const STORAGE_KEY_WORKSPACES = 'tz_workspaces_v1';
const STORAGE_KEY_HIDDEN_SITES = 'tz_default_hidden_sites';
const STORAGE_KEY_VISIBILITY_MODE = 'tz_visibility_mode';
const STORAGE_KEY_VISIBILITY_RULES = 'tz_visibility_rules';
const STORAGE_KEY_OVERRIDES = 'tz_site_overrides';
const PRESET_NAME_MAX_LEN = 60;

const VISIBILITY_MODES = {
  PUSH: 'push',
  OVERLAY: 'overlay',
  HIDDEN: 'hidden'
};

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
  if (!url || typeof url !== 'string') return true;
  const u = url.trim().toLowerCase();
  return RESTRICTED_PREFIXES.some(p => u.startsWith(p));
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function globToRegex(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${pattern}$`, 'i');
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

  const select = document.getElementById('visibilityModeSelect');
  if (select && select.parentNode) {
    if (select.nextSibling) select.parentNode.insertBefore(msg, select.nextSibling);
    else select.parentNode.appendChild(msg);
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
  importBtn.addEventListener('click', () => {
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
          const newName = sanitizeWorkspaceName(prompt(`A workspace named "${finalName}" already exists. Enter a different name to import:`));
          if (!newName) {
            showWorkspacesMessage('Import cancelled.');
            return;
          }
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

    const nameSpan = document.createElement('span');
    nameSpan.className = 'workspace-title';
    nameSpan.textContent = name;
    nameSpan.title = name;

    const actions = document.createElement('div');
    actions.className = 'workspace-actions';
    actions.style.display = 'flex';
    actions.style.gap = '4px';
    actions.style.alignItems = 'center';

    const restoreIcon = document.createElement('span');
    restoreIcon.className = 'workspace-action-icon restore';
    restoreIcon.innerHTML = '&#128260;';
    restoreIcon.title = 'Restore';
    restoreIcon.addEventListener('click', async () => {
      const payload = workspacesMap[name]?.payload;
      if (!payload) return;

      const confirmed = confirm('This will close all current tabs and groups and replace them with the workspace tabs. Continue?');
      if (!confirmed) return;

      restoreIcon.style.opacity = '0.5';
      try {
        // Restore Site Overrides if present
        if (payload.siteOverrides) {
          const currentOverrides = await storageGet(STORAGE_KEY_OVERRIDES);
          const merged = { ...(currentOverrides?.[STORAGE_KEY_OVERRIDES] || {}), ...payload.siteOverrides };
          await storageSet({ [STORAGE_KEY_OVERRIDES]: merged });
        }

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
    renameIcon.innerHTML = '&#9997;';
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
          showWorkspacesMessage(res?.error || 'Export failed.');
        }
      } finally {
        exportIcon.style.opacity = '1';
      }
    });

    const delIcon = document.createElement('span');
    delIcon.className = 'workspace-action-icon delete';
    delIcon.innerHTML = '&#128465;';
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
      if (createBtn) {
        createBtn.onclick = null;
        createBtn.addEventListener('click', async () => {
           const raw = prompt('Workspace name:');
           const workspaceName = sanitizeWorkspaceName(raw);
           if (!workspaceName) return;
           createBtn.disabled = true;
           try {
             const exp = await runtimeSendMessage({ action: 'GET_EXPORT_PAYLOAD' });
             if (!exp?.ok || !exp?.payload) {
               showWorkspacesMessage(exp?.error || 'Error getting payload.');
               return;
             }
             const workspaces = await storageGetWorkspaces();
             if (workspaces[workspaceName] && !confirm(`Overwrite "${workspaceName}"?`)) return;
             
             // Capture current site overrides and visibility rules
             const [overridesData, rulesData] = await Promise.all([
               storageGet(STORAGE_KEY_OVERRIDES),
               storageGet(STORAGE_KEY_VISIBILITY_RULES)
             ]);
             const currentOverrides = overridesData?.[STORAGE_KEY_OVERRIDES] || {};
             const currentRules = rulesData?.[STORAGE_KEY_VISIBILITY_RULES] || [];
             exp.payload.siteOverrides = currentOverrides;
             exp.payload.visibilityRules = currentRules;

             workspaces[workspaceName] = { name: workspaceName, createdAt: Date.now(), payload: exp.payload };
             await storageSetWorkspaces(workspaces);
             renderWorkspacesList(workspaces);
           } finally {
             createBtn.disabled = false;
           }
        });
      }
      const workspaces = await storageGetWorkspaces();
      renderWorkspacesList(workspaces);

      // --- Visibility Init ---
      if (!tab || isRestrictedUrl(String(url || ''))) {
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
            btnDel.onclick = () => onDelete(rule.pattern);
            
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
                        if (oldP !== newP) await saveRule(oldP, newP, m);
                        else await saveRule(oldP, newP, m);
                        refreshList();
                    },
                    async (p) => {
                        if (confirm('Delete rule?')) {
                            await saveRule(p, null, null);
                            refreshList();
                        }
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
