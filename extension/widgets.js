// Panel widgets: context menu, icon picker, confirm dialog, Arc import dialog, toast, inline text field.
// Look and keyboard only — they know nothing about bookmarks or tabs.

import { SEPARATOR } from './lib/menu.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text) {
  const node = el('button', className, text);
  node.type = 'button';
  return node;
}

// ---------- Context menu

// The menu or the folder icon picker: one at a time.
let closeActiveMenu = null;

// At (x, y) in viewport coordinates, moved inside the window if needed.
// No room below — it goes up so that its bottom is at `bottom`.
function placePopup(popup, x, y, bottom = y) {
  const { innerWidth, innerHeight } = window;
  const { width, height } = popup.getBoundingClientRect();
  const left = x + width > innerWidth ? Math.max(0, innerWidth - width) : x;
  const top = y + height > innerHeight ? Math.max(0, bottom - height) : y;
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

export function closeMenu() {
  closeActiveMenu?.();
}

// items: [{ id, label, disabled }] with SEPARATOR between groups.
// Opens at (x, y) in viewport coordinates, moved inside the window if needed.
export function openMenu({ x, y, items, onSelect, onClose }) {
  closeMenu();
  const previousFocus = document.activeElement;

  const menu = el('div', 'menu');
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  for (const item of items) {
    if (item === SEPARATOR) {
      const line = el('div', 'menu-separator');
      line.setAttribute('role', 'separator');
      menu.append(line);
      continue;
    }
    const entry = button('menu-item', item.label);
    entry.setAttribute('role', 'menuitem');
    entry.dataset.id = item.id;
    entry.disabled = Boolean(item.disabled);
    menu.append(entry);
  }
  document.body.append(menu);
  placePopup(menu, x, y);
  menu.focus({ preventScroll: true });

  const entries = () => [...menu.querySelectorAll('.menu-item:not(:disabled)')];

  const close = ({ restoreFocus = false } = {}) => {
    if (closeActiveMenu !== close) return;
    closeActiveMenu = null;
    menu.remove();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('blur', onWindowChange);
    window.removeEventListener('resize', onWindowChange);
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    onClose?.();
  };
  const onPointerDown = (event) => {
    if (!menu.contains(event.target)) close();
  };
  const onScroll = () => close();
  const onWindowChange = () => close();

  menu.addEventListener('keydown', (event) => {
    const list = entries();
    const at = list.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = list[(at + 1) % list.length];
    else if (event.key === 'ArrowUp') next = list[(at - 1 + list.length) % list.length];
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list[list.length - 1];
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    } else return;
    event.preventDefault();
    next?.focus();
  });
  menu.addEventListener('click', (event) => {
    const entry = event.target.closest('.menu-item');
    if (!entry || entry.disabled) return;
    close({ restoreFocus: true });
    onSelect(entry.dataset.id);
  });
  menu.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('blur', onWindowChange);
  window.addEventListener('resize', onWindowChange);
  closeActiveMenu = close;
}

// ---------- Folder icon picker

// An icon is { pictogram: name } or { emoji }; null — none.
const iconId = (icon) => (icon?.pictogram ? `pictogram:${icon.pictogram}` : icon?.emoji ? `emoji:${icon.emoji}` : '');

const iconOfOption = (option) =>
  (option.dataset.pictogram ? { pictogram: option.dataset.pictogram } : { emoji: option.dataset.emoji });

function iconOption(icon, render) {
  const option = button('emoji-option');
  if (icon.pictogram) {
    option.classList.add('pictogram-option');
    option.dataset.pictogram = icon.pictogram;
    option.setAttribute('aria-label', icon.pictogram.replaceAll('-', ' '));
    option.append(render(icon.pictogram));
  } else {
    option.textContent = icon.emoji;
    option.dataset.emoji = icon.emoji;
  }
  return option;
}

const optionsOf = (grid) => [...grid.querySelectorAll('.emoji-option')];

function markPicked(grid, picked) {
  for (const option of optionsOf(grid)) {
    option.setAttribute('aria-pressed', String(iconId(iconOfOption(option)) === iconId(picked)));
  }
}

// The option in the next row down (dir 1) or up (-1) nearest to `from` across, or null.
// By position: the pictograms' rows are split by theme headings and needn't be full.
function optionInRow(options, from, dir) {
  const at = from.getBoundingClientRect();
  const rows = options.map((option) => [option, option.getBoundingClientRect()])
    .filter(([, rect]) => (dir > 0 ? rect.top > at.top + 1 : rect.top < at.top - 1));
  if (!rows.length) return null;
  const top = (dir > 0 ? Math.min : Math.max)(...rows.map(([, rect]) => rect.top));
  return rows.filter(([, rect]) => Math.abs(rect.top - top) < 1)
    .reduce((best, row) => (Math.abs(row[1].left - at.left) < Math.abs(best[1].left - at.left) ? row : best))[0];
}

