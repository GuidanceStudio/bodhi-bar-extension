/**
 * CONSTANTS.JS - Bodhi Bar Shared Configuration
 *
 * Single source of truth for constants and utility functions shared
 * across content scripts, background service worker, and popup.
 */

// --- UI Constants ---
const MAX_TITLE_LENGTH = 30;
const INDICATOR_COLOR = '#0078d4';
const BACK_ARROW = '◀';
const SEARCH_ICON = '⌕';
const PRESET_NAME_MAX_LEN = 60;

const GROUP_COLOR_MAP = {
  grey: '#5f6368', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663',
  green: '#81c995', pink: '#ff80ab', purple: '#c589d7', cyan: '#78d9ec',
  orange: '#fcc934', default: '#505050'
};

const WEB_URL_RE = /^https?:\/\//i;

const NAV_LEVELS = {
  LEVEL_1: 'default',
  LEVEL_2: 'groups',
  LEVEL_3: 'group_tabs'
};

// --- Element IDs & Attributes ---
const TZ_BAR_ID = 'ungroup-automatic-tab-bar';
const TZ_PORT_NAME = 'TZ_UI_PORT';
const TZ_HANDSHAKE_MSG = { action: '__TZ_HANDSHAKE__' };

const POPOVER_SECTION_GAP_PX = 6;

// --- Storage Keys ---
const STORAGE_KEY_WORKSPACES = 'tz_workspaces_v1';
const STORAGE_KEY_PINNED_BY_TAB = 'tz_pinned_by_tab';
const STORAGE_KEY_GROUP_META = 'tz_group_meta';

// Inline leaf glyph for the collapsed chip (the hover/click target).
// Inline (not an <img>) so it inherits color via `currentColor` and stays
// crisp at small sizes without an extra asset fetch.
const TZ_LEAF_SVG = '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C3 8 17 8 17 8z"/></svg>';

// --- System URL Prefixes ---
const SYSTEM_PREFIXES = [
  'chrome://', 'brave://', 'about:',
  'chrome-extension://', 'brave-extension://',
  'edge://', 'devtools://', 'extension://',
  'vivaldi://', 'opera://', 'view-source:'
];

// --- Shared Utility Functions ---

/**
 * Per-tab pin state. A tab is pinned only if explicitly stored `true`;
 * the default (absent key) is unpinned — the bar stays a collapsed leaf.
 */
function isTabPinned(map, tabId) {
  return (map || {})[String(tabId)] === true;
}

/**
 * Return a new pin map with `tabId` toggled. Pinned tabs store `true`;
 * unpinning deletes the key so the default (unpinned) costs no storage.
 * Pure: the input map is not mutated.
 */
function nextPinnedMap(map, tabId) {
  const next = { ...(map || {}) };
  const key = String(tabId);
  if (next[key] === true) delete next[key];
  else next[key] = true;
  return next;
}

/**
 * Check if a URL is a browser system page (chrome://, brave://, etc.)
 */
function isSystemPage(tabOrUrl) {
  const url = (typeof tabOrUrl === 'string')
    ? tabOrUrl
    : (tabOrUrl?.url || tabOrUrl?.pendingUrl || '');
  if (!url) return false;
  return SYSTEM_PREFIXES.some(prefix => String(url).startsWith(prefix));
}
