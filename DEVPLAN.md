# Devplan — Fix workspace restore duplicating groups

## Problem

When restoring a workspace, tab groups get duplicated (tripled in the reported case).
The browser's tab strip shows e.g. Tech×3, Office×3, Comms×3 instead of one of each.

### Root causes

1. **Placeholder tab never removed** — created to prevent 0-tab window, but never deleted. *(Fixed in M1-M3)*
2. **No concurrency guard** — restore could run in parallel. *(Fixed in M1)*
3. **Brave ghost groups** — Brave may not destroy groups on bulk tab remove. *(Fixed in M4)*
4. **Corrupted workspace data** — If the workspace was saved AFTER a previous buggy restore, the payload itself contains tripled groups. Every subsequent restore faithfully recreates them. *(Fixed in M5+M6)*

---

## M1 — Add concurrency guard to APPLY_WORKSPACE ✅

- [x] `restoreInProgress` flag + `finally` block
- [x] Disable confirm buttons in popup after click

## M2 — Verify tab closure before creating new tabs ✅

- [x] Re-query after `chrome.tabs.remove()`, retry once, abort if tabs survive

## M3 — Clean up placeholder tab after restore ✅

- [x] `chrome.tabs.remove(placeholderTabId)` instead of move-to-end

## M4 — Explicitly destroy groups before closing tabs (Brave fix) ✅

- [x] `chrome.tabs.ungroup()` on all grouped tabs before closing

## M5 — Deduplicate groups in payload before restore ✅

- [x] In `APPLY_WORKSPACE`, after parsing `allTabGroups`, merge groups that share the same `title` + `color` key
- [x] Combine their `tabs` arrays (deduplicate by URL to avoid duplicate tabs within the merged group)
- [x] Log a warning when dedup occurs so the user knows the snapshot was dirty

## M6 — Deduplicate on save (prevent corruption at source) ✅

- [x] In `buildExportPayload()`, after building `allTabGroups`, merge groups with same title+color
- [x] Deduplicate tabs by URL within each merged group

---

# Feature — Workspace editor (full-page GUI)

## Obiettivo

Dare all'utente una GUI a pagina intera per editare manualmente un workspace salvato: rinomina, riordino, spostamento tab tra gruppi, colore, eliminazione, creazione gruppi, visibility mode per tab, site overrides. Il popover resta per uso rapido (save/restore/export/delete del blob workspace); l'editor è per modifiche fini al contenuto.

## Approccio

Nuova pagina `editor.html` aperta in tab dal popover (`chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?ws=<name>') })`). Vanilla `editor.js` + `editor.css`, riusa `constants.js` e lo storage layer esistente (`STORAGE_KEY_WORKSPACES`). Render ad albero: workspace → "Pinned" → gruppi → tab. Editing diretto inline (no modal): click su titolo per rinomina inline (pattern di `popup.js:648`), color picker per gruppi, HTML5 DnD per riordino e move cross-group, conferma inline per delete. Salvataggio idempotente dell'intero workspace ad ogni mutazione (dati piccoli, semplicità batte ottimizzazione). Tab labels: title catturato a save-time in `buildExportPayload`, fallback a hostname per payload pre-esistenti.

## Rischi

- **Edit concorrente da più editor aperti** — last-write-wins. Mitigazione: rilettura fresca da storage prima di ogni save, warning se `savedAt` cambiato sotto i piedi.
- **DnD cross-group fragile** — implementazione self-contained nell'editor, non riusare `drag-drop.js` (è specifico per la barra orizzontale).
- **Schema retro-compatibilità** — payload vecchi senza `title` per tab continuano a funzionare via fallback hostname.
- **Workspace cancellato mentre l'editor è aperto** — messaggio "workspace non trovato" con link al popover.

## Out of scope

- Edit del title del tab come override del titolo browser (decisione: solo label read-only nell'editor).
- Aggiunta di nuovi tab da zero (solo edit/delete dei tab esistenti; gruppi sì, tab no).
- Multi-window workspace (modello attuale: single-window snapshot).
- Undo/redo.
- Sync live tra editor aperti contemporaneamente in più tab.

## Esecuzione: IDD invece di TDD

Il progetto è una MV3 vanilla senza test infrastructure (no `package.json`, no runner, nessuna dir `tests/`). Per M7-M11 lo step "Tests" del playbook viene sostituito da **verifica manuale**: caricare l'estensione unpacked in Brave, esercitare la feature target e annotare gli scenari verificati nel devplan. Decisione presa di comune accordo prima dell'esecuzione.

---

## M7 — Editor scaffolding (read-only) ✅

**Why:** Stabilire la fondazione della GUI editor con render read-only del workspace, raggiungibile dal popover. Senza editing, ma già usabile come "preview dettagliato" del workspace.

**Approach:** Creare `editor.html`, `editor.js`, `editor.css` nella root del progetto. Aggiungere icona ✎ in `popup.js:renderWorkspacesList` accanto alle azioni esistenti, click → `chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?ws=' + encodeURIComponent(name)) })`. In `editor.js`: leggere `?ws=<name>` da `location.search`, caricare `STORAGE_KEY_WORKSPACES[name]` da `chrome.storage.local`, renderizzare l'albero (header con workspace name + savedAt; sezione Pinned; lista gruppi con header colorato e lista tab annidata). Tab row: favicon (via `chrome://favicon/` o derivato), label = `title || hostname(url)`, host secondario, URL tooltip. Modificare `buildExportPayload` in `background.js:650` per includere `t.title` nel `tabToExport` (back-compat: assenza → fallback hostname nell'editor). Stato vuoto se workspace non trovato. Nessun handler di edit in questa milestone.

