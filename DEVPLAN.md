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

## M9 — Riordino e spostamento (drag & drop) ✅

**Why:** Riordino e move cross-group sono la ragione principale per cui un editor a pagina intera vale rispetto al popover. Senza questo, l'editor è solo un "rinominatore".

**Approach:** HTML5 native DnD (`draggable="true"`, `dragstart`/`dragover`/`drop`). Tre tipi di operazioni: riordina gruppi (drop su altro gruppo, before/after via `tz-drop-before|after` CSS), riordina tab dentro gruppo, sposta tab tra gruppi (incluso pinned come "gruppo virtuale"). `dragState` modulare con `{ type, sourceListType, sourceGroupIdxForTab, sourceTabIdx, sourceGroupIdx }`. Su `drop` mutazione del payload via `saveWorkspace` (read-modify-write), poi re-render full via storage onChanged. End-zone `.tab-drop-end` per ogni lista così si può droppare in coda o in gruppi vuoti. Pinned section ora sempre visibile per ricevere drop (mostra "Drop a tab here to pin it" quando vuota).

**Tasks:**
- [x] `attachTabDnD` su ogni tab row con dragstart/dragover/drop + indicatore before/after
- [x] `attachGroupDnD` su ogni group card con stessa pattern + indicatore before/after
- [x] `attachTabEndDropZone` su `.tab-drop-end` (fine pinned + fine ogni gruppo)
- [x] `commitTabMove` gestisce stesso-list shift (sposta indice se source < target nello stesso list)
- [x] `stopPropagation` su tab dragstart per non scatenare il group drag che lo contiene
- [x] `dragReset` + `clearDropIndicators` su global `dragend` per cleanup robusto
- [x] `draggable=false` su color button e inline-edit input per non rubare il drag al gruppo
- [x] Pinned section sempre visibile (anche vuota) per ricevere drop
- [ ] Verifica manuale (utente): riordino gruppi, riordino tab dentro gruppo, move tab cross-group, move tab da/per pinned, drop su gruppo vuoto, drop in coda lista
- [x] Commit & push

**Notes:** Strategy "full re-render after each save" — semplice ma OK per dati piccoli (workspace in memoria). Se la lista diventa grande (>200 tab) potremmo voler fare update incrementale; non è il caso oggi.

**Done when:** L'utente può trascinare gruppi per riordinarli, trascinare tab per riordinarli o spostarli tra gruppi (incluso pinned); le modifiche persistono dopo reload.

---

## M10 — CRUD struttura (create/delete groups, delete tabs, edit URL) ✅

**Why:** Completa il CRUD strutturale: l'editor diventa autosufficiente per costruire un workspace come l'utente lo vuole, partendo da uno snapshot e raffinandolo. Edit URL è essenziale per correggere link sbagliati senza dover ricreare il workspace dal browser.

**Approach:** Bottone "+ New group" in fondo alla lista gruppi: click → form inline (input title + Add/Cancel), default color = `grey`, lista tab vuota. Icone 🗑 + ✎ su tab row (visibili on hover/focus). Icona 🗑 su group header. Helper `inlineConfirm(triggerEl, question, onConfirm)` riusabile: sostituisce il bottone con "Question? Yes No" inline. Edit URL inline: click sull'icona ✎ del tab → l'host span viene rimpiazzato da input, validazione via `WEB_URL_RE` da `constants.js`. Group delete chiede conferma con conteggio tab. Tutto via `saveWorkspace`.

**Tasks:**
- [x] Bottone "+ New group" + form inline con Add/Cancel + insert nel payload
- [x] Icona 🗑 su tab row con `inlineConfirm` + delete dalla lista
- [x] Icona ✎ su tab row + edit URL inline con validazione `WEB_URL_RE`
- [x] Icona 🗑 su group header con conferma che mostra count dei tab dentro
- [x] Helper `inlineConfirm` riusabile (anche per M11 site overrides)
- [x] Helper `isValidWebUrl` per validazione URL
- [ ] Verifica manuale (utente): create group → appare in coda; delete tab → sparisce; delete group con N tab → conferma corretta; URL valido salva, URL invalido (es. `ftp://`) viene rifiutato
- [x] Commit & push

**Done when:** L'utente può creare nuovi gruppi vuoti, eliminare gruppi (anche con tab dentro, con conferma), eliminare singoli tab e modificare l'URL di un tab esistente con validazione.

---

## M11 — Visibility mode per tab + site overrides ✅

**Why:** Visibility mode e site overrides sono parte del payload del workspace ma oggi non si possono editare se non sul workspace caricato. Esporli nell'editor permette di tunare lo snapshot prima di restorarlo, senza dover ripassare dal browser.

**Approach:** Su ogni tab row, `<select>` 3-way (push/overlay/hidden) tra label e actions — valore corrente da `tab.visibilityMode || PUSH`. Su save: se = PUSH, `delete list[i].visibilityMode` (coerente con `buildExportPayload:676`); altrimenti assegna. Pannello "Site overrides" sopra Pinned, sempre visibile: header con count + bottone "+ Add", lista `[host → CSS preview]` con icone ✎/🗑. Editor di una row: textarea CSS + input host (readonly in edit, editabile in add). Validazione hostname tramite regex `^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$`. Mutazioni via `saveWorkspace`. Cancel/Esc → loadAndRender ricarica.

