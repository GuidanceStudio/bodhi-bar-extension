/**
 * DRAG-DROP.JS - Drag and drop handling for tabs and groups
 */

const dragState = {
  sourceType: null,
  sourceTabId: null,
  sourceKind: null,
  sourceGroupId: null,
  sourceGroupTileId: null,
  overEl: null,
  placement: null,
  lastTargetId: null,
};

function closestDraggableTabEl(node) {
  if (!node || !node.closest) return null;
  return node.closest(
    '[data-tz-draggable="tab"][data-tabid], [data-tz-draggable="group"][data-groupid]'
  );
}

function clearDropIndicator() {
  if (!dragState.overEl) return;
  dragState.overEl.classList.remove('tz-drop-before', 'tz-drop-after');
  dragState.overEl.style.boxShadow = '';
  dragState.overEl = null;
  dragState.placement = null;
}

function setDropIndicator(el, placement) {
  if (!el) return;
  if (dragState.overEl && dragState.overEl !== el) clearDropIndicator();
  dragState.overEl = el;
  dragState.placement = placement;
  el.classList.toggle('tz-drop-before', placement === 'before');
  el.classList.toggle('tz-drop-after', placement === 'after');
  el.style.boxShadow = (placement === 'before')
    ? `inset 0 2px 0 0 ${INDICATOR_COLOR}`
    : `inset 0 -2px 0 0 ${INDICATOR_COLOR}`;
}

function canDropOn(targetEl) {
  if (!targetEl) return false;
  if (dragState.sourceType === 'group') {
    if (targetEl.dataset.groupid === dragState.sourceGroupTileId) return false;
    if (targetEl.dataset.tzDraggable !== 'group') return false;
    if (navigationState !== NAV_LEVELS.LEVEL_2) return false;
    const tgtId = targetEl.dataset.groupid || '';
    return !!tgtId && tgtId !== String(dragState.sourceGroupTileId || '');
  }

  const targetKind = targetEl.dataset.tzKind || '';
  if (!dragState.sourceTabId || !dragState.sourceKind) return false;
  if (targetEl.dataset.tabid === dragState.sourceTabId) return false;
  if (targetKind !== dragState.sourceKind) return false;
  if (dragState.sourceKind === 'group') {
    const tgtG = targetEl.dataset.groupid || '';
    return !!tgtG && tgtG === (dragState.sourceGroupId || '');
  }
  return true;
}

async function handleMoveTab(sourceTabId, targetTabId, placement) {
  suppressClickUntil = Date.now() + 700;
  if (dragState.sourceType === 'group') {
    await safeRuntimeSendMessageWithRetry({
      action: 'MOVE_GROUP',
      groupId: Number(sourceTabId),
      targetGroupId: Number(targetTabId),
      placement
    }, 3);
  } else {
    await safeRuntimeSendMessageWithRetry({
      action: 'MOVE_TAB',
      tabId: Number(sourceTabId),
      targetTabId: Number(targetTabId),
      placement
    }, 3);
  }
  handleStateChange();
}

function installDragAndDropHandlers() {
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;
  if (bar.dataset.tzDndInstalled === '1') return;
  bar.dataset.tzDndInstalled = '1';

  bar.addEventListener('dragstart', (e) => {
    const el = closestDraggableTabEl(e.target);
    if (!el) return;

    if (el.dataset.tzDraggable === 'group') {
      dragState.sourceType = 'group';
      dragState.sourceGroupTileId = el.dataset.groupid;
      dragState.sourceTabId = null;
      dragState.sourceKind = null;
      dragState.sourceGroupId = null;
    } else {
      dragState.sourceType = 'tab';
      dragState.sourceTabId = el.dataset.tabid;
      dragState.sourceKind = el.dataset.tzKind || null;
      dragState.sourceGroupId = el.dataset.groupid || null;
      dragState.sourceGroupTileId = null;
    }

    el.classList.add('tz-dragging');
    el.style.opacity = '0.65';
    suppressClickUntil = Date.now() + 700;

    try {
      e.dataTransfer.effectAllowed = 'move';
      const payload = (dragState.sourceType === 'group') ? (dragState.sourceGroupTileId || '') : (dragState.sourceTabId || '');
      e.dataTransfer.setData('text/plain', payload);
    } catch { /* ignore */ }
  }, true);

  bar.addEventListener('dragover', (e) => {
    if (!dragState.sourceTabId && !dragState.sourceGroupTileId) return;
    const el = closestDraggableTabEl(e.target);
    if (!el) return;
    if (!canDropOn(el)) return;

    e.preventDefault(); // required to allow drop

    const r = el.getBoundingClientRect();
    const mid = r.top + (r.height / 2);
    const placement = (e.clientY < mid) ? 'before' : 'after';
    setDropIndicator(el, placement);
  }, true);

  bar.addEventListener('drop', (e) => {
    if (!dragState.sourceTabId && !dragState.sourceGroupTileId) return;
    const el = closestDraggableTabEl(e.target);
    if (!el || !canDropOn(el)) return;

    e.preventDefault();

    const targetTabId = (dragState.sourceType === 'group') ? el.dataset.groupid : el.dataset.tabid;
    const placement = dragState.placement || 'before';

    dragState.lastTargetId = targetTabId;
    clearDropIndicator();
    const sourceId = (dragState.sourceType === 'group') ? dragState.sourceGroupTileId : dragState.sourceTabId;
    handleMoveTab(sourceId, targetTabId, placement).catch(() => {});
  }, true);

  bar.addEventListener('dragend', () => {
    const dragging = bar.querySelector('.tz-dragging');
    if (dragging) {
      dragging.classList.remove('tz-dragging');
      dragging.style.opacity = '';
    }
    clearDropIndicator();
    dragState.sourceType = null;
    dragState.sourceTabId = null;
    dragState.sourceKind = null;
    dragState.sourceGroupId = null;
    dragState.sourceGroupTileId = null;
    dragState.lastTargetId = null;
    suppressClickUntil = Date.now() + 500;
  }, true);
}
