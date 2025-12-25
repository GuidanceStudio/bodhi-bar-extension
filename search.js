/**
 * SEARCH.JS - Search functionality
 */

let searchQuery = '';
let searchExpanded = false;

function getSearchResults() {
  const q = normalizeForSearch(searchQuery).trim();
  if (!q) return [];
  const seen = new Set();
  const out = [];
  for (const t of (cachedAllTabs || [])) {
    if (!t?.id || seen.has(t.id)) continue;
    const url = t.url || t.pendingUrl || '';
    const domain = isWebUrl(url) ? extractFullDomain(url) : '';
    const hay = normalizeForSearch(`${t.title || ''} - ${domain}`);
    if (hay.includes(q)) {
      out.push({ tab: t, domain });
      seen.add(t.id);
    }
  }
  out.sort((a, b) => ((a.tab?.index ?? 0) - (b.tab?.index ?? 0)));
  return out.slice(0, 12);
}

function createSearchBar() {
  const wrap = document.createElement('div');
  wrap.className = 'tz-search' + (searchExpanded ? ' expanded' : '');

  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.textContent = SEARCH_ICON;
  wrap.appendChild(icon);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search tabs…';
  input.value = searchQuery;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.display = searchExpanded ? 'block' : 'none';
  input.style.paddingRight = '6px';
  input.onmousedown = (e) => { e.stopPropagation(); };
  input.onclick = (e) => { e.stopPropagation(); };
  input.oninput = () => {
    searchQuery = input.value || '';
    if (searchExpanded) openSearchPopover(wrap);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') {
      searchQuery = '';
      searchExpanded = false;
      input.style.display = 'none';
      closeActiveSearchPopover();
      if (navigationState === NAV_LEVELS.LEVEL_1) requestTabList();
    }
  };
  wrap.appendChild(input);

  const clear = document.createElement('div');
  clear.className = 'clear';
  clear.textContent = '×';
  clear.title = 'Close search';
  clear.style.display = searchExpanded ? 'block' : 'none';
  clear.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  clear.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    searchQuery = '';
    input.value = '';
    searchExpanded = false;
    input.style.display = 'none';
    clear.style.display = 'none';
    closeActiveSearchPopover();
    if (navigationState === NAV_LEVELS.LEVEL_1) requestTabList();
  };
  wrap.appendChild(clear);

  wrap.onmousedown = (e) => { e.stopPropagation(); };
  wrap.onclick = (e) => {
    e.stopPropagation();
    if (!searchExpanded) {
      searchExpanded = true;
      wrap.classList.add('expanded');
      input.style.display = 'block';
      clear.style.display = 'block';
      setTimeout(() => { try { input.focus(); } catch {} }, 0);
      openSearchPopover(wrap);
    } else {
      searchQuery = '';
      input.value = '';
      searchExpanded = false;
      input.style.display = 'none';
      clear.style.display = 'none';
      closeActiveSearchPopover();
      if (navigationState === NAV_LEVELS.LEVEL_1) requestTabList();
    }
  };

  const syncClear = () => { clear.style.display = searchExpanded ? 'block' : 'none'; };
  input.addEventListener('input', syncClear);
  syncClear();

  return wrap;
}
