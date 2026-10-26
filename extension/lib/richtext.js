// Inline markup in UI texts (the welcome page): **bold** for setting names and keys,
// [text](action) for a link that does `action`. Everything else is plain text.

const MARKUP = /\*\*(.+?)\*\*|\[(.+?)\]\(([\w-]+)\)/g;

// 'Open the [Appearance](appearance) settings' →
// [{ type: 'text', text: 'Open the ' }, { type: 'link', text: 'Appearance', action: 'appearance' }, { type: 'text', text: ' settings' }]
export function parseRichText(source) {
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(MARKUP)) {
    if (match.index > last) parts.push({ type: 'text', text: source.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ type: 'strong', text: match[1] });
    else parts.push({ type: 'link', text: match[2], action: match[3] });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ type: 'text', text: source.slice(last) });
  return parts;
}
