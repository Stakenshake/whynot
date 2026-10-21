// Core store: find the .decisions/ directory, read/write/list entries.
//
// Zero dependencies. Everything is plain files under version control, so if
// this tool disappears tomorrow your notes still work with grep.

import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from './frontmatter.js';

export const DIR_NAME = '.decisions';
export const TYPES = ['rejected', 'decision', 'constraint'];

/**
 * How long an entry stays authoritative before a human must re-confirm it.
 *
 * The default is EXPIRY, not permanence. A 2019 "do not use TypeScript" note
 * made 6 of 6 model responses reject TypeScript for a brand-new 2026 service,
 * and telling the agent "this is old, treat it as an assumption to confirm"
 * did not fix it (0/3 -> 1/3 for one model, and worse for the other). Prompt
 * engineering is not a safety mechanism.
 *
 * So expiry is structural instead: an expired entry is not shown to the agent
 * at all. The agent cannot obey what it cannot see. Renewing is a human action.
 */
export const DEFAULT_TTL_DAYS = { rejected: 90, decision: 180, constraint: 365 };

/** Sentinel for a deliberately permanent entry. Must be written explicitly. */
export const NEVER = 'never';

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Effective expiry date, or null when the entry was explicitly marked permanent. */
export function expiresOn(entry) {
  if (String(entry.expires_on) === NEVER) return null;
  if (entry.expires_on) return String(entry.expires_on);

  const base = entry.renewed_on || entry.created;
  if (!base) return null;
  const ttl = DEFAULT_TTL_DAYS[entry.type] ?? 180;
  return addDays(base, ttl);
}

export function isExpired(entry, now = new Date()) {
  const exp = expiresOn(entry);
  if (!exp) return false;
  const d = new Date(exp);
  if (Number.isNaN(d.getTime())) return false;
  return d < now;
}

export function daysUntilExpiry(entry, now = new Date()) {
  const exp = expiresOn(entry);
  if (!exp) return null;
  const d = new Date(exp);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d - now) / 86_400_000);
}

/**
 * Walk up from `startDir` looking for an existing .decisions/ directory.
 * Falls back to the nearest directory containing .git/, so `whynot add` from a
 * subdirectory lands in the repo root. Returns null if neither is found.
 */
export function findRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  let gitFallback = null;

  for (;;) {
    const decisions = path.join(dir, DIR_NAME);
    if (fs.existsSync(decisions) && fs.statSync(decisions).isDirectory()) {
      return dir;
    }
    if (!gitFallback && fs.existsSync(path.join(dir, '.git'))) gitFallback = dir;

    const parent = path.dirname(dir);
    if (parent === dir) return gitFallback;
    dir = parent;
  }
}

/**
 * Filename-safe slug.
 *
 * Windows forbids \ / : * ? " < > | and both Windows and macOS are
 * case-insensitive, so we lowercase and strip everything outside
 * [a-z0-9] plus CJK ranges. Keeps CJK so Chinese titles stay readable.
 */
export function slugify(input, maxLen = 40) {
  const slug = String(input)
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ㐀-䶿一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLen)
    .replace(/-+$/, '');
  return slug || 'entry';
}

function decisionsDir(root) {
  return path.join(root, DIR_NAME);
}

function entryFiles(root) {
  const dir = decisionsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Read every entry. Malformed files are skipped, not fatal. */
export function readAll(root) {
  const out = [];
  for (const file of entryFiles(root)) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const { data, body } = parse(raw);
      out.push({
        ...data,
        id: String(data.id || ''),
        type: data.type || 'decision',
        status: data.status || 'live',
        tags: Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [],
        evidence: Array.isArray(data.evidence) ? data.evidence : data.evidence ? [data.evidence] : [],
        body: body.trim(),
        file,
        filename: path.basename(file),
      });
    } catch {
      // A corrupt file must never break a session.
    }
  }
  return out;
}

export function nextId(root) {
  const existing = readAll(root)
    .map((e) => parseInt(e.id, 10))
    .filter((n) => Number.isFinite(n));
  const next = existing.length ? Math.max(...existing) + 1 : 1;
  return String(next).padStart(4, '0');
}

export function init(root) {
  const dir = decisionsDir(root);
  fs.mkdirSync(dir, { recursive: true });

  const keep = path.join(dir, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '', 'utf8');

  // Without this, Windows checkouts write CRLF and every diff shows the whole
  // file as changed.
  const attrs = path.join(root, '.gitattributes');
  const rule = '*.md text eol=lf';
  if (!fs.existsSync(attrs)) {
    fs.writeFileSync(attrs, `# added by whynot\n${rule}\n`, 'utf8');
  } else {
    const cur = fs.readFileSync(attrs, 'utf8');
    if (!/\.md\s+text\s+eol=lf/.test(cur)) {
      fs.appendFileSync(attrs, `\n# added by whynot\n${rule}\n`, 'utf8');
    }
  }

  return { root, dir };
}