// Tabs "Icons" and "Emoji" over a grid of each: `pictograms` — [{ title, names }] by theme,
// drawn by `render(name)`. Opens on the tab of `current`, on "Icons" when there is none.
// `onSwitch(kind)` after a switch.
function iconTabs({ labels, pictograms, render, emojis, current, onSwitch }) {
  const tabs = el('div', 'picker-tabs');
  tabs.setAttribute('role', 'tablist');
  const grids = {
    pictogram: el('div', 'emoji-grid pictogram-grid'),
    emoji: el('div', 'emoji-grid'),
  };
  for (const { title, names } of pictograms) {
    grids.pictogram.append(el('div', 'picker-section', title));
    for (const name of names) grids.pictogram.append(iconOption({ pictogram: name }, render));
  }
  for (const emoji of emojis) grids.emoji.append(iconOption({ emoji }, render));
  const buttons = {
    pictogram: button('picker-tab', labels.pictograms),
    emoji: button('picker-tab', labels.emoji),
  };
  for (const [kind, tab] of Object.entries(buttons)) {
    tab.dataset.kind = kind;
    tab.setAttribute('role', 'tab');
    grids[kind].setAttribute('role', 'tabpanel');
    grids[kind].setAttribute('aria-label', kind === 'pictogram' ? labels.pictograms : labels.emoji);
    markPicked(grids[kind], current);
    tabs.append(tab);
  }

  let active = null;
  const select = (kind) => {
    if (kind === active) return;
    active = kind;
    for (const [other, tab] of Object.entries(buttons)) {
      tab.setAttribute('aria-selected', String(other === kind));
      tab.tabIndex = other === kind ? 0 : -1;
    }
    onSwitch?.(kind);
  };
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.picker-tab');
    if (tab) select(tab.dataset.kind);
  });

  return {
    tabs,
    grids,
    buttons,
    select,
    active: () => active,
    // The picked option of the open tab, else its first one.
    firstOption: () => grids[active].querySelector('[aria-pressed="true"]') ?? grids[active].querySelector('.emoji-option'),
    markPicked: (picked) => Object.values(grids).forEach((grid) => markPicked(grid, picked)),
    initial: current?.emoji ? 'emoji' : 'pictogram',
  };
}

