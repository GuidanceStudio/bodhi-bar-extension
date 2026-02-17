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
const TZ_SHIFT_ATTR = 'data-tz-top-shifted';
const TZ_SAFE_STYLE_ATTR = 'data-tz-safe-areas';
const TZ_MAX_SHIFT_TARGETS = 6;
const TZ_CLIP_ATTR = 'data-tz-safe-bottom-clipper';

const POPOVER_SECTION_GAP_PX = 6;

// --- Visibility Modes ---
const VISIBILITY_MODES = {
  PUSH: 'push',
  OVERLAY: 'overlay',
  HIDDEN: 'hidden'
};

// --- Storage Keys ---
const STORAGE_KEY_VISIBILITY_MODE = 'tz_visibility_mode';
const STORAGE_KEY_VISIBILITY_RULES = 'tz_visibility_rules';
const STORAGE_KEY_HIDDEN_BY_TAB = 'tz_hidden_by_tab';
const STORAGE_KEY_OVERRIDES = 'tz_site_overrides';
const STORAGE_KEY_WORKSPACES = 'tz_workspaces_v1';
const STORAGE_KEY_MINIMIZED_BY_TAB = 'tz_minimized_by_tab';

// --- System URL Prefixes ---
const SYSTEM_PREFIXES = [
  'chrome://', 'brave://', 'about:',
  'chrome-extension://', 'brave-extension://',
  'edge://', 'devtools://', 'extension://',
  'vivaldi://', 'opera://', 'view-source:'
];

// --- Shared Utility Functions ---

/**
 * Convert a glob pattern (with * wildcards) to a RegExp.
 * Used for URL matching in visibility rules.
 */
function globToRegex(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${pattern}$`, 'i');
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
