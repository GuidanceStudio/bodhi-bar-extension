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

function isRestrictedUrl(url = '') {
  if (!url || typeof url !== 'string') return true; // defensive: if unknown, treat as restricted
  const u = url.trim().toLowerCase();
  return RESTRICTED_PREFIXES.some(p => u.startsWith(p));
}

function hideToggleButtons() {
  // Try common IDs/classes
  const selectors = [
    '#show-btn',
    '#hide-btn',
    '.show-btn',
    '.hide-btn',
    '#toggle-btn',
    '.tz-toggle',
    '.toggle-visibility',
    'button[data-action="SET_VISIBILITY"]',
    '[data-action="SET_VISIBILITY"]'
  ];

  let foundAny = false;
  for (const sel of selectors) {
    const nodes = Array.from(document.querySelectorAll(sel));
    for (const n of nodes) {
      if (n && n.style) {
        n.style.display = 'none';
        foundAny = true;
      }
    }
  }

  // Additionally, hide any button whose visible text is Show Bar / Hide Bar (case-insensitive)
  const textTargets = ['show bar', 'hide bar', 'show', 'hide'];
  const btns = Array.from(document.querySelectorAll('button, a, div'));
  for (const el of btns) {
    try {
      const txt = (el.textContent || '').trim().toLowerCase();
      if (!txt) continue;
      // Match exact or startsWith variants to be tolerant.
      if (textTargets.some(t => txt === t || txt.startsWith(t + ' ') || txt.startsWith(t + '\n') || txt === t + ' bar' )) {
        el.style.display = 'none';
        foundAny = true;
      }
    } catch {
      // ignore
    }
  }

  return foundAny;
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
  msg.style.color = '#222';
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
  // Query active tab
  try {
    if (!chrome.tabs || !chrome.tabs.query) {
      // If chrome.tabs unavailable, be conservative and show the message
      hideToggleButtons();
      showRestrictedMessage();
      return;
    }

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = (tabs && tabs[0]) ? tabs[0] : null;
      const url = tab?.url || tab?.pendingUrl || '';
      if (!tab) {
        // No active tab: treat as restricted context
        hideToggleButtons();
        showRestrictedMessage();
        return;
      }

      if (isRestrictedUrl(String(url || ''))) {
        hideToggleButtons();
        showRestrictedMessage();
        return;
      }

      // Not restricted: do nothing and allow existing popup logic to run.
      // This keeps original show/hide behavior intact.
    });
  } catch (e) {
    // On unexpected error, hide toggles and show the explanatory message to avoid confusion.
    hideToggleButtons();
    showRestrictedMessage();
  }
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