// Tabs "Icons" (pictograms) and "Emoji": a grid of each; under the emoji, "Other…" (a field for
// any emoji; a hint how to type one, if the platform has a shortcut); and, if there is an icon,
// "Remove icon".
// Opens at (x, y) — under the folder row; with no room below it goes above `rowTop`.
// `current` and what onPick gets — { pictogram } or { emoji }; onPick(null) removes the icon.
// parse(text) → an emoji or null; render(name) → the pictogram's element.
// The window losing focus doesn't close it: the system emoji palette (⌃⌘Space) takes it.
export function openIconPicker({ x, y, rowTop, pictograms, render, emojis, current, labels, parse, onPick, onClose }) {
  closeMenu();
  const previousFocus = document.activeElement;

  const picker = el('div', 'menu picker');
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', labels.title);
  picker.tabIndex = -1;

  const other = button('menu-item', labels.other);
  other.dataset.action = 'other';
  const otherBox = el('div', 'picker-other');
  otherBox.hidden = true;
  const input = el('input', 'picker-field');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', labels.field);
  otherBox.append(input);
  if (labels.hint) otherBox.append(el('div', 'picker-hint', labels.hint));

  const icons = iconTabs({
    labels: labels.tabs,
    pictograms,
    render,
    emojis,
    current,
    onSwitch: (kind) => {
      icons.grids.pictogram.hidden = kind !== 'pictogram';
      emojiPane.hidden = kind !== 'emoji';
      if (picker.isConnected) placePopup(picker, x, y, rowTop); // its height changed
    },
  });
  const emojiPane = el('div', 'picker-pane');
  emojiPane.append(icons.grids.emoji, el('div', 'menu-separator'), other, otherBox);
  picker.append(icons.tabs, icons.grids.pictogram, emojiPane);
  if (current) {
    const remove = button('menu-item', labels.remove);
    remove.dataset.action = 'remove';
    picker.append(el('div', 'menu-separator'), remove);
  }
  icons.select(icons.initial);
  document.body.append(picker);
  placePopup(picker, x, y, rowTop);
  icons.firstOption()?.focus(); // scrolls the grid to the picked one

  const close = ({ restoreFocus = false } = {}) => {
    if (closeActiveMenu !== close) return;
    closeActiveMenu = null;
    picker.remove();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    onClose?.();
  };
  const pick = (icon) => {
    close({ restoreFocus: true });
    onPick(icon);
  };
  const onPointerDown = (event) => {
    if (!picker.contains(event.target)) close();
  };
  const onScroll = (event) => {
    if (!picker.contains(event.target)) close(); // its own grid of pictograms scrolls
  };
  const onResize = () => close();

  // Arrows: between the tabs; across and down the grid, then on to the items under it.
  picker.addEventListener('keydown', (event) => {
    if (event.target === input) {
      if (event.key === 'Enter') {
        event.preventDefault();
        const emoji = parse(input.value);
        if (emoji) pick({ emoji });
        else {
          input.classList.add('is-invalid');
          input.title = labels.invalid;
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close({ restoreFocus: true });
      }
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    const tab = event.target.closest('.picker-tab');
    if (tab) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const kind = tab.dataset.kind === 'pictogram' ? 'emoji' : 'pictogram';
        icons.select(kind);
        icons.buttons[kind].focus();
      } else if (event.key === 'ArrowDown') icons.firstOption()?.focus();
      else return;
      event.preventDefault();
      return;
    }
    const options = optionsOf(icons.grids[icons.active()]);
    const items = [...picker.querySelectorAll('.menu-item')].filter((node) => node.checkVisibility());
    const list = [...options, ...items];
    const at = list.indexOf(document.activeElement);
    const inGrid = at >= 0 && at < options.length;
    let next;
    if (event.key === 'ArrowRight') next = list[Math.min(at + 1, list.length - 1)];
    else if (event.key === 'ArrowLeft') next = list[Math.max(at - 1, 0)];
    else if (event.key === 'ArrowDown') next = inGrid ? optionInRow(options, list[at], 1) ?? items[0] : list[at + 1];
    else if (event.key === 'ArrowUp') {
      if (inGrid) next = optionInRow(options, list[at], -1) ?? icons.buttons[icons.active()];
      else next = list[at - 1];
    } else return;
    event.preventDefault();
    next?.focus();
  });

  input.addEventListener('input', () => {
    input.classList.remove('is-invalid');
    input.title = '';
  });
  picker.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target || target.classList.contains('picker-tab')) return;
    if (target.classList.contains('emoji-option')) pick(iconOfOption(target));
    else if (target.dataset.action === 'remove') pick(null);
    else if (target.dataset.action === 'other') {
      other.hidden = true;
      otherBox.hidden = false;
      placePopup(picker, x, y, rowTop); // it got taller
      input.focus();
    }
  });
  picker.addEventListener('contextmenu', (event) => {
    if (event.target !== input) event.preventDefault();
  });

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  closeActiveMenu = close;
}

// A button showing an icon; a click opens the icon picker under it. `icons` — the picker's
// { pictograms, render, emojis, parse, labels } (as openIconPicker takes them) plus
// `placeholder()` — shown when there is no icon — and `labels.button`.
// → { node, icon() — the icon picked: { pictogram }, { emoji } or null }.
function iconButton(icons, initial = null) {
  const node = button('icon-button');
  node.title = icons.labels.button;
  node.setAttribute('aria-label', icons.labels.button);
  let icon = initial;
  const show = () => node.replaceChildren(icon?.pictogram ? icons.render(icon.pictogram)
    : icon?.emoji ? el('span', 'emoji', icon.emoji)
    : icons.placeholder());
  show();
  node.addEventListener('click', () => {
    const rect = node.getBoundingClientRect();
    node.classList.add('is-menu-target');
    openIconPicker({
      ...icons,
      x: rect.left,
      y: rect.bottom,
      rowTop: rect.top,
      current: icon,
      onPick: (picked) => {
        icon = picked;
        show();
      },
      onClose: () => node.classList.remove('is-menu-target'),
    });
  });
  return { node, icon: () => icon };
}

// ---------- Confirm dialog

// Resolves to true if confirmed. Enter confirms (the confirm button has focus),
// Esc or a click outside cancels. `danger` — the confirm button is red (deleting).
export function confirmDialog({ title, text, confirmLabel, cancelLabel, danger = true }) {
  closeMenu();
  const previousFocus = document.activeElement;

  return new Promise((resolve) => {
    const overlay = el('div', 'overlay');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const titleEl = el('div', 'dialog-title', title);
    titleEl.id = 'dialog-title';
    dialog.setAttribute('aria-labelledby', titleEl.id);
    dialog.append(titleEl);
    if (text) dialog.append(el('div', 'dialog-text', text));

    const cancel = button('dialog-button', cancelLabel);
    const confirm = button(`dialog-button ${danger ? 'is-danger' : 'is-primary'}`, confirmLabel);
    const buttons = el('div', 'dialog-buttons');
    buttons.append(cancel, confirm);
    dialog.append(buttons);
    overlay.append(dialog);
    document.body.append(overlay);
    confirm.focus();

    const finish = (result) => {
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(result);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.addEventListener('contextmenu', (event) => event.preventDefault());
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Tab') {
        // Keep focus inside: there are only two buttons.
        event.preventDefault();
        (document.activeElement === confirm ? cancel : confirm).focus();
      }
    });
  });
}

