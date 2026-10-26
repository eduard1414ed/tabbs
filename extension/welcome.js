// The welcome page (stage 7b): opens once on install, and from the panel's menu.
// What the extension is, the steps to set up Helium, spaces (stage 8b), the Arc import, other browsers.
// Steps are ticked by hand, except the panel's side, which the extension sees itself; the last
// line lights up when all are done. The bookmarks bar step is there only while spaces are on.
// On the left, the chapters as tabs in Arc's sidebar: a click scrolls there, the one being read
// is selected.
// Texts are in lib/strings.js, with **bold** and [links](action) — see lib/richtext.js.

import { strings, pickLanguage } from './lib/strings.js';
import { parseRichText } from './lib/richtext.js';
import { ARC_FOLDER, ARC_FILE } from './lib/arc.js';
import { logoPath, faviconPath } from './lib/action-icon.js';
import {
  uiLanguage,
  appName,
  manifestIcons,
  followThemeWithActionIcon,
  platform,
  getCurrentWindowId,
  openBrowserPage,
  openPanel,
  panelSide,
  panelShortcut,
  spaceShortcuts,
  requestImport,
  requestSpaces,
  getTickedSteps,
  setTickedSteps,
  getSpaceIds,
  SPACES_KEY,
  builtInArcImport,
} from './lib/browser.js';

const S = strings(uiLanguage(), appName());
const W = S.welcome;
const PLATFORM = platform();
document.documentElement.lang = pickLanguage(uiLanguage());
document.title = W.title;
document.getElementById('favicon').href = faviconPath(manifestIcons());

// Link actions in the texts. chrome:// works in Helium, Chrome, Brave and Edge alike (Helium shows helium://).
const PAGES = {
  appearance: 'chrome://settings/appearance',
  shortcuts: 'chrome://extensions/shortcuts',
  // The row itself opens a browser panel that an extension can't open; the search finds and marks it.
  toolbar: `chrome://settings/?search=${encodeURIComponent(W.toolbarSearch)}`,
};

// Known before any click: the panel may be opened only right in answer to one.
const windowIdReady = getCurrentWindowId();

const logError = (what) => (error) => console.error(what, error);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Fills `node` with a text that has **bold** and [links](action); `onLink(action)` — after a link's page opens.
function fillRich(node, source, onLink) {
  node.replaceChildren();
  for (const part of parseRichText(source)) {
    if (part.type === 'strong') {
      node.append(el('strong', '', part.text));
    } else if (part.type === 'link') {
      const link = el('a', 'link', part.text);
      link.href = PAGES[part.action];
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openBrowserPage(PAGES[part.action]).catch(logError('Failed to open the settings'));
        onLink?.(part.action);
      });
      node.append(link);
    } else {
      node.append(part.text);
    }
  }
  return node;
}

const rich = (tag, className, source, onLink) => fillRich(el(tag, className), source, onLink);

function section(...children) {
  const node = el('section', 'section');
  node.append(...children);
  return node;
}

// --- Chapters ---

const chapters = []; // { section, row }
// The chapter clicked: it stays selected while the page scrolls there, even if the page ends
// before its heading reaches the top. Scrolling by hand lets the page decide again.
let chosen = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let setupCount;

function addChapter(sectionNode, icon, title) {
  const row = el('button', 'chapter');
  row.type = 'button';
  row.append(el('span', 'chapter-icon', icon), el('span', 'chapter-title', title));
  row.addEventListener('click', () => {
    chosen = row;
    select(row);
    sectionNode.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  });
  chapters.push({ section: sectionNode, row });
  return row;
}

function select(row) {
  for (const chapter of chapters) {
    const current = chapter.row === row;
    chapter.row.classList.toggle('is-current', current);
    if (current) chapter.row.setAttribute('aria-current', 'true');
    else chapter.row.removeAttribute('aria-current');
  }
}

// The chapter being read: the last one whose heading is above the upper third of the window;
// scrolled to the very end — the last one.
function followScroll() {
  if (chosen) return;
  const line = window.innerHeight / 3;
  const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  let current = chapters[0];
  for (const chapter of chapters) {
    if (chapter.section.getBoundingClientRect().top <= line) current = chapter;
  }
  select((atEnd ? chapters.at(-1) : current)?.row);
}