**Tasks:**
- [x] Creare `editor.html` (struttura base, link a `constants.js` + `editor.js`/`editor.css`)
- [x] Creare `editor.css` con stili coerenti col popup (riusa palette di `popup.css` dove sensato)
- [x] Creare `editor.js` con loader workspace + render albero read-only
- [x] ~~Aggiungere `editor.html` a `web_accessible_resources`~~ — non necessario in MV3 per pagine extension-owned aperte via `chrome.runtime.getURL`
- [x] Aggiungere icona ✎ in `popup.js:renderWorkspacesList`, handler apre tab editor
- [x] Modificare `buildExportPayload` per catturare `t.title` in `tabToExport`
- [ ] Verifica manuale (utente): caricare estensione unpacked, aprire editor su workspace nuovo (con title) e legacy (senza title)
- [x] Update `README.md` con paragrafo "Edit"
- [x] Commit & push

**Notes:** Favicon scartata — richiederebbe permesso `"favicon"` in MV3 e non è essenziale per uno strumento di editing dati. Sostituita con un dot grigio neutro. Reintroducibile in milestone successive se serve. L'editor rilegge automaticamente da storage via `chrome.storage.onChanged` se il workspace cambia esternamente (es. rinomina dal popover).

**Done when:** Click sull'icona ✎ accanto a un workspace nel popover apre una nuova tab che mostra l'albero completo del workspace (pinned + gruppi + tab) in sola lettura, con label leggibili sui tab.

---

## M8 — Rinomina e colori ✅

**Why:** Prima funzionalità di editing concreta. Rinomina di workspace e gruppi è la modifica più richiesta e a basso rischio; il color picker completa la coerenza visiva con la barra dei tab.

**Approach:** In `editor.js`, click sul nome workspace nell'header → input inline (Enter salva, Esc/blur cancella). Validazione: non vuoto, non collide con altro workspace esistente. Se cambia, rinomina la chiave nello storage map (delete vecchia + set nuova) e aggiorna `?ws=` nell'URL via `history.replaceState`. Stesso pattern per group title. Color picker: piccolo bottone tondo nell'header gruppo, click apre popover absolute-positioned con i 9 swatch di `GROUP_COLOR_MAP`. Save helper centrale `saveWorkspace({mutator, renameTo})` che fa read-modify-write con check di `savedAt` (se cambiato → flash error + reload).

**Tasks:**
- [x] `sanitizeWorkspaceName` duplicato in `editor.js` (cross-script context: editor non condivide closure col popup)
- [x] Implementare rinomina inline workspace (input + Enter/Esc/blur + collision check + URL update)
- [x] Implementare rinomina inline group title
- [x] Implementare color picker per gruppi (popover con 9 swatch + outside-click close)
- [x] Implementare `saveWorkspace()` helper con concurrency check via `savedAt`
- [x] Helper `startInlineEdit` riusabile (Enter commit, Esc/blur cancel)
- [ ] Verifica manuale (utente): rinomina workspace persiste dopo reload; collision dà errore; rinomina gruppo OK; color cambia visivamente; due editor aperti su stesso WS → secondo write triggera "modified externally" e reload
- [x] Commit & push

**Done when:** L'utente può rinominare il workspace (con check unicità), rinominare i gruppi e cambiare il loro colore; tutte le modifiche sopravvivono al reload della pagina.

---

## M9 — Riordino e spostamento (drag & drop)

**Why:** Riordino e move cross-group sono la ragione principale per cui un editor a pagina intera vale rispetto al popover. Senza questo, l'editor è solo un "rinominatore".