export function create(root, entry) {
  if (!entry || !entry.title) throw new Error('title is required');
  const type = entry.type || 'rejected';
  if (!TYPES.includes(type)) {
    throw new Error(`type must be one of: ${TYPES.join(', ')}`);
  }

  const id = entry.id || nextId(root);
  const filename = `${id}-${slugify(entry.title)}.md`;
  const file = path.join(decisionsDir(root), filename);

  const created = entry.created || new Date().toISOString().slice(0, 10);
  const data = {
    id,
    title: entry.title,
    type,
    status: 'live',
    created,
  };

  // Written explicitly rather than computed on read, so the expiry is visible
  // in the file and a human editing it by hand sees what they are changing.
  if (entry.expires_on === NEVER) {
    data.expires_on = NEVER;
  } else if (entry.expires_on) {
    data.expires_on = entry.expires_on;
  } else {
    const ttl = Number.isFinite(entry.ttl_days) ? entry.ttl_days : DEFAULT_TTL_DAYS[type] ?? 180;
    data.expires_on = addDays(created, ttl);
  }

  if (entry.revisit_when) data.revisit_when = entry.revisit_when;
  if (entry.evidence?.length) data.evidence = entry.evidence;
  if (entry.tags?.length) data.tags = entry.tags;

  const body = entry.body?.trim() || '## 结论\n\n## 为什么\n';
  fs.mkdirSync(decisionsDir(root), { recursive: true });
  fs.writeFileSync(file, stringify(data, body), 'utf8');

  return { id, file, filename };
}

export function retire(root, id) {
  const match = readAll(root).find((e) => e.id === id);
  if (!match) throw new Error(`no entry with id ${id}`);

  const { data, body } = parse(fs.readFileSync(match.file, 'utf8'));
  data.status = 'retired';
  data.retired_on = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(match.file, stringify(data, body), 'utf8');

  return { id, file: match.file };
}

const TYPE_RANK = { rejected: 0, constraint: 1, decision: 2 };

function haystackOf(entry) {
  return `${entry.title} ${entry.tags.join(' ')} ${entry.body} ${entry.revisit_when || ''}`.toLowerCase();
}

/**
 * Live entries relevant to a query.
 *
 * Matching is scored rather than ANDed. Requiring every term to appear looks
 * tidy but fails on the common case: an entry titled "session 不存 Redis" will
 * not match a query for "session 存储", so the agent sees nothing and
 * re-proposes Redis. Recall matters more than precision here — missing a
 * relevant rejection is the expensive failure, and an extra hit is cheap to
 * ignore. No index and no embeddings, on purpose.
 */
/** Filter and rank a set of entries. Pure — no expiry logic in here. */
function rank(entries, { query, tags, type, limit }) {
  let results = entries;
  if (type) results = results.filter((e) => e.type === type);

  const wanted = (Array.isArray(tags) ? tags : [tags]).filter(Boolean).map((t) => t.toLowerCase());
  if (wanted.length) {
    results = results.filter((e) => {
      const entryTags = e.tags.map((t) => String(t).toLowerCase());
      return wanted.some((w) => entryTags.includes(w));
    });
  }

  const terms = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length) {
    results = results
      .map((entry) => ({
        entry,
        score: terms.reduce((n, t) => n + (haystackOf(entry).includes(t) ? 1 : 0), 0),
      }))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (TYPE_RANK[a.entry.type] ?? 9) - (TYPE_RANK[b.entry.type] ?? 9) ||
          a.entry.id.localeCompare(b.entry.id)
      )
      .map((r) => r.entry);
  } else {
    // Rejections first: they are the expensive ones to rediscover.
    results = [...results].sort(
      (a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) || a.id.localeCompare(b.id)
    );
  }

  return results.slice(0, limit);
}

export function check(root, { query = '', tags = [], type = null, limit = 20, now = new Date() } = {}) {
  // Expired entries are excluded here, and therefore from every agent-facing
  // read path. This is the safety mechanism: the agent cannot obey an entry it
  // cannot see. Renewal is a human action, performed via the CLI.
  const live = readAll(root).filter((e) => e.status === 'live' && !isExpired(e, now));
  return rank(live, { query, tags, type, limit });
}

/**
 * Expired entries matching a query — used only to tell the agent that
 * something exists and needs the user's confirmation. The caller must not
 * forward the content, only the fact of it.
 */