**Tasks:**
- [x] Select visibility mode per tab + handler save (omette campo se = PUSH)
- [x] Sezione "Site overrides" sopra Pinned con header + count + "+ Add"
- [x] Lista host→CSS con preview troncata (60 char) + icone edit/delete
- [x] Form add: input host + textarea CSS + check duplicato (throw → catch → flash error)
- [x] Form edit: hostname readonly + textarea CSS (cambio hostname = delete+add manuale)
- [x] Validazione hostname (`isValidHost`) per add
- [x] Hotkey Ctrl+Enter (Cmd+Enter) per save da textarea, Esc per cancel
- [x] Update README con descrizione completa dell'editor
- [ ] Verifica manuale (utente): cambio visibility mode → riapri WS, valore persiste; add override → appare in lista; edit override → CSS aggiornato; delete override → sparisce; restore del WS applica gli overrides modificati
- [x] Commit & push

**Notes:** Override "rinomina hostname" non supportata direttamente: l'utente fa delete del vecchio + add del nuovo. È il pattern più sicuro perché evita ambiguità con duplicati/conflitti.

**Done when:** L'utente può cambiare il visibility mode di ogni tab nel workspace e gestire la lista completa di site overrides (host + CSS) salvati nel workspace; al restore, gli overrides modificati si propagano correttamente.

---

## M12 — Switch a save esplicito (refactor da autosave a manual save) ✅

**Why:** L'editor oggi salva automaticamente ogni singola mutazione. Non c'è feedback chiaro sul "punto di salvataggio" e l'utente non può sperimentare modifiche senza impegnarsi. Si vuole un modello più tipico da editor: muta in memoria, vedi l'effetto, poi clicchi Save quando ti piace (o Discard per buttare via tutto).