**Approach:** HTML5 native DnD (`draggable="true"`, `dragstart`/`dragover`/`drop`). Tre tipi di operazioni: riordina gruppi (drop su altro gruppo, before/after), riordina tab dentro gruppo, sposta tab tra gruppi (incluso pinned come "gruppo virtuale"). Drop indicator: linea sopra/sotto target (CSS class). Logica in `editor.js`: `dragState` con `{ type: 'group'|'tab', sourceIdx, sourceGroupIdx? }`, su `drop` mutare il payload e chiamare `saveWorkspace`. Re-render incrementale (semplice: full re-render dopo save). Pinned è una sezione separata nell'albero ma per il modello dati equivale a un gruppo speciale; gestire come case a parte nel handler.

**Tasks:**
- [ ] Aggiungere `draggable="true"` a group rows e tab rows
- [ ] Implementare handlers `dragstart`/`dragover`/`dragleave`/`drop` con drop indicator CSS
- [ ] Implementare riordino gruppi (mutazione di `allTabGroups`)
- [ ] Implementare riordino tab dentro lo stesso gruppo
- [ ] Implementare spostamento tab tra gruppi (rimozione da source, insert in target alla posizione drop)
- [ ] Gestire pinned come sorgente/destinazione di spostamento tab
- [ ] Verificare manualmente: drag&drop in tutti i casi, reload conferma persistenza, DnD invalido (es. drop gruppo su tab) non cambia nulla
- [ ] Commit & push

**Done when:** L'utente può trascinare gruppi per riordinarli, trascinare tab per riordinarli o spostarli tra gruppi (incluso pinned); le modifiche persistono dopo reload.

---

## M10 — CRUD struttura (create/delete groups, delete tabs, edit URL)

**Why:** Completa il CRUD strutturale: l'editor diventa autosufficiente per costruire un workspace come l'utente lo vuole, partendo da uno snapshot e raffinandolo. Edit URL è essenziale per correggere link sbagliati senza dover ricreare il workspace dal browser.

**Approach:** Bottone "+ New group" in fondo alla lista gruppi: apre input inline per title, default color = `grey`, lista tab vuota. Icona 🗑 su gruppo header e su ogni tab, con conferma inline (riusa pattern `popup.js:withConfirmation`). Click su URL tab → input inline, validazione: deve matchare `WEB_URL_RE` (da `constants.js`). Salvataggio via `saveWorkspace`.

**Tasks:**
- [ ] Bottone "+ New group" + handler che inserisce gruppo vuoto nel payload
- [ ] Icona 🗑 su tab row con conferma inline + delete dalla lista del gruppo
- [ ] Icona 🗑 su group header con conferma inline + delete del gruppo (warn se non vuoto)
- [ ] Edit URL inline su tab row (input + Enter/Esc + validazione `WEB_URL_RE`)
- [ ] Verificare manualmente: tutte le operazioni persistono; gruppi vuoti renderizzano correttamente; URL invalido dà errore
- [ ] Commit & push

**Done when:** L'utente può creare nuovi gruppi vuoti, eliminare gruppi (anche con tab dentro, con conferma), eliminare singoli tab e modificare l'URL di un tab esistente con validazione.

---

## M11 — Visibility mode per tab + site overrides

**Why:** Visibility mode e site overrides sono parte del payload del workspace ma oggi non si possono editare se non sul workspace caricato. Esporli nell'editor permette di tunare lo snapshot prima di restorarlo, senza dover ripassare dal browser.

**Approach:** Su ogni tab row, select 3-way (push/overlay/hidden) accanto all'URL — valore corrente da `tab.visibilityMode || PUSH`. Salvataggio: se = PUSH, omettere il campo (coerente con `buildExportPayload:676`); altrimenti scrivere il valore. Per site overrides: nuovo pannello collapsibile in cima all'editor (sopra Pinned), titolo "Site overrides", lista `[hostname → CSS preview]` con icone edit/delete e bottone "+ Add". Click edit → textarea full-width per CSS (riusa stile di `popup.js:cssEditorInput`). Add → input host + textarea CSS. Tutte le mutazioni passano da `saveWorkspace`.

**Tasks:**
- [ ] Select visibility mode per tab + handler save (omettere se = PUSH)
- [ ] Pannello "Site overrides" collapsibile sopra Pinned
- [ ] Lista host→CSS con preview troncata + icone edit/delete inline
- [ ] Form add: input host + textarea CSS + validazione (host non vuoto, non duplicato)
- [ ] Editor inline CSS via textarea (Enter su Ctrl+Enter salva, Esc annulla)
- [ ] Verificare manualmente: cambio visibility mode persiste; add/edit/delete site override persistono; payload restorato applica gli overrides correttamente
- [ ] Commit & push

**Done when:** L'utente può cambiare il visibility mode di ogni tab nel workspace e gestire la lista completa di site overrides (host + CSS) salvati nel workspace; al restore, gli overrides modificati si propagano correttamente.
