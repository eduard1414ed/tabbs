// Drag and drop in the panel: what is dragged, where the pointer is, the insertion line,
// opening a collapsed folder on hover. What a drop does is decided by the panel
// (resolve) and done by it (perform).
//
// Source — { kind: 'link', id } | { kind: 'folder', id } | { kind: 'tab', tabId } | { kind: 'external' }
//   (an address from the address bar or a page) | { kind: 'space', id }   (an icon of the bar).
// Target — { area: 'tree', kind: 'link' | 'folder' | 'root', id, zone }   (root: the empty space
//   below the tree, id null) | { area: 'tabs', tabId, zone }   (tabId null: after the last tab)
//   | { area: 'tiles', id, zone }   (id null: the end of the favorites, or the empty place for them)
//   | { area: 'spaces', id, zone }   (the bar's icons: onto one — 'inside', an icon dragged along
//   the bar — 'before' / 'after').
// A tile is dragged as the link it is. A pair of tabs below the divider is not dragged; dropped
// before it — before its left tab, after it — after its right one.
// With `canSplit` the middle of a tab or link row is `onto` (split view); if the panel says
// nothing can go there, the row is split in halves as usual (`halfZone`).
//
// Our own drags carry the source in the type name ("application/x-tabbs-link-123"):
// while dragging, only the types can be read, not the data, and a panel of another
// window must be able to tell what comes too.

import { dropZone } from './lib/drop.js';

const TYPE_PREFIX = 'application/x-tabbs-';
const HOVER_EXPAND_MS = 600;

const sourceType = (source) =>
  TYPE_PREFIX + (source.kind === 'tab' ? `tab-${source.tabId}` : `${source.kind}-${source.id}`);

function readSource(dataTransfer) {
  const types = [...dataTransfer.types];
  const own = types.find((type) => type.startsWith(TYPE_PREFIX));
  if (own) {
    const [kind, ...rest] = own.slice(TYPE_PREFIX.length).split('-');
    const value = rest.join('-');
    if (kind === 'tab') return { kind, tabId: Number(value) };
    if (kind === 'link' || kind === 'folder' || kind === 'space') return { kind, id: value };
    return null;
  }
  if (types.includes('text/uri-list') || types.includes('text/plain')) return { kind: 'external' };
  return null;
}

function sourceOf(row) {
  if (row.classList.contains('space-icon')) return { kind: 'space', id: row.dataset.spaceId };
  if (row.classList.contains('link-row') || row.classList.contains('tile-row')) return { kind: 'link', id: row.parentElement.dataset.id };
  if (row.classList.contains('folder-row')) return { kind: 'folder', id: row.parentElement.dataset.id };
  if (row.classList.contains('tab-row')) return { kind: 'tab', tabId: Number(row.parentElement.dataset.tabId) };
  return null;
}

// The dropped address, as the browser gives it.
function externalData(dataTransfer) {
  return {
    uriList: dataTransfer.getData('text/uri-list'),
    html: dataTransfer.getData('text/html'),
    text: dataTransfer.getData('text/plain'),
  };
}

const depthOf = (row) => Number(row.style.getPropertyValue('--depth')) || 0;