// ---------- Arc import dialog (stage 7b)

// Step 1: where Arc's sidebar file is (`path`), "Choose file…" — it first copies `copyPath`
// (stage 8b: the file's whole path, for ⇧⌘G in the file window), or the file dropped onto the
// dialog. Step 2: what to take — favorites,
// the space whose items go on top, spaces that become folders. `readSidebar(text)` reads
// the chosen file: { favorites: links, spaces: [{ title, links, into }] }, throws if it isn't
// Arc's. Resolves with { favorites, top, folders } (space indexes; top — null for none),
// or null if cancelled.
// With `spaces` (stage 8b: [{ id, title }] — spaces are on) step 2 is Arc's spaces instead,
// each ticked and going into a new space or one of `spaces` (`into` from readSidebar — the
// default, null — new). Resolves with { favorites, spaces: [{ index, into, icon }] }.
// Stage 8g: a folder or a new space gets an icon (`icons` — see iconButton; the default — `icon`
// from readSidebar); spaces off — `icons` in the result: { [space index]: icon }.
export function openArcImport({ labels, path: shownPath, copyPath = '', howTo, readSidebar, spaces: existing = null, icons }) {
  closeMenu();
  const previousFocus = document.activeElement;

  return new Promise((resolve) => {
    const overlay = el('div', 'overlay');
    const dialog = el('div', 'dialog import-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    overlay.append(dialog);
    document.body.append(overlay);

    const finish = (result) => {
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(result);
    };

    const titled = () => {
      dialog.replaceChildren();
      const title = el('div', 'dialog-title', labels.title);
      title.id = 'dialog-title';
      dialog.setAttribute('aria-labelledby', title.id);
      dialog.append(title);
    };

    const buttonsRow = (confirmLabel) => {
      const cancel = button('dialog-button', labels.cancel);
      const confirm = button('dialog-button is-primary', confirmLabel);
      cancel.addEventListener('click', () => finish(null));
      const row = el('div', 'dialog-buttons');
      row.append(cancel, confirm);
      dialog.append(row);
      return confirm;
    };

    function chooseFile() {
      titled();
      dialog.append(el('div', 'dialog-text', labels.where));
      const path = el('div', 'import-path', shownPath);
      path.title = shownPath;
      dialog.append(path);
      if (howTo) dialog.append(el('div', 'dialog-text', howTo));
      dialog.append(el('div', 'dialog-text', labels.drop));
      const error = el('div', 'dialog-error', labels.notArc);
      error.hidden = true;
      dialog.append(error);

      const input = el('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.hidden = true;
      dialog.append(input);
      const choose = buttonsRow(labels.choose);
      choose.addEventListener('click', async () => {
        // Still within the click's few seconds of "user activation" the file window needs.
        if (copyPath) await navigator.clipboard.writeText(copyPath).catch(() => {});
        input.click();
      });
      const open = async (file) => {
        if (!file) return;
        try {
          const sidebar = readSidebar(await file.text());
          if (existing) pickIntoSpaces(sidebar);
          else pickSpaces(sidebar);
        } catch {
          error.hidden = false;
        }
      };
      input.addEventListener('change', () => {
        const [file] = input.files;
        input.value = ''; // choosing the same file again fires "change" again
        open(file);
      });
      // A file dragged from Finder onto the dialog, while it asks for one.
      const hasFile = (event) => [...event.dataTransfer.types].includes('Files');
      dropFile = { over: (event) => {
        if (!hasFile(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        dialog.classList.add('is-drop-file');
      }, drop: (event) => {
        if (!hasFile(event)) return;
        event.preventDefault();
        dialog.classList.remove('is-drop-file');
        open(event.dataTransfer.files[0]);
      } };
      choose.focus();
    }

    // Only on step 1; afterwards a dropped file is turned away.
    let dropFile = null;
    overlay.addEventListener('dragover', (event) => dropFile?.over(event));
    overlay.addEventListener('dragleave', (event) => {
      if (!dialog.contains(event.relatedTarget)) dialog.classList.remove('is-drop-file');
    });
    overlay.addEventListener('drop', (event) => {
      event.preventDefault(); // the browser would open the file in a tab
      dropFile?.drop(event);
    });

    // `icon` — with an icon button between the box and the text.
    function checkbox(text, checked, icon) {
      const label = el('label', 'import-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = checked;
      const picker = icon === undefined ? null : iconButton(icons, icon);
      label.append(box, ...(picker ? [picker.node] : []), el('span', 'import-check-text', text));
      return { label, box, picker };
    }

    function pickSpaces({ favorites, spaces }) {
      dropFile = null;
      titled();
      const favoritesBox = favorites ? checkbox(labels.favorites(favorites), true) : null;
      if (favoritesBox) dialog.append(favoritesBox.label);

      const top = el('select', 'import-select');
      top.append(new Option(labels.none, ''));
      spaces.forEach((space, index) => top.append(new Option(labels.space(space.title, space.links), String(index))));
      top.value = spaces.length ? '0' : '';
      const topField = el('label', 'import-field');
      topField.append(el('span', 'import-field-title', labels.top), top);
      dialog.append(topField);

      const folderBoxes = spaces.map((space, index) => {
        const item = checkbox(labels.space(space.title, space.links), index !== 0, space.icon ?? null);
        item.label.dataset.index = String(index);
        return item;
      });
      if (spaces.length) {
        const group = el('div', 'import-group');
        group.append(el('div', 'import-field-title', labels.folders), ...folderBoxes.map((item) => item.label));
        dialog.append(group);
      }
      dialog.append(el('div', 'dialog-text', labels.adds));
      const confirm = buttonsRow(labels.import);

      const topIndex = () => (top.value === '' ? null : Number(top.value));
      const choice = () => ({
        favorites: Boolean(favoritesBox?.box.checked),
        top: topIndex(),
        folders: folderBoxes.flatMap((item, index) => (item.box.checked && index !== topIndex() ? [index] : [])),
        icons: Object.fromEntries(folderBoxes.map((item, index) => [index, item.picker.icon()])),
      });
      // The space on top is not offered as a folder; the one that was on top before
      // becomes a folder again (as all the others are by default).
      let shownOnTop = topIndex();
      const update = () => {
        const onTop = topIndex();
        if (shownOnTop !== null && shownOnTop !== onTop) folderBoxes[shownOnTop].box.checked = true;
        shownOnTop = onTop;
        folderBoxes.forEach((item, index) => {
          item.label.hidden = index === onTop;
          item.picker.node.disabled = !item.box.checked;
        });
        const { favorites: withFavorites, folders } = choice();
        confirm.disabled = !withFavorites && onTop === null && !folders.length;
      };
      dialog.addEventListener('change', update);
      update();
      confirm.addEventListener('click', () => finish(choice()));
      confirm.focus();
    }

    function pickIntoSpaces({ favorites, spaces }) {
      dropFile = null;
      titled();
      const favoritesBox = favorites ? checkbox(labels.favorites(favorites), true) : null;
      if (favoritesBox) dialog.append(favoritesBox.label);

      const rows = spaces.map((space) => {
        const item = checkbox(labels.space(space.title, space.links), true, space.icon ?? null);
        const into = el('select', 'import-select');
        into.setAttribute('aria-label', labels.intoLabel(space.title));
        into.append(new Option(labels.intoNew, ''), ...existing.map((target) => new Option(labels.into(target.title), target.id)));
        into.value = space.into ?? '';
        const row = el('div', 'import-space');
        row.append(item.label, into);
        return { ...item, into };
      });
      if (spaces.length) {
        const group = el('div', 'import-group');
        group.append(el('div', 'import-field-title', labels.spacesTitle), ...rows.map((row) => row.into.parentElement));
        dialog.append(group);
      }
      dialog.append(el('div', 'dialog-text', labels.adds));
      const confirm = buttonsRow(labels.import);

      const choice = () => ({
        favorites: Boolean(favoritesBox?.box.checked),
        spaces: rows.flatMap((row, index) => (row.box.checked
          ? [{ index, into: row.into.value || null, icon: row.into.value ? null : row.picker.icon() }]
          : [])),
      });
      const update = () => {
        rows.forEach((row) => {
          row.into.disabled = !row.box.checked;
          row.picker.node.disabled = !row.box.checked || Boolean(row.into.value); // an existing space keeps its icon
        });
        const { favorites: withFavorites, spaces: chosen } = choice();
        confirm.disabled = !withFavorites && !chosen.length;
      };
      dialog.addEventListener('change', update);
      update();
      confirm.addEventListener('click', () => finish(choice()));
      confirm.focus();
    }

    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) finish(null);
    });
    overlay.addEventListener('contextmenu', (event) => {
      if (!event.target.closest('select')) event.preventDefault();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      } else if (event.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusable = [...dialog.querySelectorAll('button, select, input:not([type="file"])')]
          .filter((node) => !node.disabled && !node.closest('[hidden]'));
        const at = focusable.indexOf(document.activeElement);
        const next = (at + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
        event.preventDefault();
        focusable[next]?.focus();
      }
    });

    chooseFile();
  });
}

// ---------- Spaces dialogs (stage 8)

// A dialog over the panel: Esc or a click outside cancels (finish(null)), Tab stays inside.
function modal(className) {
  closeMenu();
  const previousFocus = document.activeElement;
  const overlay = el('div', 'overlay');
  const dialog = el('div', `dialog ${className}`);
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlay.append(dialog);
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const finish = (result) => {
    if (!overlay.isConnected) return;
    overlay.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    resolve(result);
  };
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) finish(null);
  });
  overlay.addEventListener('contextmenu', (event) => {
    if (!event.target.closest('input[type="text"], select')) event.preventDefault();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(null);
    } else if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, input, select')]
        .filter((node) => !node.disabled && !node.closest('[hidden]'));
      const at = focusable.indexOf(document.activeElement);
      const next = (at + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      event.preventDefault();
      focusable[next]?.focus();
    }
  });
  const titled = (text) => {
    const title = el('div', 'dialog-title', text);
    title.id = 'dialog-title';
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.append(title);
  };
  const buttonsRow = (cancelLabel, confirmLabel) => {
    const cancel = button('dialog-button', cancelLabel);
    const confirm = button('dialog-button is-primary', confirmLabel);
    cancel.addEventListener('click', () => finish(null));
    const row = el('div', 'dialog-buttons');
    row.append(cancel, confirm);
    dialog.append(row);
    return confirm;
  };
  const textField = (value, label) => {
    const input = el('input', 'picker-field');
    input.type = 'text';
    input.value = value;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', label);
    return input;
  };
  const show = () => document.body.append(overlay);
  return { dialog, done, finish, titled, buttonsRow, textField, show };
}

