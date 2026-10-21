// Minimal YAML-subset frontmatter parser.
//
// Deliberately NOT a general YAML parser. It handles exactly the shapes whynot
// emits, so there is no dependency to rot and no surprising parse results:
//
//   key: scalar
//   key: "quoted scalar"
//   key: [a, b, c]
//   key:
//     - item
//
// Anything it does not understand is ignored rather than throwing, because a
// malformed decision file should never break an agent's session.

const DELIM = '---';

function unquote(s) {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Needs quoting if it could be misread as a list, comment, or empty. */
function needsQuote(s) {
  return s === '' || /^[\s[\]{}#&*!|>'"%@`-]/.test(s) || /:\s/.test(s) || s !== s.trim();
}

function quote(s) {
  return needsQuote(s) ? JSON.stringify(s) : s;
}

export function parse(text) {
  const lines = String(text).split(/\r?\n/);
  if ((lines[0] || '').trim() !== DELIM) {
    return { data: {}, body: String(text) };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === DELIM) {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: {}, body: String(text) };

  const data = {};
  let pendingListKey = null;

  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    const listItem = raw.match(/^\s+-\s+(.*)$/);
    if (listItem && pendingListKey) {
      data[pendingListKey].push(unquote(listItem[1].trim()));
      continue;
    }

    const kv = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1];
    const value = kv[2].trim();

    if (value === '') {
      data[key] = [];
      pendingListKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      pendingListKey = null;
    } else {
      data[key] = unquote(value);
      pendingListKey = null;
    }
  }

  // A key declared with no value and no list items becomes '' rather than [],
  // so consumers can treat "unset scalar" and "unset list" uniformly.
  for (const k of Object.keys(data)) {
    if (Array.isArray(data[k]) && data[k].length === 0) data[k] = '';
  }

  const body = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n+/, '');

  return { data, body };
}

export function stringify(data, body = '') {
  const out = [DELIM];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(`${key}: []`);
      } else {
        out.push(`${key}:`);
        for (const item of value) out.push(`  - ${quote(String(item))}`);
      }
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      out.push(`${key}: ${value}`);
    } else {
      out.push(`${key}: ${quote(String(value))}`);
    }
  }

  out.push(DELIM);
  if (body) {
    out.push('');
    out.push(body.replace(/\s+$/, ''));
  }
  out.push('');
  return out.join('\n');
}