**Approach:** Introdurre `editorState` modulare (deep copy del payload + savedAt + name iniziali, caricato a `init`). Tutti i mutator esistenti (rename WS/group, color, DnD, delete, add group, edit URL, visibility, site override) cambiano `editorState` direttamente e chiamano un re-render locale (`renderFromState()`), senza scrivere su storage. Flag `dirty` settato true ad ogni mutazione. Toolbar header (`#ws-toolbar`, già nell'HTML) ospita due bottoni: **Save** (disabled se non dirty) e **Discard** (disabled se non dirty, conferma inline). Indicatore visuale dirty: `●` accanto al nome workspace. Save: legge fresh `entry.savedAt` da storage; se diverso da `loadedSavedAt` → mostra errore "Workspace modificato esternamente" + due bottoni inline (**Discard mie modifiche** = reload da storage; **Forza overwrite** = scrivi comunque). Su save ok: `loadedSavedAt = next.savedAt`, `dirty = false`. Cmd/Ctrl+S → trigger Save. `beforeunload` listener avverte se `dirty`. Storage onChanged listener: se non dirty → reload trasparente; se dirty → mostra banner "Modifiche esterne disponibili (Discard per ricaricare)" senza forzare reload.

**Tasks:**
- [x] Introdurre `editorState = { originalName, name, loadedSavedAt, payload, dirty }` come stato modulare
- [x] Sostituire tutte le chiamate `saveWorkspace(...)` in editor.js con `applyMutation(mutator)` che muta `editorState.payload` e setta `dirty = true`
- [x] `renderFromState()` rebuilda l'UI dal `editorState` (no più read da storage durante editing)
- [x] Bottoni **Save** + **Discard** nella toolbar header con stato disabled coerente
- [x] Indicatore dirty `●` davanti al nome workspace + asterisco nel `<title>`
- [x] Save handler con concurrency check: se `entry.savedAt !== loadedSavedAt` → mostra picker inline "Discard mie modifiche" / "Forza overwrite"
- [x] Discard handler: conferma inline, poi reload da storage in `editorState`, render
- [x] Cmd/Ctrl+S keybinding → Save (preventDefault del browser)
- [x] `beforeunload` warning se `dirty`
- [x] Storage onChanged: reload trasparente se non dirty; banner se dirty
- [x] Adeguare la rinomina workspace inline: cambia solo `editorState.name` (con check storage async); Save scrive con la nuova chiave (delete vecchia + set nuova) atomicamente
- [x] Helper `commitSave({force?})`: returns `{ ok }` o `{ ok: false, conflict: 'deleted'|'modified'|'rename' }`
- [x] `savingInFlight` flag per ignorare l'eco del proprio storage write
- [ ] Verifica manuale (utente): mutate senza save → reload editor → modifiche perse; Save persiste; Discard ripristina; due editor → secondo Save mostra conflict picker; Cmd+S funziona; beforeunload avverte
- [x] Commit & push

**Notes:** Refactor invasivo ma circoscritto a `editor.js`. Il pattern `saveWorkspace` come helper di scrittura su storage rimane (Save lo chiama una volta sola). I site overrides editor (M11) avevano già un proprio Save/Cancel locale: in questo modello quei bottoni diventano "applica al state" (no più storage write); il Save globale committa. Stessa logica per il form "+ New group" di M10.

**Done when:** L'utente vede chiaramente quando ha modifiche non salvate, può salvarle con Save (o Cmd/Ctrl+S) o scartarle con Discard, e viene avvertito se chiude la tab con modifiche pendenti.

---

## M13 — Aggiunta nuovi tab (pinned + gruppi) ✅

**Why:** L'editor permette di rimuovere tab ma non di aggiungerne. Senza questa capacità un utente che parte da un gruppo vuoto (creato in M10) deve uscire dall'editor, ricreare il setup nel browser e risalvare. Con l'add diretto l'editor diventa autosufficiente.

**Approach:** Riusare l'elemento `.tab-drop-end` già in coda a ogni `.group-tabs` e `.tab-list`. Default mode: cliccabile come "+ Add tab"; durante un drag attivo continua a funzionare come drop zone (drag e click sono gesti distinti, non collidono). Click → form inline con input URL + Add/Cancel, validazione via `isValidWebUrl` (helper M10). Append `{ url, muted: false }` al list dell'editorState (M12); il commit definitivo passa dal Save globale di M12. Title non richiesto — al primo save da un browser il `t.title` reale verrà catturato via `buildExportPayload` (M7). Nell'editor il fallback è già hostname.

**Tasks:**
- [x] Estendere `.tab-drop-end` con label "+ Add tab" sempre visibile (anche con tab presenti)
- [x] Click su drop-end (fuori da drag attivo) apre form inline con input URL + Add/Cancel
- [x] Validazione URL via `isValidWebUrl` (riusa helper M10)
- [x] Mutator (via `applyMutation` di M12): append `{ url, muted: false }` al list (group tabs o pinnedTabs)
- [x] Esc cancella, Enter salva (stesso pattern di "+ New group")
- [x] Guardia "adding" che disabilita drop sulla zone mentre il form è aperto
- [ ] Verifica manuale (utente): aggiunta tab in gruppo esistente / in gruppo vuoto / in pinned; URL invalido rifiutato; drag&drop continua a funzionare sulla stessa zona; Save persiste, Discard rimuove
- [x] Commit & push

**Done when:** L'utente può aggiungere un nuovo tab a un qualsiasi gruppo (incluso un gruppo vuoto appena creato) o alla sezione pinned, fornendo solo l'URL; l'aggiunta entra nel dirty state e viene persistita al click su Save.

---

## Rework — Modello a stato singolo "foglia + hover-expand + click-pin"

**Contesto.** Si elimina il concetto di mode multipli (`PUSH`/`OVERLAY`/`HIDDEN`). La barra ha **un solo rendering** ("floating overlay") con due stati per-tab:

1. **Collassato (default)** — solo la **fogliolina in alto a sinistra**, footprint minimo. Sostituisce sia il vecchio `minimized` sia `HIDDEN`.
2. **Hover** — passando sopra la foglia, la barra si espande all'attuale look overlay; transiente (esci col mouse → ricollassa).
3. **Pin** — click sulla foglia fissa l'espanso ignorando l'hover; click di nuovo → unpin. Persistito **per-tab** (effimero, vive quanto la tab).

Decisioni prese con l'utente: (a) `HIDDEN` eliminato del tutto — la foglia è sempre presente ovunque; (b) URL rules + site overrides CSS rimossi completamente (esistevano solo per `PUSH`); (c) pin **solo per-tab**, nessun auto-pin per-sito.

**Trade-off accettato:** senza `PUSH` la pagina non viene più rifluita — la barra (quando espansa/pinnata) **copre** una striscia di contenuto in alto. È il compromesso classico dell'overlay, ora opt-in per-tab.

Refactor sottrattivo che tocca: `constants.js`, `content.js`, `page-shift.js`, `site_overrides.js` (rimosso), `render.js`, `content.css`, `popup.js`, `popup.html`, `editor.js`, `background.js`, `manifest.json`.

---

## M14 — Collasso dei mode in un solo comportamento ✅

**Why:** Tre mode con override per-tab, regole per URL e priorità di risoluzione sono la radice della complessità. Prima di toccare l'estetica si riduce il modello a uno stato unico, così tutto il resto poggia su basi semplici.

**Approach:** `content.js` boot smette di calcolare il mode via priorità (`STORAGE_KEY_VISIBILITY_MODE` → rules → default): la barra è sempre in floating overlay. `page-shift.js` viene svuotato di tutta la macchina `PUSH` (padding body, safe-areas CSS, header shifting, bottom clipper, `data-tz-*` attrs); `applyPageShift` resta come **no-op** (l'overlay non riflette mai la pagina) per non dover toccare tutti i call site. `applyVisibilityState`/`syncMinimizeButtonUI` semplificate al singolo caso (resta il vecchio bottone minimize fino a M15).

**Sequencing (deciso in esecuzione):** `VISIBILITY_MODES` (`constants.js`) e `window.currentVisibilityMode` **NON** vengono rimossi in M14 — sono referenziati da 9 file (anche `zoom.js`, `popup.js`, `editor.js`, `site_overrides.js`). Rimuoverli ora renderebbe lo stato intermedio non caricabile (ReferenceError). Restano come **shim**: `currentVisibilityMode` fissato a `OVERLAY`, così i rami `=== OVERLAY` continuano a funzionare e i rami `=== PUSH/HIDDEN` diventano codice morto (mai presi). La rimozione vera dei simboli avviene in M16 insieme alla pulizia dei consumer UI.

**Mode di esecuzione: IDD** (deviazione dal TDD richiesto). M14 è una deletion strutturale senza nuovo contratto di logica pura: la verifica vera è integrazione/manuale (la barra fa overlay senza shift su pagina reale). Si implementa, poi si coprono gli **invarianti** con unit test (harness Node `--test` + `vm`, zero dipendenze): `applyPageShift` non riflette mai la pagina e non schedula header-shift. Il valore TDD pieno è in M15 (mappa pin) e M16 (payload retro-compat).

**Tasks:**
- [x] `content.js`: rimuovere la risoluzione del mode al boot (rules/overrides/hidden); la barra è sempre floating overlay
- [x] `page-shift.js`: rimuovere padding body, `ensureSafeAreasStyle`/`setInlineSafeAreasFallback`, header shifting, bottom clipper; `applyPageShift` → no-op
- [x] `render.js`: semplificare `applyVisibilityState`/`syncMinimizeButtonUI` al singolo stato (no rami PUSH/HIDDEN)
- [x] `constants.js`: `VISIBILITY_MODES` mantenuto come shim (rimozione in M16); rimossi solo gli attrs push-only ora inutilizzati se sicuro
- [x] Harness di test zero-dep (`tests/helpers/harness.js`) + unit test invarianti `applyPageShift`
- [ ] Verifica manuale (utente): su qualsiasi sito la barra appare in overlay senza spostare il contenuto; nessun errore in console
- [x] Commit & push

**Done when:** Esiste un solo comportamento di rendering (floating overlay): la macchina PUSH/HIDDEN è rimossa e `applyPageShift` non riflette più la pagina. `VISIBILITY_MODES` resta come shim (rimosso in M16); estetica invariata.

---

## M15 — Estetica foglia + hover-expand + click-pin per-tab ✅

**Why:** È il cuore della nuova UX: barra sempre collassata a una foglia in alto a sinistra, che si espande on-hover e si fissa al click.

**Approach:** Stato collassato `.tz-leaf` su `#ungroup-automatic-tab-bar`: mostra solo un chip con la fogliolina (riuso asset `icon128.png`/`logo.png` o SVG inline), nasconde gli altri figli (riadatta la regola `content.css:918`). `.tz-leaf:hover` espande al look overlay attuale (transizione su width/opacity dei figli) — quasi tutto CSS, nessuna macchina JS nuova. Click sulla foglia → toggle classe `.tz-pinned` che forza l'espanso a prescindere dall'hover. Persistenza per-tab: si **riusa la mappa esistente invertendone la semantica** — si rinomina `STORAGE_KEY_MINIMIZED_BY_TAB` → `STORAGE_KEY_PINNED_BY_TAB` (`tz_pinned_by_tab`), default unpinned (collassato). `toggleMinimizedState`/`applyMinimizedState` diventano `togglePinned`/`applyPinnedState`. Il vecchio bottone `.tz-minimize-btn` (`‹/›/+/◻`) viene sostituito dal chip-foglia come unico affordance (hover = peek, click = pin).

**Esecuzione:** logica pura del pin in **TDD** (helper `isTabPinned`/`nextPinnedMap` in `constants.js`, test `tests/pin-state.test.js`); wiring DOM/CSS in IDD (verifica manuale). Il collasso usa `#bar:not(.tz-pinned):not(:hover)` (non un `.tz-leaf:hover` separato): hover **e** pin condividono lo stesso espanso. Default = collassato (assenza di classe), non serve una classe per lo stato base. Foglia = **SVG inline** (`TZ_LEAF_SVG`, `currentColor`), niente fetch. Niente `applyPinnedState`: il default-collassato si gestisce in `applyVisibilityState` (toggle `.tz-pinned` da `isTabPinned`). Pulite anche le var morte del vecchio minimize button (`--tz-min-w`, `--tz-min-font`, `--tz-minimized-w`, `BASE.MINIMIZED_W`).

**Tasks:**
- [x] `content.css`: stato `.tz-leaf` (chip foglia in alto a sinistra) + collasso `:not(.tz-pinned):not(:hover)` + transizioni
- [x] `content.css`: `.tz-pinned` (e `:hover`) forzano l'espanso
- [x] `render.js`: sostituire `.tz-minimize-btn` con il chip-foglia `createLeaf`; click → `togglePinned(tabId)`
- [x] `render.js`: `toggleMinimizedState`→`togglePinned`, `setBarMinimized`→`setBarPinned`, `syncMinimizeButtonUI`→`syncLeafUI`; rimosso `applyMinimizedState` (morto); default invertito (collassato = assenza chiave)
- [x] `constants.js`: `STORAGE_KEY_MINIMIZED_BY_TAB` → `STORAGE_KEY_PINNED_BY_TAB` (`tz_pinned_by_tab`); helper puri + `TZ_LEAF_SVG`
- [x] Asset foglia: **SVG inline** `TZ_LEAF_SVG`
- [x] Unit test pin-state (TDD: rosso→verde) + pulizia var CSS morte
- [ ] Verifica manuale (utente): default = solo foglia; hover espande e ricollassa al leave; click pinna (resta espansa anche senza hover); click di nuovo unpin; il pin è per-tab e si resetta a tab chiusa
- [x] Commit & push

**Done when:** La barra è collassata a una foglia in alto a sinistra, si espande on-hover come overlay, e un click la fissa/sfissa per quella tab.

---

## M16 — Rimozione rules, site overrides e pulizia UI (popup + editor) con retro-compat ✅

**Why:** Eliminato PUSH, le URL rules e i site overrides CSS non hanno più scopo. Vanno rimossi da storage, popup ed editor, mantenendo la retro-compatibilità sui workspace già salvati.

**Approach:** `site_overrides.js` rimosso (file + entry in `manifest.json` web-accessible + injection in `background.js`). In `popup.js`/`popup.html` si elimina la sezione regole per dominio (`initDomainRulesSection`, `getMatchingRule`, dropdown push/overlay/hidden). In `editor.js` (M11) si rimuovono il `<select>` visibility-mode per-tab e il pannello "Site overrides". **Retro-compat:** al restore/import, i campi `visibilityMode` e `siteOverrides` nei workspace salvati vengono **letti e ignorati** (nessun crash); `buildExportPayload` smette di scriverli. Chiave `STORAGE_KEY_OVERRIDES` rimossa dai punti d'uso.

**Esecuzione (IDD + regressione):** rimozione strutturale ampia (9 file). Si è anche completata la rimozione dei simboli shim lasciati da M14 — `VISIBILITY_MODES`, `STORAGE_KEY_VISIBILITY_MODE/RULES/HIDDEN_BY_TAB/OVERRIDES`, `globToRegex`, `window.currentVisibilityMode`, `setVisibilityMode`, gli attrs push-only — dopo aver pulito `zoom.js` (rimossa `ensureSizingStyle` PUSH-only; le CSS var arrivano comunque da `applyZoomCompensatedMetrics`). Permesso `scripting` rimosso dal manifest (serviva solo all'injection). Test di regressione retro-compat su `normalizeImportedWorkspaceJson` (`tests/workspace-retrocompat.test.js`): un workspace legacy con `siteOverrides`/`visibilityRules`/`visibilityMode` viene accettato e i campi ignorati. Verifica: sintassi di tutti i file + grep-guard zero-orfani + 7/7 test verdi.

**Deferred (fuori scope core, annotato):** i sender `REFRESH_BAR` (`broadcastRefresh`/`broadcastRefreshWithRetry`/`REFRESH_TAB` in `background.js`, e il send in `popup.js`) erano consumati **solo** da `site_overrides.js`; ora sono no-op guardati da try/catch (la barra si ri-renderizza via port/eventi, mai dipesa da `REFRESH_BAR` lato content). Lasciati invariati per non toccare codice deep-wired; rimozione rinviata.

**Tasks:**
- [x] Rimuovere `site_overrides.js`; togliere entry da `manifest.json` (web-accessible resources) e l'injection in `background.js`
- [x] `popup.js`/`popup.html`: rimuovere sezione regole per dominio + dropdown mode + helper `getMatchingRule`/`saveRule`/`getModeForTab`/`initDomainRulesSection`/`migrateHiddenSitesToRules`/`showToggleMessage`/`getHostname`
- [x] `editor.js`: rimuovere `<select>` visibility per-tab e pannello "Site overrides" (form add/edit, validazione host); pulite anche le regole CSS morte in `editor.css`
- [x] `editor.js`/`background.js`: `buildExportPayload` smette di emettere `visibilityMode`/`siteOverrides`; restore/import ignorano i campi legacy senza errori
- [x] `constants.js`: rimossi `STORAGE_KEY_OVERRIDES`, `VISIBILITY_MODES`, `STORAGE_KEY_VISIBILITY_MODE/RULES/HIDDEN_BY_TAB`, `globToRegex`, attrs push-only; `zoom.js`/`page-shift.js` ripuliti dallo shim
- [x] Test di regressione retro-compat (`tests/workspace-retrocompat.test.js`)
- [x] `README.md`: aggiornata la descrizione (niente più mode/regole/overrides; modello foglia + pin)
- [ ] Verifica manuale (utente): restore di un workspace vecchio (con `visibilityMode`/`siteOverrides`) funziona senza errori e ignora quei campi; popup ed editor non mostrano più mode/regole/overrides
- [x] Commit & push

**Done when:** URL rules e site overrides sono rimossi da codice, storage e UI; i workspace salvati in precedenza si restorano senza errori ignorando i campi obsoleti.

---

## M17 — Cleanup sender `REFRESH_BAR` orfani + import JSON tollerante ✅

**Why:** Dopo M16 i broadcast `REFRESH_BAR`/`REFRESH_TAB` non hanno più alcun consumer lato content (erano consumati solo da `site_overrides.js`): sono no-op guardati che sporcano `background.js`. Inoltre l'import dei workspace fa controlli rigidi (versione `wv`, tipi di `pinnedTabs`/`allTabGroups`) che rifiutano file con "roba nuova": vogliamo invece **ignorare serenamente** i campi sconosciuti, così vecchi e futuri JSON restano compatibili.

**Approach:** In `background.js` rimuovere l'intero chain di refresh-broadcast: `broadcastRefresh`, `broadcastRefreshWithRetry`, `scheduleUiRefresh` (+ 7 call site), le costanti `UI_REFRESH_RETRY_MS`/`UI_REFRESH_DEBOUNCE_MS`, la mappa `uiRefreshTimers`, e l'handler messaggio `REFRESH_TAB`. La barra continua ad aggiornarsi via focus/azioni utente (non è mai dipesa da `REFRESH_BAR` lato content). In `popup.js`, `normalizeImportedWorkspaceJson` diventa tollerante: richiede solo che il JSON sia un oggetto; accetta qualsiasi `wv`; usa `raw.payload` se è un oggetto, altrimenti tratta `raw` stesso come payload; nessun reject su campi extra o tipi (il restore in `background.js` già guarda con `Array.isArray`). Rimuovere `SUPPORTED_VERSIONS`/check di versione.

**Esecuzione:** TDD sulla logica pura `normalizeImportedWorkspaceJson` (estende `tests/workspace-retrocompat.test.js`: versione futura + campi extra → accettati; non-oggetto → rifiutato; payload "bare" senza wrapper → accettato). Il cleanup di `background.js` è strutturale (verifica: sintassi + grep-guard, nessun ref orfano a `REFRESH_BAR`/`REFRESH_TAB`/`scheduleUiRefresh`).

**Tasks:**
- [x] `background.js`: rimuovere `broadcastRefresh`/`broadcastRefreshWithRetry`/`scheduleUiRefresh` + 7 call site + costanti `UI_REFRESH_*` + `uiRefreshTimers` + handler `REFRESH_TAB`
- [x] `popup.js`: `normalizeImportedWorkspaceJson` tollerante (no version check, no type-reject, ignora campi sconosciuti); rimuovere `SUPPORTED_VERSIONS`
- [x] Estendere i test (forward-compat: versione/campi nuovi ignorati; non-oggetto rifiutato; bare payload ok)
- [x] Verifica: sintassi tutti i file + grep-guard + test verdi (10/10)
- [x] Commit & push

**Done when:** Nessun sender `REFRESH_BAR`/`REFRESH_TAB` resta in `background.js`; l'import accetta qualunque JSON workspace-shaped ignorando i campi che non conosce (vecchi e futuri file compatibili).

---

## M18 — Doppio-click sulla foglia = nascondi del tutto (per-tab) + toggle nel popup ✅

**Why:** Reintroduce un modo per azzerare del tutto il footprint della barra su una tab specifica (l'equivalente del vecchio "hidden", ma come gesto diretto). La foglia, una volta nascosta, non c'è più: la riattivazione avviene dal popup.

**Approach:** **Gesto foglia:** single-click = pin (esistente), double-click = nascondi. Disambiguazione con timer ~250ms: al `click` parte un `setTimeout(togglePinned, 250)`; un `dblclick` fa `clearTimeout` ed esegue invece l'hide. **Stato hidden:** mappa per-tab effimera `tz_pinned`-style → nuova chiave `STORAGE_KEY_HIDDEN_BY_TAB` (`tz_hidden_by_tab`), default visibile. Classe `.tz-hidden` sulla barra con `display:none !important` (vince su collapse/pin). Helper puri `isTabHidden(map, tabId)` + `nextHiddenMap(map, tabId, hidden)` (set true / delete) in `constants.js`. **Boot:** `content.js` legge anche `tz_hidden_by_tab` e applica `.tz-hidden` (no flash). **Live:** `content.js` aggiunge un `chrome.storage.onChanged` che, al cambiare di `tz_hidden_by_tab` per la tab corrente, toggla `.tz-hidden` (così il "Mostra" dal popup funziona senza reload, dato che il listener messaggi è stato rimosso in M16). **Popup:** toggle sempre presente "Nascondi/Mostra barra su questa tab" (richiede di nuovo `chrome.tabs.query` per tab+stato; disabilitato sulle pagine di sistema). Scrive `tz_hidden_by_tab`. **Cleanup tab:** `background.js onRemoved` pulisce anche `tz_hidden_by_tab`.

**Esecuzione:** TDD sugli helper puri (`isTabHidden`/`nextHiddenMap`), poi IDD sul wiring DOM/popup/CSS (verifica manuale).

**Tasks:**
- [x] `constants.js`: `STORAGE_KEY_HIDDEN_BY_TAB` (`tz_hidden_by_tab`) + helper puri `isTabHidden`/`nextHiddenMap`
- [x] Unit test helper hidden (TDD rosso→verde) — `tests/hidden-state.test.js`
- [x] `render.js` `createLeaf`: timer 250ms su click (pin) + `dblclick` → `hideTab(tabId)` (set hidden true, applica `.tz-hidden`, persiste)
- [x] `content.css`: `#bar.tz-hidden { display:none !important }`
- [x] `content.js` boot: leggere `tz_hidden_by_tab` e applicare `.tz-hidden`; aggiunto `chrome.storage.onChanged` per sync live (+ `requestTabList` al re-show)
- [x] `popup.html`/`popup.js`/`popup.css`: toggle "Nascondi/Mostra barra su questa tab" (stato da `tz_hidden_by_tab`, disabilitato su system page)
- [x] `background.js onRemoved`: pulizia `tz_hidden_by_tab` (insieme a `tz_pinned_by_tab`)
- [ ] Verifica manuale (utente): doppio-click sulla foglia nasconde la barra; single-click pinna ancora; dal popup "Mostra" la fa riapparire live; stato per-tab si resetta a tab chiusa
- [x] Commit & push

**Done when:** Un doppio-click sulla foglia nasconde completamente la barra per quella tab; il popup offre un toggle per nascondere/mostrare e il "Mostra" la riattiva live senza reload.

---

## M19 — Rifinitura estetica foglia collassata ✅

**Why:** Da collassata la foglia mostra ancora il box scuro della barra e ha un margine ampio dall'angolo. Vogliamo la foglia che "galleggia" pulita vicino all'angolo in alto a sinistra.

**Approach:** Solo CSS, scoped allo stato collassato (`:not(.tz-pinned):not(:hover)`), così l'espanso resta invariato (fondo scuro per leggibilità). Sfondo trasparente + niente `border-bottom` + `height:auto` + piccolo `padding` (2px) per un margine minimo dall'angolo; reset dei margini della `.tz-leaf` in stato collassato. Nessun test (cosmetico).

**Tasks:**
- [x] `content.css`: stato collassato → `background:transparent`, `border-bottom:none`, `height:auto`, `padding:2px`; `.tz-leaf` margini azzerati da collassata
- [ ] Verifica manuale (utente): da collassata solo la foglia, trasparente, vicino all'angolo; espansa invariata
- [x] Commit & push

**Done when:** Da collassata la barra non mostra più il box scuro e la foglia sta vicina all'angolo in alto a sinistra; lo stato espanso/pinnato è invariato.

---

## M20 — Pulizia CSS/marker morti residui ✅

**Why:** Dopo M16/M18 sono rimaste regole CSS morte (UI rules/overrides rimossa) più alcune feature CSS pre-esistenti mai più usate, e un class-marker `tz-mode-overlay` aggiunto in JS ma senza regola né lettori.

**Approach:** Cross-reference dei selettori con l'uso reale in tutti i `*.js`/`*.html` (no tests). `popup.css` riscritto tenendo solo le regole vive (container, workspaces, `.workspace-action-icon`, `.note`, `.std-input`, msg-box, `.control-group` [form import], `.panel`/`.vis-toggle`, `.btn-icon`+`.success`, `.rule-actions`, `.input-row` — questi ultimi tre ancora usati dai form inline rename/import/conferma). Rimossi: `#toggleBar`, `a.export-link`, `.presets-*`/`.preset-*`, `select#visibilityModeSelect`, `.workspace-row`/`-view-state`/`-actions-state`, `.gear-btn`, `#tz-rule-mode-select`, `.domain-rules-section`/`.section-header`/`.domain-badge`, `.active-rules-list`/`.rule-row`/`.mode-*`/`.pattern-*`/`.edit-mode-select`, `.btn-icon.add`/`.delete`, `details.advanced-section`/`.advanced-content`. Rimosse anche le 2 aggiunte di `tz-mode-overlay` in `content.js`/`render.js` (marker morto). `content.css`/`editor.css` già privi di selettori della rework.

**Tasks:**
- [x] `popup.css`: riscritto, sole regole vive
- [x] `content.js`/`render.js`: rimosso `classList.add('tz-mode-overlay')` (marker senza CSS né lettori)
- [x] Verifica: grep-guard zero-orfani + sintassi + 13/13 test verdi
- [x] Commit & push

**Done when:** Niente più CSS/marker morti legati alla rework (o a feature rimosse in precedenza); UI viva invariata.

---

## M21 — Eliminazione di `page-shift.js` (interamente vestigiale) ✅

**Why:** Dopo M14 `applyPageShift` era un no-op e `isInternalResize` non veniva mai più messo a `true` (costante `false`): l'intero `page-shift.js` era codice morto, e le sue chiamate/guardie erano rumore.

**Approach:** Rimosse le 4 chiamate `applyPageShift()` (`render.js` ×2, `content.js`, `zoom.js`) e le 2 guardie su `isInternalResize` (`content.js` resize handler, `render.js updateDynamicLayout`, sempre nel ramo "non interno"). `page-shift.js` risultava vuoto → **file eliminato** e tolto dal manifest `content_scripts`. Rimosso `tests/page-shift.test.js` (l'invariante "no reflow" è ora banalmente vera: non esiste più codice di reflow). `content.css`/`editor.css` già puliti; costanti tutte ancora usate (`SYSTEM_PREFIXES` lo usa `isSystemPage`). Scelto di NON rinominare `.btn-icon`/`.rule-actions` (componenti vivi) né fare audit completo di `content.css` (rischio/poco valore).

**Tasks:**
- [x] Rimuovere chiamate `applyPageShift()` + guardie `isInternalResize`
- [x] Eliminare `page-shift.js` + entry nel manifest + `tests/page-shift.test.js`
- [x] README: rimosse le menzioni di `page-shift.js`
- [x] Verifica: sintassi + manifest + grep-guard + 11/11 test verdi
- [x] Commit & push

**Done when:** `page-shift.js` non esiste più, nessun riferimento residuo, e l'estensione resta funzionante (la barra è overlay puro, mai reflow).

---

## M22 — Rimozione funzioni morte ✅

**Why:** Scan delle funzioni top-level mai referenziate: due funzioni morte (pre-esistenti, non dalla rework).

**Approach:** Rimosse `promptForUniqueWorkspaceName` (`popup.js`, usava `prompt()` nativo, mai chiamata — la UI usa form inline) e `openNewTab` (`background.js`, duplicato inutilizzato: l'handler `OPEN_NEW_TAB` fa già `chrome.tabs.create` inline).

**Tasks:**
- [x] Rimuovere `promptForUniqueWorkspaceName` (popup.js) e `openNewTab` (background.js)
- [x] Verifica: sintassi + grep-guard + 11/11 test verdi
- [x] Commit & push

**Done when:** Nessuna funzione top-level morta nei moduli principali; UI/comportamento invariati.

---

## M23 — Transizione fluida collasso↔espansione della foglia ✅

**Why:** Il passaggio collassato↔hover era istantaneo (snap della posizione della foglia), perché lo stato collassato usava `height:auto` (non animabile) e `border:none`.

**Approach:** Solo CSS. Stato collassato con **altezza fissa** (`calc(var(--tz-h) - var(--tz-search-diff) + 4px)`, non `auto`) e `border-bottom-color:transparent` (mantiene 1px di larghezza, animabile) invece di `border:none`. Aggiunta `transition` sulla barra base (`height`/`padding`/`background-color`/`border-color`, 160ms ease) e sulla `.tz-leaf` (aggiunto `margin`). La larghezza resta istantanea (la foglia è ancorata a sinistra, non dipende dalla width). Risultato: la foglia scivola (~3px giù, ~4px destra) e il box sfuma, invece di saltare. Mantenuto il "vicino all'angolo" di M19.

**Tasks:**
- [x] `content.css`: collasso ad altezza fissa + `border-bottom-color:transparent`; `transition` su barra e foglia
- [ ] Verifica manuale (utente): hover/leave fa scivolare la foglia in modo fluido; pin/unpin idem; nessuno snap
- [x] Commit & push

**Done when:** Il passaggio foglia↔barra (hover, pin/unpin) è animato in modo fluido invece di istantaneo.

---

## M24 — Review/tidy CSS ✅

**Why:** Richiesta una review del CSS per ordine/ottimizzazione.

**Approach:** Analisi di `content.css` (≈968 righe), `editor.css`, `popup.css`. `!important`/`all:initial` in `content.css` sono **difensivi e voluti** (iniettato in pagine arbitrarie) → non toccati. Applicate solo modifiche sicure e verificabili (brace-balance + grep), il resto segnalato.

**Applicato:**
- `content.css`: `.tz-search.expanded` era frammentato in **3 blocchi** (con `padding-left/right` letteralmente duplicati) → unificato in un solo blocco.
- `content.css`: brand blue `#0078d4` (13 occorrenze) centralizzato in custom property `--tz-accent` definita sulla regola base della barra (namespaced per evitare clash nel contesto iniettato; cascata ai discendenti). Funzionalmente identico (la var risolve allo stesso valore).

**Segnalato, NON applicato (richiede verifica nel browser / poco valore):**
- Selettori "duplicati" residui (`.tz-close-x`, `.tz-group-btn`, `.tz-leaf`, `.tz-search:not(.expanded) .icon`) sono **falsi positivi**: stesso selettore una volta standalone e una volta in un gruppo `,` condiviso (transition/hover-brighten) — pattern normale, non ridondante.
- Selettori identici definiti in **sezioni distanti** (es. `.tz-close-x` riga ~33 "struttura/colore" e ~681 "sizing"): unibili ma settano proprietà non sovrapposte, separati per concern — merge rischioso senza browser, lasciati.
- Altri colori ripetuti (`#fff` 15×, `#3a3a3a` 9×, `#444`/`#333` 6×): centralizzabili in var, ma valore marginale → lasciati.
- `editor.css` già ordinato (usa già `--accent`).

**Tasks:**
- [x] Consolidare `.tz-search.expanded` (3→1 blocchi)
- [x] Centralizzare `#0078d4` → `var(--tz-accent)` (13×) con def sulla barra
- [x] Verifica: brace-balance + grep + 11/11 test verdi
- [x] Commit & push

**Done when:** Rimosse le duplicazioni CSS sicure e centralizzato il colore accent; il resto documentato come scelte consapevoli.

---

## M25 — Fix: glide della foglia simmetrico (transform invece di layout) ✅

**Why:** La transizione di M23 animava `height`/`padding` della barra **insieme** ai cambi istantanei di `width`/`display` dei figli: il reflow non era simmetrico tra andata e ritorno → movimento "non speculare", fastidioso.

**Approach:** Disaccoppiare il movimento della foglia dal layout. La barra ha ora **geometria identica** in collassato ed espanso (stessa `height`/`padding`/`margin`); il collassato cambia solo `background`/`border-color` (fade) e `width:auto` (istantaneo, non muove la foglia che è left-anchored). La foglia si sposta **solo via `transform: translate(-4px,-3px)`** in stato collassato, con `transition: transform 160ms` → animazione GPU, single-property, **perfettamente speculare** con lo stesso easing nei due versi. Rimosse le transition layout (`height`/`padding`/`margin`).

**Tasks:**
- [x] Barra: `transition` ridotta a `background-color`/`border-color`; rimossi override `height`/`padding` nel collasso
- [x] Foglia: `transition transform 160ms`; collasso → `transform: translate(-4px,-3px)` invece di `margin:0`
- [x] Tuning (richiesta utente): glide più morbido e lento — `transform 240ms cubic-bezier(0.4,0,0.2,1)` + `will-change:transform`; fade barra 220ms
- [ ] Verifica manuale (utente): andata e ritorno della foglia identici (speculari), movimento smooth
- [x] Commit & push

**Done when:** Il glide della foglia è simmetrico tra hover-in e hover-out (e pin/unpin), senza scatti.

---

## M26 — Foglia fuori dal flusso (position:absolute) per glide davvero smooth ✅

**Why:** Anche con `translate3d`/`will-change` il movimento restava a scatti: la foglia, essendo flex-child di una barra con `overflow:hidden` che riflette (width + `display` dei figli) ad ogni hover, non riusciva a stare stabilmente su un layer GPU → il `transform` veniva ridipinto sul main thread insieme al reflow.

**Approach (opzione 1, scelta dall'utente):** la foglia diventa `position:absolute` dentro la barra (`left:var(--tz-gap-sm)`, `top:calc(var(--tz-search-diff)/2)` per il centraggio verticale), quindi **fuori dal flusso flex**: il reflow della barra non tocca più il suo layer e il glide gira puro sul compositor. Per fare spazio al contenuto: var `--tz-leaf-zone` (ingombro foglia) usata come `padding-left` della barra (il contenuto flowed parte a destra della foglia) e come **larghezza fissa del collassato** (non `auto`, così `overflow:hidden` non clippa la foglia). Glide invariato: `translate3d(-4px,-3px,0)` ↔ `0`, easing ease-out 280ms.

**Tasks:**
- [x] `.tz-leaf` → `position:absolute` (left/top), rimossi i margini; `z-index:1`
- [x] Barra: var `--tz-leaf-zone` + `padding-left` per liberare il contenuto; collassato `width:var(--tz-leaf-zone)`
- [x] Verifica: braces + JS (`querySelector('.tz-leaf')`/click intatti) + 11/11 test
- [ ] Verifica manuale (utente): glide finalmente smooth (foglia su layer indipendente); contenuto e click a posto
- [x] Commit & push

**Done when:** Il movimento della foglia è smooth perché animato su un layer indipendente dal layout/reflow della barra.