// Turning spaces on: which top-level folders become spaces (`folders` [{ id, title }],
// `checked` ticked at first), the first space's name when anything is left over
// (`needsFirst(ids)`), a warning if there are tab groups already. `onConfirm()` runs right
// in the click on "Turn on" (the permission prompt needs it) and resolves to true if allowed.
// Resolves with { spaces: [ids], firstName } or null if cancelled.
export function openEnableSpaces({ labels, folders, checked, needsFirst, hasGroups, onConfirm }) {
  const { dialog, done, finish, titled, buttonsRow, textField, show } = modal('import-dialog');
  titled(labels.enableTitle);
  dialog.append(el('div', 'dialog-text', labels.notProfiles));

  const boxes = folders.map((folder) => {
    const label = el('label', 'import-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = checked.has(folder.id);
    box.dataset.id = folder.id;
    label.append(box, el('span', 'import-check-text', folder.title));
    return box;
  });
  if (folders.length) {
    const group = el('div', 'import-group');
    group.append(el('div', 'import-field-title', labels.makeSpaces), ...boxes.map((box) => box.parentElement));
    dialog.append(group);
  }

  const first = el('label', 'import-field');
  const name = textField(labels.firstDefault, labels.firstField);
  first.append(el('span', 'import-field-title', labels.rest), name);
  dialog.append(first);
  if (hasGroups) dialog.append(el('div', 'dialog-error', labels.groupsWarning));
  dialog.append(el('div', 'dialog-text', labels.bookmarksBar));
  const error = el('div', 'dialog-error', labels.noPermission);
  error.hidden = true;
  dialog.append(error);
  const confirm = buttonsRow(labels.cancel, labels.turnOn);

  const ticked = () => boxes.filter((box) => box.checked).map((box) => box.dataset.id);
  const update = () => { first.hidden = !needsFirst(ticked()); };
  dialog.addEventListener('change', update);
  update();

  const submit = () => {
    if (confirm.disabled) return;
    const choice = { spaces: ticked(), firstName: name.value.trim() || labels.firstDefault };
    const allowed = onConfirm(); // first thing in the click: the browser asks for the permission
    confirm.disabled = true;
    allowed.then((ok) => {
      if (ok) finish(choice);
      else {
        error.hidden = false;
        confirm.disabled = false;
      }
    });
  };
  confirm.addEventListener('click', submit);
  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  show();
  confirm.focus();
  return done;
}

// ---------- Helium's import from Arc (after stage 8b)

// While Helium's import runs in its tab: what to choose there. Below, small: Arc's file by hand,
// and — when `previous` — the last import that wasn't sorted. Resolves with 'file',
// 'previous' or null (OK, or closed; `close()` on the promise closes it).
export function openArcHint({ labels, previous = false }) {
  const { dialog, done, finish, titled, show } = modal('import-dialog arc-hint');
  titled(labels.title);
  dialog.append(el('div', 'dialog-text', labels.hint));
  const links = el('div', 'dialog-links');
  const byFile = button('dialog-link', labels.byFile);
  byFile.addEventListener('click', () => finish('file'));
  if (previous) {
    const last = button('dialog-link', labels.previous);
    last.addEventListener('click', () => finish('previous'));
    links.append(last);
  }
  links.append(byFile);
  dialog.append(links);
  const ok = button('dialog-button is-primary', labels.ok);
  ok.addEventListener('click', () => finish(null));
  const row = el('div', 'dialog-buttons');
  row.append(ok);
  dialog.append(row);
  show();
  ok.focus();
  done.close = () => finish(null); // the import ended while it was open
  return done;
}

// What came from Arc → where it goes. `favorites` — how many links (0 — none); `spaces`
// [{ id, links, preview: [titles], mode, title, placeholder }] with the defaults; `modes`
// [{ value, label }] — where a space can go (spaces off: on top / as a folder / skip; on: as a
// space / into one of yours / skip; an "into" value is 'into:<id>'). A folder or a new space gets
// an icon (stage 8g; `icons` — see iconButton, a space's `icon` — the default). Resolves with
// { favorites, spaces: [{ id, mode, title, into, icon }] } or null if cancelled.
export function openArcSort({ labels, favorites, spaces, modes, icons }) {
  const { dialog, done, finish, titled, buttonsRow, textField, show } = modal('import-dialog');
  titled(labels.title);
  dialog.append(el('div', 'dialog-text', labels.intro));

  let favoritesBox = null;
  if (favorites) {
    const label = el('label', 'import-check');
    favoritesBox = el('input');
    favoritesBox.type = 'checkbox';
    favoritesBox.checked = true;
    label.append(favoritesBox, el('span', 'import-check-text', labels.favorites(favorites)));
    dialog.append(label);
  }

  const rows = spaces.map((space, index) => {
    const name = textField(space.title, labels.nameLabel(index + 1));
    name.placeholder = space.placeholder;
    const preview = el('div', 'sort-preview', space.links ? labels.preview(space.preview, space.links) : labels.noLinks);
    const where = el('select', 'import-select');
    where.setAttribute('aria-label', labels.modeLabel(index + 1));
    for (const mode of modes) where.append(new Option(mode.label, mode.value));
    where.value = space.mode;
    const picker = iconButton(icons, space.icon ?? null);
    const nameLine = el('div', 'sort-name');
    nameLine.append(picker.node, name);
    const row = el('div', 'sort-space');
    row.append(nameLine, preview, where);
    dialog.append(row);
    return { id: space.id, name, where, picker };
  });
  if (spaces.length) dialog.append(el('div', 'dialog-text', labels.skipped));
  const confirm = buttonsRow(labels.later, labels.sort);

  const choice = () => ({
    favorites: Boolean(favoritesBox?.checked),
    spaces: rows.map((row) => {
      const [mode, into = null] = row.where.value.split(':');
      const icon = mode === 'folder' || mode === 'space' ? row.picker.icon() : null;
      return { id: row.id, mode, title: row.name.value, into, icon };
    }),
  });
  const update = () => {
    const { favorites: withFavorites, spaces: chosen } = choice();
    for (const row of rows) {
      row.name.disabled = row.where.value === 'skip' || row.where.value.startsWith('into:');
      row.picker.node.disabled = !['folder', 'space'].includes(row.where.value); // on top or into: no folder of its own
    }
    confirm.disabled = !withFavorites && chosen.every((space) => space.mode === 'skip');
  };
  dialog.addEventListener('change', update);
  update();
  const submit = () => {
    if (!confirm.disabled) finish(choice());
  };
  confirm.addEventListener('click', submit);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input[type="text"]')) {
      event.preventDefault();
      submit();
    }
  });
  show();
  confirm.focus();
  return done;
}