export function setUpDrag({ listEl, favoritesEl, treeEl, openTabsEl, spacesEl, canSplit, resolve, perform, expandFolder, onDragChange }) {
  const line = document.createElement('div');
  line.className = 'drop-line';
  line.hidden = true;
  listEl.append(line);
  // Between the bar's icons: a line of its own, the bar is outside the list.
  const barLine = document.createElement('div');
  barLine.className = 'drop-line is-vertical';
  barLine.hidden = true;
  spacesEl.append(barLine);
  const areas = [listEl, spacesEl];

  let dragged = null; // the element being dragged from this panel
  let highlighted = null; // element lit up for a drop "inside" a folder (or the empty favorites place) or "onto" a row
  let hover = { id: null, timer: 0 }; // collapsed folder waiting to open

  // What is under the pointer. The copy of the selected link under a collapsed folder is
  // not a place to drop on.
  function targetAt(event, source) {
    const node = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!node || node === line || node === barLine) return null;
    if (node.closest('.is-peek')) return null;

    if (spacesEl.contains(node)) {
      const icon = node.closest('.space-icon');
      if (!icon) return null; // the gaps and "+"
      const rect = icon.getBoundingClientRect();
      const zone = source.kind !== 'space' ? 'inside' : event.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
      return { area: 'spaces', id: icon.dataset.spaceId, zone, row: icon };
    }

    const tile = node.closest('.tile');
    if (tile) {
      const rect = tile.getBoundingClientRect();
      return { area: 'tiles', id: tile.dataset.id, zone: dropZone('tile', event.clientX - rect.left, rect.width), row: tile };
    }
    if (favoritesEl.contains(node)) return { area: 'tiles', id: null, zone: 'inside' };

    const item = node.closest('.link, .folder-row, .empty-folder, .tab-item');
    if (item?.classList.contains('empty-folder')) {
      const folder = item.closest('.folder');
      return { area: 'tree', kind: 'folder', id: folder.dataset.id, zone: 'inside', row: folder.firstElementChild };
    }
    if (item) {
      const row = item.classList.contains('folder-row') ? item : item.querySelector(':scope > .row');
      const rect = row.getBoundingClientRect();
      const y = event.clientY - rect.top;
      if (item.classList.contains('pair-item')) {
        const zone = dropZone('tab', y, rect.height);
        return { area: 'tabs', tabId: Number(zone === 'before' ? item.dataset.tabId : item.dataset.pairTabId), zone, row };
      }
      if (item.classList.contains('tab-item')) {
        const zone = dropZone('tab', y, rect.height, { canSplit });
        return { area: 'tabs', tabId: Number(item.dataset.tabId), zone, halfZone: dropZone('tab', y, rect.height), row };
      }
      if (item.classList.contains('folder-row')) {
        const expanded = item.parentElement.classList.contains('is-expanded');
        const zone = dropZone('folder', y, rect.height, { expanded });
        return { area: 'tree', kind: 'folder', id: item.parentElement.dataset.id, zone, row, expanded };
      }
      const zone = dropZone('link', y, rect.height, { canSplit });
      return { area: 'tree', kind: 'link', id: item.dataset.id, zone, halfZone: dropZone('link', y, rect.height), row };
    }
    if (node === treeEl) {
      // A gap between top-level items belongs to the tree itself: a drop there goes
      // before the next item. Below the last item — the end of the tree.
      const next = [...treeEl.children].find((child) => event.clientY < child.getBoundingClientRect().top);
      const row = next?.querySelector(':scope > .row');
      if (next?.classList.contains('folder')) {
        return { area: 'tree', kind: 'folder', id: next.dataset.id, zone: 'before', row };
      }
      if (next?.classList.contains('link')) return { area: 'tree', kind: 'link', id: next.dataset.id, zone: 'before', row };
    }
    if (treeEl.contains(node)) return { area: 'tree', kind: 'root', id: null, zone: 'inside' };
    return { area: 'tabs', tabId: null, zone: 'after' };
  }

  function placeLine(top, depth) {
    const listRect = listEl.getBoundingClientRect();
    line.style.top = `${top - listRect.top + listEl.scrollTop}px`;
    line.style.setProperty('--line-depth', depth);
    line.classList.remove('is-vertical');
    line.hidden = false;
  }

  // Upright, in the gap before or after a tile.
  function placeTileLine(tile, zone) {
    const listRect = listEl.getBoundingClientRect();
    const rect = tile.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(tile.parentElement).columnGap) || 0;
    const x = zone === 'before' ? rect.left - gap / 2 : rect.right + gap / 2;
    line.style.top = `${rect.top - listRect.top + listEl.scrollTop}px`;
    line.style.setProperty('--line-x', `${x - listRect.left}px`);
    line.style.setProperty('--line-h', `${rect.height}px`);
    line.classList.add('is-vertical');
    line.hidden = false;
  }

  function highlight(element, className) {
    highlighted?.classList.remove('is-drop-inside', 'is-drop-onto');
    highlighted = element;
    element?.classList.add(className);
  }

  // Upright, in the gap before or after an icon of the bar.
  function placeBarLine(icon, zone) {
    const barRect = spacesEl.getBoundingClientRect();
    const rect = icon.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(icon.parentElement).columnGap) || 0;
    const x = zone === 'before' ? rect.left - gap / 2 : rect.right + gap / 2;
    barLine.style.top = `${rect.top - barRect.top}px`;
    barLine.style.setProperty('--line-x', `${x - barRect.left}px`);
    barLine.style.setProperty('--line-h', `${rect.height}px`);
    barLine.hidden = false;
  }

  function hideIndicator() {
    line.hidden = true;
    barLine.hidden = true;
    highlight(null);
  }

  function showIndicator(target) {
    highlight(null);
    if (target.area === 'spaces') {
      line.hidden = true;
      if (target.zone === 'inside') {
        barLine.hidden = true;
        highlight(target.row, 'is-drop-inside');
      } else placeBarLine(target.row, target.zone);
      return;
    }
    barLine.hidden = true;
    if (target.zone === 'onto') {
      line.hidden = true;
      highlight(target.row.parentElement, 'is-drop-onto');
      return;
    }
    if (target.area === 'tiles') {
      const last = target.row ?? [...favoritesEl.querySelectorAll('.tile')].pop();
      if (last) {
        placeTileLine(last, target.row ? target.zone : 'after');
        return;
      }
      line.hidden = true; // no tiles yet: the empty place lights up
      highlight(favoritesEl.querySelector('.favorites-drop'), 'is-drop-inside');
      return;
    }
    if (target.area === 'tree' && target.kind === 'folder' && target.zone === 'inside') {
      line.hidden = true;
      highlight(target.row.parentElement, 'is-drop-inside');
      return;
    }
    if (target.row) {
      const rect = target.row.getBoundingClientRect();
      if (target.zone === 'before') placeLine(rect.top, depthOf(target.row));
      else if (target.zone === 'inside-start') placeLine(rect.bottom, depthOf(target.row) + 1);
      else placeLine(rect.bottom, depthOf(target.row));
      return;
    }
    // The end of the tree, or after the last open tab.
    const last = target.area === 'tree'
      ? treeEl.lastElementChild
      : [...openTabsEl.querySelectorAll('.tab-item')].pop() ?? openTabsEl.querySelector('.divider');
    const rect = (last ?? (target.area === 'tree' ? treeEl : openTabsEl)).getBoundingClientRect();
    placeLine(last ? rect.bottom : rect.top, 0);
  }

  // What the drop would do; the middle of a row nothing can be split with is its halves.
  function actionFor(source, target) {
    const action = resolve(source, target);
    if (action || target.zone !== 'onto') return action;
    target.zone = target.halfZone;
    return resolve(source, target);
  }

  function cancelHover() {
    clearTimeout(hover.timer);
    hover = { id: null, timer: 0 };
  }

  // Holding over a collapsed folder opens it.
  function updateHover(target) {
    const id = target?.kind === 'folder' && target.zone === 'inside' && !target.expanded ? target.id : null;
    if (id === hover.id) return;
    cancelHover();
    if (id) hover = { id, timer: setTimeout(() => expandFolder(id), HOVER_EXPAND_MS) };
  }

  // While something that can become a tile is dragged, the panel shows where the
  // favorites are even if there are none yet.
  function showFavoritesPlace(source) {
    listEl.classList.toggle('can-drop-favorite', Boolean(source) && source.kind !== 'folder' && source.kind !== 'space');
  }

  function endDrag() {
    hideIndicator();
    cancelHover();
    showFavoritesPlace(null);
    if (!dragged) return;
    dragged.classList.remove('is-dragging');
    dragged = null;
    onDragChange(false);
  }

  function onDragStart(event) {
    const row = event.target instanceof Element && event.target.closest('[draggable="true"]');
    const source = row && sourceOf(row);
    if (!source || row.parentElement.classList.contains('is-editing')) {
      if (row) event.preventDefault();
      return;
    }
    event.dataTransfer.setData(sourceType(source), '');
    event.dataTransfer.effectAllowed = 'move';
    dragged = source.kind === 'space' ? row : row.parentElement;
    // Next frame: the browser has taken the drag image of the row as it looks now.
    requestAnimationFrame(() => {
      dragged?.classList.add('is-dragging');
      if (dragged) showFavoritesPlace(source);
    });
    onDragChange(true);
  }

  function onDragOver(event) {
    const source = readSource(event.dataTransfer);
    showFavoritesPlace(source);
    const target = source && targetAt(event, source);
    const action = target && actionFor(source, target);
    updateHover(source && target);
    if (!action) {
      hideIndicator();
      return; // not prevented: the browser shows "can't drop here"
    }
    event.preventDefault();
    const allowed = event.dataTransfer.effectAllowed;
    event.dataTransfer.dropEffect = source.kind !== 'external' ? 'move'
      : /copy|all|uninitialized/i.test(allowed) ? 'copy' : 'link';
    showIndicator(target);
  }

  function onDragLeave(event) {
    if (!areas.some((area) => area.contains(event.relatedTarget))) {
      hideIndicator();
      cancelHover();
      if (!dragged) showFavoritesPlace(null); // a drag from outside left the panel
    }
  }

  function onDrop(event) {
    event.preventDefault();
    const source = readSource(event.dataTransfer);
    const target = source && targetAt(event, source);
    const action = target && actionFor(source, target);
    const external = source?.kind === 'external' ? externalData(event.dataTransfer) : null;
    hideIndicator();
    cancelHover();
    showFavoritesPlace(null);
    if (action) perform(action, external);
  }

  for (const area of areas) {
    area.addEventListener('dragstart', onDragStart);
    area.addEventListener('dragover', onDragOver);
    area.addEventListener('dragleave', onDragLeave);
    area.addEventListener('drop', onDrop);
  }

  // dragend goes to the dragged element; if a re-render took it out of the page, the
  // first mouse move after the drag cleans up instead.
  document.addEventListener('dragend', endDrag, true);
  document.addEventListener('mousemove', () => {
    if (dragged) endDrag();
  });
}
