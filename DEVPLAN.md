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
