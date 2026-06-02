'use strict';

// Smoke test for file-path integrity. The extension has no bundler, so every
// path in manifest.json and every getURL()/importScripts() string is hand-
// maintained and only fails at runtime. This suite resolves them all against
// the filesystem so a broken path (e.g. after a reorganization) fails `npm test`
// instead of silently breaking the loaded extension.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// All .js files under src/ (recursive).
function jsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

// Strip a ?query or #hash so the bare resource path remains.
const stripSuffix = (p) => p.replace(/[?#].*$/, '');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('manifest.json: every referenced path exists', () => {
  const refs = [];
  if (manifest.action?.default_popup) refs.push(manifest.action.default_popup);
  refs.push(...Object.values(manifest.action?.default_icon ?? {}));
  refs.push(...Object.values(manifest.icons ?? {}));
  for (const cs of manifest.content_scripts ?? []) {
    refs.push(...(cs.js ?? []), ...(cs.css ?? []));
  }
  if (manifest.background?.service_worker) refs.push(manifest.background.service_worker);

  assert.ok(refs.length > 0, 'expected at least one manifest path reference');
  for (const ref of refs) {
    assert.ok(exists(path.join(ROOT, ref)), `manifest path missing: ${ref}`);
  }
});

test('content_scripts load order is preserved (constants first, content.js last)', () => {
  const js = manifest.content_scripts[0].js;
  assert.ok(js[0].endsWith('constants.js'), `expected constants.js first, got ${js[0]}`);
  assert.ok(js[js.length - 1].endsWith('content.js'), `expected content.js last, got ${js.at(-1)}`);
});

test('getURL(): every string-literal path resolves to a file', () => {
  const re = /getURL\(\s*['"]([^'"]+)['"]\s*\)/g;
  let checked = 0;
  for (const file of jsFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      const rel = stripSuffix(m[1]);
      assert.ok(exists(path.join(ROOT, rel)),
        `getURL('${m[1]}') in ${path.relative(ROOT, file)} → missing ${rel}`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'expected at least one getURL() literal to verify');
});

test('importScripts(): every string-literal resolves worker-relative', () => {
  const re = /importScripts\(\s*['"]([^'"]+)['"]\s*\)/g;
  let checked = 0;
  for (const file of jsFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      // importScripts resolves relative to the worker's own location.
      const resolved = path.join(path.dirname(file), stripSuffix(m[1]));
      assert.ok(exists(resolved),
        `importScripts('${m[1]}') in ${path.relative(ROOT, file)} → missing ${path.relative(ROOT, resolved)}`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'expected at least one importScripts() literal to verify');
});
