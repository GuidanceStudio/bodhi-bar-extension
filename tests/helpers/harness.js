/**
 * Zero-dependency test harness for Bodhi Bar.
 *
 * The extension's source files are plain browser globals loaded via <script>
 * (no module system, no exports). To unit-test them in Node we concatenate the
 * requested source files and evaluate them in a single `vm` context with mocked
 * `chrome`, `window`, and a minimal DOM. Because everything runs as one script,
 * an appended epilogue can read the files' top-level `const`/`function` symbols
 * and expose the ones we ask for via `window.__TZ`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(ROOT, 'src');

// Source files live under src/ in nested folders (background, content, popup,
// editor). Tests reference them by bare basename, so build a basename → path
// index once. Basenames are unique today; a collision is a hard error so a
// future duplicate name can't silently resolve to the wrong file.
const SRC_INDEX = (() => {
  const index = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (index.has(entry.name)) {
        throw new Error(`Ambiguous source basename "${entry.name}": ${index.get(entry.name)} vs ${full}`);
      }
      index.set(entry.name, full);
    }
  };
  walk(SRC_ROOT);
  return index;
})();

function readSrc(name) {
  // Resolve a bare basename via the src/ index; fall back to a ROOT-relative
  // path for anything outside src/.
  const full = SRC_INDEX.get(name) || path.join(ROOT, name);
  return fs.readFileSync(full, 'utf8');
}

// --- Minimal DOM ---------------------------------------------------------

function makeStyle() {
  const kebab = {};
  return {
    setProperty(name, value) { kebab[name] = value; },
    removeProperty(name) { delete kebab[name]; },
    getPropertyValue(name) { return kebab[name] || ''; },
  };
}

function makeElement(tag = 'div') {
  const classes = new Set();
  return {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    style: makeStyle(),
    classList: {
      add(...c) { c.forEach((x) => classes.add(x)); },
      remove(...c) { c.forEach((x) => classes.delete(x)); },
      toggle(c, force) {
        const want = force === undefined ? !classes.has(c) : !!force;
        if (want) classes.add(c); else classes.delete(c);
        return want;
      },
      contains(c) { return classes.has(c); },
    },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    contains() { return false; },
    get parentElement() { return null; },
  };
}

function makeDocument(readyState = 'complete') {
  const registry = new Map();
  const head = makeElement('head');
  const body = makeElement('body');
  const documentElement = makeElement('html');
  return {
    head,
    body,
    documentElement,
    readyState,
    _registry: registry,
    getElementById(id) { return registry.get(id) || null; },
    createElement(tag) { return makeElement(tag); },
    createTreeWalker() { return { nextNode() { return null; } }; },
    elementFromPoint() { return null; },
    querySelector() { return null; },
    addEventListener() {},
  };
}

// --- Minimal chrome ------------------------------------------------------

function makeChrome(initialData = {}) {
  const store = { ...initialData };
  const local = {
    _store: store,
    get(keys, cb) {
      const out = {};
      const list = Array.isArray(keys) ? keys : (keys == null ? Object.keys(store) : [keys]);
      for (const k of list) if (k in store) out[k] = store[k];
      if (typeof cb === 'function') { cb(out); return; }
      return Promise.resolve(out);
    },
    set(obj, cb) {
      Object.assign(store, obj);
      if (typeof cb === 'function') { cb(); return; }
      return Promise.resolve();
    },
  };
  return {
    storage: { local },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage() { return Promise.resolve(null); },
    },
    tabs: { sendMessage() { return Promise.resolve(); } },
  };
}

// --- Loader --------------------------------------------------------------

/**
 * Load source files into a sandbox and return requested symbols.
 * @param {string[]} files - source file names relative to repo root
 * @param {string[]} exportNames - top-level symbols to expose
 * @param {object} [opts] - { storage, windowProps }
 */
function load(files, exportNames, opts = {}) {
  // Pages whose source auto-runs on load (e.g. popup.js) register a
  // DOMContentLoaded listener when readyState is 'loading'; our no-op
  // addEventListener then never fires it, so the module's functions can be
  // tested in isolation without triggering its bootstrap.
  const document = makeDocument(opts.readyState || 'complete');
  const counters = { raf: 0, dispatched: 0, timeout: 0 };
  const window = {
    currentVisibilityMode: null,
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    location: { href: 'https://example.com/' },
    visualViewport: null,
    addEventListener() {},
    dispatchEvent() { counters.dispatched += 1; return true; },
    matchMedia() { return { addEventListener() {}, removeEventListener() {} }; },
    requestAnimationFrame() { counters.raf += 1; return 1; },
    cancelAnimationFrame() {},
    ...(opts.windowProps || {}),
  };

  const sandbox = {
    window,
    document,
    chrome: makeChrome(opts.storage || {}),
    getComputedStyle() { return {}; },
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    setTimeout() { counters.timeout += 1; return 0; },
    clearTimeout() {},
    NodeFilter: { SHOW_ELEMENT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, FILTER_ACCEPT: 1 },
    Event: class { constructor(type) { this.type = type; } },
    console,
  };
  const context = vm.createContext(sandbox);

  const src = files.map(readSrc).join('\n;\n');
  const exportLines = exportNames
    .map((n) => `  ${JSON.stringify(n)}: (typeof ${n} !== 'undefined' ? ${n} : undefined),`)
    .join('\n');
  const epilogue = `\n;window.__TZ = {\n${exportLines}\n};`;

  vm.runInContext(src + epilogue, context, { filename: 'tz-bundle.js' });

  return { exports: window.__TZ, window, document, chrome: sandbox.chrome, counters };
}

module.exports = { load, readSrc, ROOT };
