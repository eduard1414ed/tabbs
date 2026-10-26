// Bookmark nodes (chrome.bookmarks.getSubTree) → model for rendering. No chrome.* calls.
//
// Model:
//   link   { kind: 'link', id, title, name, url }
//   folder { kind: 'folder', id, title, name, emoji, children }
// `title` is what the row shows, `name` is the bookmark's own title (for renaming).
// The root folder itself is not shown: buildTree returns { id, children }.

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Emoji shown as an emoji by default, or forced by VS16 (❤️, 1️⃣), or a flag.
// Text-style symbols like ©, ™, digits and letters don't count.
const EMOJI = /\p{Emoji_Presentation}|️|\p{Regional_Indicator}/u;

export function splitLeadingEmoji(title) {
  const text = (title ?? '').trim();
  const [first] = graphemes.segment(text);
  if (!first || !EMOJI.test(first.segment)) return { emoji: null, title: text };
  return { emoji: first.segment, title: text.slice(first.segment.length).trimStart() };
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function buildNode(node) {
  if (node.url !== undefined) {
    const title = node.title?.trim() || hostOf(node.url) || node.url;
    return { kind: 'link', id: node.id, title, name: node.title ?? '', url: node.url };
  }
  const { emoji, title } = splitLeadingEmoji(node.title);
  const children = (node.children ?? []).map(buildNode);
  return { kind: 'folder', id: node.id, title, name: node.title ?? '', emoji, children };
}

export function buildTree(rootNode) {
  return { id: rootNode.id, children: (rootNode.children ?? []).map(buildNode) };
}

// Ids of the root and everything inside it; folders separately.
export function collectIds(tree) {
  const all = new Set([tree.id]);
  const folders = new Set();
  const walk = (nodes) => {
    for (const node of nodes) {
      all.add(node.id);
      if (node.kind === 'folder') {
        folders.add(node.id);
        walk(node.children);
      }
    }
  };
  walk(tree.children);
  return { all, folders };
}

// All links of the tree in display order, nested ones included.
export function collectLinks(tree) {
  const links = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.kind === 'folder') walk(node.children);
      else links.push(node);
    }
  };
  walk(tree.children);
  return links;
}

// Links and folders of the tree by id, nested ones included.
export function nodesById(tree) {
  const nodes = new Map();
  const walk = (list) => {
    for (const node of list) {
      nodes.set(node.id, node);
      if (node.kind === 'folder') walk(node.children);
    }
  };
  walk(tree.children);
  return nodes;
}

// Links inside a collapsed folder aren't seen; those with an open tab show under that
// folder (the outermost collapsed one when nested), in tree order.
// → Map: folder id → [link…]; folders with nothing to show aren't in it.
export function peekLinks(nodes, expanded, isOpen) {
  const peeks = new Map();
  const walk = (list, host) => {
    for (const node of list) {
      if (node.kind === 'folder') {
        walk(node.children, host ?? (expanded.has(node.id) ? null : node.id));
      } else if (host && isOpen(node)) {
        if (!peeks.has(host)) peeks.set(host, []);
        peeks.get(host).push(node);
      }
    }
  };
  walk(nodes, null);
  return peeks;
}

// Does a bookmark event touch our folder? Pass the ids the event carries:
// the node itself, its parent, and for moves the old parent.
export function isRelevantEvent({ id, parentId, oldParentId }, knownIds) {
  return [id, parentId, oldParentId].some((value) => value !== undefined && knownIds.has(value));
}

// Expanded folders are stored as an array of ids.
export function toggleId(ids, id) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

export function pruneIds(ids, existing) {
  return ids.filter((id) => existing.has(id));
}

export function sameIds(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// Fallback site icon: first letter on a circle with a stable per-domain hue.
export function fallbackIcon(url, title) {
  const host = hostOf(url);
  const source = host || title?.trim() || '?';
  const [first] = graphemes.segment(source);
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return { letter: first.segment.toUpperCase(), hue: hash % 360 };
}