for (const event of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
  window.addEventListener(event, () => { chosen = null; }, { passive: true, capture: true });
}

let scrollFrame = 0;
window.addEventListener('scroll', () => {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(followScroll);
}, { passive: true });

// The panel opens (in answer to this click), then is asked to start the import / to show the
// dialog that turns spaces on (the permission is asked for there, in its own click).
async function askPanel(request) {
  const windowId = await windowIdReady;
  await openPanel(windowId);
  await request(windowId);
}

// --- Setup steps ---

const ticked = new Set();   // ticked by hand, kept in storage
let seen = new Set();        // done as far as the extension can see (the panel's side)
let shortcutKey = '';
let spacesOn = false;
let spaceKeys = { next: '', previous: '' };
const spacesOnly = [];       // shown only while spaces are on
const spacesOff = [];        // … only while they are off
let spaceKeysLine;

const steps = [];
let finalStep;

function addStep(list, id, text, onLink) {
  const item = el('li', 'step');
  const mark = el('button', 'mark');
  mark.type = 'button';
  mark.addEventListener('click', () => toggle(id));
  const label = el('span');
  if (text !== undefined) fillRich(label, text, onLink);
  item.append(mark, label);
  list.append(item);
  steps.push({ id, item, mark, label });
  return item;
}

function toggle(id) {
  if (ticked.has(id)) ticked.delete(id);
  else ticked.add(id);
  paint();
  setTickedSteps([...ticked]).catch(logError('Failed to save the steps'));
}

function tick(id) {
  if (ticked.has(id)) return;
  toggle(id);
}

function paint() {
  let allDone = true;
  let number = 0;
  let doneCount = 0;
  for (const step of steps) {
    if (step.item.hidden) continue;
    number++;
    const done = ticked.has(step.id) || seen.has(step.id);
    allDone &&= done;
    if (done) doneCount++;
    step.item.classList.toggle('is-done', done);
    step.mark.textContent = done ? '✓' : String(number);
    step.mark.setAttribute('aria-pressed', String(done));
    step.mark.setAttribute('aria-label', done ? W.markNotDone : W.markDone);
    step.mark.title = done ? W.markNotDone : W.markDone;
    // What the extension sees itself can't be unticked by hand.
    step.mark.disabled = seen.has(step.id);
  }
  finalStep.classList.toggle('is-done', allDone);
  // The setup chapter shows how far it is: "3 / 7", then a green tick.
  setupCount.textContent = allDone ? '✓' : `${doneCount} / ${number}`;
  setupCount.classList.toggle('is-done', allDone);
}

const shortcutStep = () => steps.find((step) => step.id === 'shortcut');

// Settings change in another tab: check again on coming back.
async function refresh() {
  const [side, key, ids, keys] = await Promise.all([panelSide(), panelShortcut(), getSpaceIds(), spaceShortcuts()]);
  seen = new Set(side === 'left' ? ['panel-left'] : []);
  if (key !== shortcutKey || !shortcutStep().label.hasChildNodes()) {
    shortcutKey = key;
    fillRich(shortcutStep().label, key ? W.stepShortcut(key) : W.stepNoShortcut);
  }
  spacesOn = ids !== null;
  for (const node of spacesOnly) node.hidden = !spacesOn;
  for (const node of spacesOff) node.hidden = spacesOn;
  if (keys.next !== spaceKeys.next || keys.previous !== spaceKeys.previous) {
    spaceKeys = keys;
    if (keys.next || keys.previous) fillRich(spaceKeysLine, W.spacesKeys(keys.next, keys.previous));
  }
  spaceKeysLine.hidden = !spacesOn || !(keys.next || keys.previous);
  paint();
}

// A line with a green tick, like the last step when all are done.
function doneLine(text) {
  const line = el('div', 'step is-final is-done');
  line.append(el('span', 'mark', '✓'), el('span', '', text));
  return line;
}

// --- The page ---