// A new space (or renaming one: `name` and `icon` filled in): its name and an icon — a pictogram
// (`pictograms`, drawn by `render(name)`) or one of `emojis` (or an emoji typed at the start of
// the name). Resolves with { name, icon } (icon { pictogram } or { emoji }, null — none picked)
// or null if cancelled.
export function openSpaceDialog({ labels, pictograms, render, emojis, name: value = '', icon: current = null }) {
  const { dialog, done, finish, titled, buttonsRow, textField, show } = modal('import-dialog');
  titled(labels.newSpace);
  const field = el('label', 'import-field');
  const name = textField(value, labels.nameField);
  name.placeholder = labels.newDefault;
  field.append(el('span', 'import-field-title', labels.nameField), name);
  dialog.append(field);

  const iconField = el('div', 'import-field');
  iconField.setAttribute('role', 'group');
  iconField.setAttribute('aria-label', labels.iconPicker);
  const ownEmoji = el('div', 'dialog-text', labels.ownEmoji);
  const icons = iconTabs({
    labels: labels.tabs,
    pictograms,
    render,
    emojis,
    current,
    onSwitch: (kind) => {
      icons.grids.pictogram.hidden = kind !== 'pictogram';
      icons.grids.emoji.hidden = kind !== 'emoji';
      ownEmoji.hidden = kind !== 'emoji';
    },
  });
  icons.select(icons.initial);
  iconField.append(el('span', 'import-field-title', labels.iconPicker), icons.tabs, icons.grids.pictogram, icons.grids.emoji);
  dialog.append(iconField, ownEmoji);
  const confirm = buttonsRow(labels.cancel, labels.create);

  let picked = current;
  iconField.addEventListener('click', (event) => {
    const option = event.target.closest('.emoji-option');
    if (!option) return;
    const icon = iconOfOption(option);
    picked = iconId(picked) === iconId(icon) ? null : icon; // a second click un-picks
    icons.markPicked(picked);
  });
  const submit = () => finish({ name: name.value.trim(), icon: picked });
  confirm.addEventListener('click', submit);
  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  show();
  name.focus();
  name.select();
  return done;
}

