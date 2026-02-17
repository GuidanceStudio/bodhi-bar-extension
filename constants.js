/**
 * CONSTANTS.JS - Bodhi Bar Configuration
 */

const MAX_TITLE_LENGTH = 30;
const INDICATOR_COLOR = '#0078d4';
const BACK_ARROW = '◀';
const SEARCH_ICON = '⌕';

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

const TZ_BAR_ID = 'ungroup-automatic-tab-bar';
const TZ_PORT_NAME = 'TZ_UI_PORT';
const TZ_HANDSHAKE_MSG = { action: '__TZ_HANDSHAKE__' };
const TZ_SHIFT_ATTR = 'data-tz-top-shifted';
const TZ_SAFE_STYLE_ATTR = 'data-tz-safe-areas';
const TZ_MAX_SHIFT_TARGETS = 6;
const TZ_CLIP_ATTR = 'data-tz-safe-bottom-clipper';

const POPOVER_SECTION_GAP_PX = 6;

// Visibility Modes
const VISIBILITY_MODES = {
  PUSH: 'push',       // Default: bar pushes content down
  OVERLAY: 'overlay', // New: bar floats over content
  HIDDEN: 'hidden'    // Bar is hidden
};

const STORAGE_KEY_VISIBILITY_MODE = 'tz_visibility_mode';
const STORAGE_KEY_VISIBILITY_RULES = 'tz_visibility_rules';