function render() {
  const page = document.getElementById('page');

  const title = el('h1', 'title', W.title);
  const intro = section(title, el('p', 'text intro', W.intro));
  const nav = document.getElementById('chapters');
  nav.setAttribute('aria-label', W.chapters);
  const brand = el('div', 'chapters-brand');
  const logo = el('img', 'chapters-logo');
  logo.src = logoPath(manifestIcons());
  logo.alt = '';
  brand.append(logo, el('span', '', S.appName));

  const list = el('ol', 'steps');
  addStep(list, 'appearance', W.stepAppearance, () => tick('appearance'));
  addStep(list, 'layout', W.stepLayout);
  addStep(list, 'right-tabs', W.stepRightTabs);
  addStep(list, 'frameless', W.stepFrameless);
  addStep(list, 'panel-left', W.stepPanelLeft);
  spacesOnly.push(addStep(list, 'bookmarks-bar', W.stepBookmarksBar));
  addStep(list, 'shortcut');
  finalStep = el('li', 'step is-final');
  finalStep.append(el('span', 'mark', '✓'), el('span', '', W.stepsDone));
  list.append(finalStep);
  const setup = section(el('h2', 'heading', W.setupTitle), el('p', 'text', W.setupIntro), list);

  const spacesButton = el('button', 'button', W.spacesButton);
  spacesButton.type = 'button';
  spacesButton.addEventListener('click', () => askPanel(requestSpaces).catch(logError('Failed to ask for spaces')));
  const spacesDone = doneLine(W.spacesOn);
  spaceKeysLine = el('p', 'text');
  spaceKeysLine.hidden = true; // until the keys are known
  spacesOff.push(spacesButton);
  spacesOnly.push(spacesDone);
  const spaces = section(
    el('h2', 'heading', W.spacesTitle),
    el('p', 'text', W.spacesText),
    el('p', 'text', W.spacesNotArc),
    el('p', 'text', W.spacesPermission),
    spacesButton,
    spacesDone,
    spaceKeysLine,
  );

  const sections = [intro, setup, spaces];
  const rows = [
    addChapter(intro, '👋', W.chapterWelcome),
    addChapter(setup, '⚙️', W.setupTitle),
    addChapter(spaces, '🗂️', W.spacesTitle),
  ];
  setupCount = el('span', 'chapter-count');
  rows[1].append(setupCount);

  // Arc exists only on Mac and Windows.
  if (ARC_FOLDER[PLATFORM]) {
    const button = el('button', 'button', W.arcButton);
    button.type = 'button';
    button.addEventListener('click', () => askPanel(requestImport).catch(logError('Failed to start the import')));
    const withSpaces = el('p', 'text', W.arcSpaces);
    spacesOnly.push(withSpaces);
    // Helium imports from Arc itself; elsewhere (Brave, Edge) Arc's file is chosen by hand.
    const how = builtInArcImport()
      ? [rich('p', 'text', W.arcChoose)]
      : [rich('p', 'text', W.arcChooseFile), el('code', 'path', ARC_FILE[PLATFORM] ?? ARC_FOLDER[PLATFORM]), rich('p', 'text', W.arcHowTo[PLATFORM])];
    const arc = section(el('h2', 'heading', W.arcTitle), withSpaces, ...how, button);
    sections.push(arc);
    rows.push(addChapter(arc, '📥', W.arcTitle));
  }

  const other = section(el('h2', 'heading', W.otherTitle), el('p', 'text', W.otherBrowsers), el('p', 'text is-muted', W.again));
  sections.push(other);
  rows.push(addChapter(other, '🧩', W.otherTitle));
  page.append(...sections);
  nav.append(brand, ...rows);
  select(rows[0]);
}

followThemeWithActionIcon();
render();
for (const node of spacesOnly) node.hidden = true;
paint();
getTickedSteps()
  .then((ids) => { for (const id of ids) ticked.add(id); })
  .catch(logError('Failed to read the steps'))
  .finally(() => refresh().catch(logError('Failed to check the settings')));

const refreshQuietly = () => refresh().catch(logError('Failed to check the settings'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshQuietly();
});
window.addEventListener('focus', refreshQuietly);
// Spaces turned on or off in the panel.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SPACES_KEY in changes) refreshQuietly();
});