// ---------- Toast with an action ("Deleted · Undo")

let closeActiveToast = null;

// One at a time: a new toast replaces the previous one. Stays while the mouse is over it.
// Without `actionLabel` — just the text.
// `onClose(acted)` — once the toast is gone: acted — its button was clicked.
export function showToast({ text, actionLabel, onAction, duration, onClose }) {
  closeActiveToast?.();

  const toast = el('div', 'toast');
  toast.setAttribute('role', 'status');
  toast.append(el('span', 'toast-text', text));
  const action = actionLabel ? button('toast-action', actionLabel) : null;
  if (action) toast.append(action);
  document.body.append(toast);

  let timer = 0;
  const start = () => {
    clearTimeout(timer);
    timer = setTimeout(close, duration);
  };
  let acted = false;
  function close() {
    if (closeActiveToast !== close) return;
    closeActiveToast = null;
    clearTimeout(timer);
    toast.remove();
    onClose?.(acted);
  }
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
  toast.addEventListener('mouseleave', start);
  toast.addEventListener('contextmenu', (event) => event.preventDefault());
  action?.addEventListener('click', () => {
    acted = true;
    close();
    onAction();
  });

  closeActiveToast = close;
  start();
}

// ---------- Text field in place of a row's title

// `wrap` is a link or folder element; its row has a `.title`. The field lies over the
// row so the row itself (a button) never contains it. A favorites tile has no title and
// is too narrow: the field lies over the whole row of tiles, in the tiles' container.
// onCommit(value) decides what happens on Enter or a click elsewhere:
//   'close'   — nothing to save, close the field;
//   'saving'  — keep the field, read-only, until the panel re-renders the row
//               (the caller calls field.close() if saving fails);
//   'invalid' — on Enter: keep it open and mark it; on a click elsewhere: close.
// Esc closes without saving. onEnd() runs once when editing is over.
export function openField(wrap, { value, placeholder, label, invalidHint, onCommit, onEnd }) {
  const title = wrap.querySelector(':scope > .row .title');
  const host = title ? wrap : wrap.offsetParent;

  const input = el('input', 'field');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder ?? '';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', label);
  if (title) {
    input.style.setProperty('--field-left', `${title.getBoundingClientRect().left - wrap.getBoundingClientRect().left}px`);
  } else {
    input.classList.add('is-wide');
    input.style.setProperty('--field-top', `${wrap.offsetTop}px`);
  }

  wrap.classList.add('is-editing');
  host.append(input);
  input.focus({ preventScroll: true });
  input.select();

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd?.();
  };
  const close = () => {
    end();
    input.remove();
    wrap.classList.remove('is-editing');
  };
  const commit = (fromBlur) => {
    if (ended) return;
    const result = onCommit(input.value);
    if (result === 'saving') {
      input.readOnly = true;
      end();
    } else if (result === 'invalid' && !fromBlur) {
      input.classList.add('is-invalid');
      input.title = invalidHint ?? '';
    } else {
      close();
    }
  };

  input.addEventListener('input', () => {
    input.classList.remove('is-invalid');
    input.title = '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(false);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  input.addEventListener('blur', () => commit(true));

  return { input, close, isActive: () => !ended && input.isConnected };
}