export function expiredMatching(root, { query = '', tags = [], type = null, now = new Date() } = {}) {
  const gone = readAll(root).filter((e) => e.status === 'live' && isExpired(e, now));
  return rank(gone, { query, tags, type, limit: 50 });
}

/**
 * One line per live entry, for the start-of-session "what is already settled?"
 * call. Deliberately excludes bodies: dumping every full entry into context is
 * exactly the bloat this tool exists to avoid.
 */
export function listIndex(root, { limit = 200 } = {}) {
  return check(root, { limit }).map((e) => ({
    id: e.id,
    type: e.type,
    title: e.title,
    tags: e.tags,
    revisit_when: e.revisit_when || '',
  }));
}

/**
 * Entries a human must act on.
 *
 * Expired entries lead the list. Once an entry expires it stops reaching the
 * agent, so if nobody reviews it the knowledge is simply lost. That is the
 * intended trade: an entry that silently keeps applying long after its reason
 * has gone is worse than one that quietly stops.
 */
export function stale(root, { soonDays = 14, now = new Date() } = {}) {
  const out = [];

  for (const e of readAll(root)) {
    if (e.status !== 'live') continue;

    const reasons = [];
    const left = daysUntilExpiry(e, now);

    if (left !== null && left < 0) {
      reasons.push(`EXPIRED ${-left}d ago — no longer shown to the agent`);
    } else if (left !== null && left <= soonDays) {
      reasons.push(`expires in ${left}d`);
    }

    // Only mention the revisit condition when the entry actually needs a
    // decision. Listing every fresh entry that happens to carry one would fill
    // the queue with things that need no action, and a queue nobody reads is
    // the same as no queue.
    if (e.revisit_when && reasons.length) reasons.push(`revisit_when: ${e.revisit_when}`);

    if (reasons.length) {
      out.push({ ...e, reasons, daysLeft: left, expired: left !== null && left < 0 });
    }
  }

  // Expired first (they are already invisible), then soonest to expire.
  out.sort(
    (a, b) =>
      Number(b.expired) - Number(a.expired) ||
      (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER)
  );
  return out;
}

/**
 * Extend an entry's life. The human half of the expiry mechanism — without
 * this, expiry would just be data loss.
 */
export function renew(root, id, { days = null, now = new Date() } = {}) {
  const match = readAll(root).find((e) => e.id === id);
  if (!match) throw new Error(`no entry with id ${id}`);

  const { data, body } = parse(fs.readFileSync(match.file, 'utf8'));
  const today = now.toISOString().slice(0, 10);
  const ttl = Number.isFinite(days) ? days : DEFAULT_TTL_DAYS[data.type] ?? 180;

  data.renewed_on = today;
  data.expires_on = addDays(today, ttl);
  fs.writeFileSync(match.file, stringify(data, body), 'utf8');

  return { id, expires_on: data.expires_on };
}

/** Compact one-line rendering, used by the CLI and the MCP tool. */
export function summarize(entry) {
  const bits = [`[${entry.id}]`, `(${entry.type})`, entry.title];
  if (entry.revisit_when) bits.push(`— revisit when: ${entry.revisit_when}`);
  return bits.join(' ');
}

/**
 * Full rendering for an agent to read.
 *
 * Expiry is stated plainly because it is the fact the agent most needs: it
 * bounds how much weight the entry deserves. Entries that have already expired
 * never reach here — check() filters them out.
 */
export function render(entry, { now = new Date() } = {}) {
  const left = daysUntilExpiry(entry, now);

  const head = [`## [${entry.id}] ${entry.title}`, `type: ${entry.type} | status: ${entry.status}`];
  if (entry.created) head.push(`created: ${entry.created}`);
  if (entry.renewed_on) head.push(`renewed: ${entry.renewed_on}`);
  head.push(
    left === null
      ? 'expires: never (explicitly marked permanent)'
      : `expires: ${expiresOn(entry)} (in ${left} day${left === 1 ? '' : 's'})`
  );
  if (entry.revisit_when) head.push(`revisit_when: ${entry.revisit_when}`);
  if (entry.evidence?.length) head.push(`evidence: ${entry.evidence.join(', ')}`);
  if (entry.tags?.length) head.push(`tags: ${entry.tags.join(', ')}`);

  if (entry.revisit_when) {
    head.push(
      '',
      '> Apply this only if the revisit_when condition has NOT been met. If you cannot tell ' +
        'whether it has been met, ask the user.'
    );
  }

  return `${head.join('\n')}\n\n${entry.body}`;
}
