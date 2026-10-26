// Comparing addresses of bookmarks and tabs. No chrome.* calls.
//
// Two addresses are the same if they differ only in the #fragment, a trailing "/",
// or the letter case of the scheme and the domain. Everything else (www, query,
// path case) must match exactly.

// The URL parser lowercases the domain only for http(s)-like schemes, so the
// domain is lowercased here by hand. User info before "@" is left as is.
function lowercaseHost(href, protocol) {
  const prefix = `${protocol}//`;
  if (!href.startsWith(prefix)) return href;
  const start = prefix.length;
  const rest = href.slice(start);
  const end = rest.search(/[/?]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  const at = authority.lastIndexOf('@');
  const host = authority.slice(at + 1).toLowerCase();
  return prefix + authority.slice(0, at + 1) + host + rest.slice(authority.length);
}

function stripTrailingSlash(href) {
  const queryAt = href.indexOf('?');
  const base = queryAt === -1 ? href : href.slice(0, queryAt);
  const query = queryAt === -1 ? '' : href.slice(queryAt);
  return (base.endsWith('/') ? base.slice(0, -1) : base) + query;
}

export function normalizeUrl(url) {
  const text = (url ?? '').trim();
  if (!text) return '';
  let href;
  try {
    const parsed = new URL(text);
    parsed.hash = '';
    href = lowercaseHost(parsed.href, parsed.protocol);
  } catch {
    // Not a valid address: compare the text itself, still without the fragment.
    const hashAt = text.indexOf('#');
    href = hashAt === -1 ? text : text.slice(0, hashAt);
  }
  return stripTrailingSlash(href);
}

export function sameUrl(a, b) {
  const left = normalizeUrl(a);
  return left !== '' && left === normalizeUrl(b);
}

// What was typed into "Edit address" → the address to save, or null if it isn't one.
// "example.com/page" gets "https://"; anything with its own scheme ("http://…",
// "helium://…", "about:blank", "mailto:…") is kept as is. "localhost:3000" and
// "example.com:8080" look like a scheme but are a host with a port.
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function isHostWithPort(text) {
  const match = /^([^/:?#]+):\d+(?:[/?#]|$)/.exec(text);
  return Boolean(match) && (match[1].toLowerCase() === 'localhost' || match[1].includes('.'));
}

export function completeUrl(text) {
  const value = (text ?? '').trim();
  if (!value || /\s/.test(value)) return null;

  if (SCHEME.test(value) && !isHostWithPort(value)) {
    try {
      new URL(value);
      return value;
    } catch {
      return null;
    }
  }

  let parsed;
  try {
    parsed = new URL(`https://${value}`);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  const isHost = host === 'localhost' || host.startsWith('[') || (host.includes('.') && !host.startsWith('.') && !host.endsWith('.'));
  return isHost ? parsed.href : null;
}
