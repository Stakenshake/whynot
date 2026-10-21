// CLI: the human half of the loop. Agents get the MCP server; people get this.

import fs from 'node:fs';
import path from 'node:path';
import {
  findRoot,
  init,
  create,
  retire,
  renew,
  check,
  stale,
  readAll,
  summarize,
  render,
  expiresOn,
  daysUntilExpiry,
  DIR_NAME,
  TYPES,
} from './store.js';
import { audit, renderAudit } from './audit.js';
import { serve } from './mcp.js';

const USAGE = `whynot — record what you ruled out, and why

Usage:
  whynot init                     Create ${DIR_NAME}/ and the .gitattributes rule
  whynot add --title T --why W    Record an entry
        [--type rejected|decision|constraint]
        [--revisit "condition"]   When to reconsider
        [--ttl N]                 Days until it expires (default: rejected 90,
                                  decision 180, constraint 365)
        [--expires never]         Explicitly permanent
        [--evidence pr:412]       Repeatable
        [--tags infra,session]
  whynot list [--all]             List live entries (--all includes retired)
  whynot check "<query>"          Show live entries matching a query
  whynot stale                    Entries needing a human decision (expired first)
  whynot renew <id> [--days N]    Extend an entry's life
  whynot retire <id>              Mark an entry retired (never deletes)
  whynot doctor                   Validate the store
  whynot audit [--days N]         Scan AGENTS.md / CLAUDE.md for rules that
                                  will be obeyed forever (read-only)
  whynot mcp                      Run the MCP server on stdio (used by agents)

An entry that expires stops being shown to your agent until you renew it.
That is deliberate: see VALIDATION.md for why.

Options:
  --root <dir>   Operate on this repo instead of searching upward from cwd
  -h, --help     Show this message
`;

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      const key = a.slice(2, eq);
      (flags[key] ??= []).push(a.slice(eq + 1));
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        (flags[key] ??= []).push(next);
        i++;
      } else {
        (flags[key] ??= []).push(true);
      }
    }
  }

  const one = (k) => (Array.isArray(flags[k]) ? flags[k][flags[k].length - 1] : undefined);
  return { flags, positional, one };
}

function resolveRoot(one) {
  const explicit = one('root');
  if (explicit && explicit !== true) return path.resolve(explicit);
  const found = findRoot(process.cwd());
  if (!found) {
    throw new Error(
      `No ${DIR_NAME}/ found from ${process.cwd()} upward. Run \`whynot init\` first, or pass --root.`
    );
  }
  return found;
}

const out = (s = '') => process.stdout.write(s + '\n');
const err = (s) => process.stderr.write(s + '\n');

export function run(argv = process.argv.slice(2)) {
  const command = argv[0];
  const { flags, positional, one } = parseArgs(argv.slice(1));

  if (!command || command === '-h' || command === '--help' || one('help')) {
    out(USAGE);
    return 0;
  }

  switch (command) {
    case 'init': {
      const root = one('root') && one('root') !== true ? path.resolve(one('root')) : process.cwd();
      const { dir } = init(root);
      out(`Initialized ${path.relative(process.cwd(), dir) || dir}`);
      out('Added "*.md text eol=lf" to .gitattributes');
      out('');
      out('Next: add the whynot block to your AGENTS.md (see AGENTS.snippet.md),');
      out('and register the MCP server with your agent.');
      return 0;
    }

    case 'add': {
      const root = resolveRoot(one);
      const title = one('title');
      const why = one('why');
      if (!title || title === true) throw new Error('--title is required');
      if (!why || why === true) throw new Error('--why is required');

      const type = one('type') || 'rejected';
      const ttlRaw = one('ttl');
      const ttl = ttlRaw && ttlRaw !== true ? parseInt(ttlRaw, 10) : undefined;
      const expiresRaw = one('expires');

      const created = create(root, {
        title,
        type,
        revisit_when: one('revisit') === true ? undefined : one('revisit'),
        ttl_days: Number.isFinite(ttl) ? ttl : undefined,
        expires_on: expiresRaw && expiresRaw !== true ? expiresRaw : undefined,
        evidence: (flags.evidence || []).filter((e) => e !== true),
        tags: (one('tags') || '')
          .toString()
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        body: `## 为什么\n\n${why}\n`,
      });

      const [saved] = readAll(root).filter((e) => e.id === created.id);
      const left = daysUntilExpiry(saved);
      out(`Recorded [${created.id}] ${created.filename}`);
      out(
        left === null
          ? '  Expires: never (explicitly permanent)'
          : `  Expires: ${expiresOn(saved)} (in ${left} days) — renew with \`whynot renew ${created.id}\``
      );
      return 0;
    }

    case 'list': {
      const root = resolveRoot(one);
      const all = Boolean(one('all'));
      const entries = readAll(root).filter((e) => all || e.status === 'live');
      if (!entries.length) {
        out(`No entries. (\`whynot add\` to record one, \`whynot list --all\` to include retired.)`);
        return 0;
      }
      for (const e of entries) {
        const tag = e.status === 'retired' ? ' [retired]' : '';
        out(summarize(e) + tag);
      }
      out('');
      out(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
      return 0;
    }

    case 'check': {
      const root = resolveRoot(one);
      const query = positional.join(' ');
      const found = check(root, { query, tags: one('tags') ? one('tags').split(',') : [] });
      if (!found.length) {
        out(query ? `Nothing recorded matching "${query}".` : 'No live entries.');
        return 0;
      }
      out(found.map(render).join('\n\n---\n\n'));
      return 0;
    }

    case 'stale': {
      const root = resolveRoot(one);
      const found = stale(root);
      if (!found.length) {
        out('Nothing needs review.');
        return 0;
      }
      for (const e of found) {
        out(`${summarize(e)}\n    ${e.reasons.join('\n    ')}`);
      }
      out('');
      out(
        `${found.length} to review.\n` +
          '  `whynot renew <id>`  — it still holds, extend it\n' +
          '  `whynot retire <id>` — it no longer holds, archive it'
      );
      return 0;
    }

    case 'renew': {
      const root = resolveRoot(one);
      const id = positional[0];
      if (!id) throw new Error('usage: whynot renew <id> [--days N]');
      const days = parseInt(one('days'), 10);
      const done = renew(root, id, { days: Number.isFinite(days) ? days : null });
      out(`Renewed [${done.id}] — now expires ${done.expires_on}.`);
      return 0;
    }

    case 'retire': {
      const root = resolveRoot(one);
      const id = positional[0];
      if (!id) throw new Error('usage: whynot retire <id>');
      const done = retire(root, id);
      out(`Retired [${done.id}]. The file is kept, not deleted.`);
      return 0;
    }

    case 'audit': {
      const explicit = one('root');
      const root = explicit && explicit !== true ? path.resolve(explicit) : process.cwd();
      const days = parseInt(one('days'), 10);
      const report = audit(root, { staleDays: Number.isFinite(days) ? days : 365 });
      out(renderAudit(report));
      return 0;
    }

    case 'mcp': {
      // Blocks on stdin for the life of the process. This is the entry point
      // the documented MCP config uses: `npx -y whynot mcp`.
      serve();
      return 0;
    }

    case 'doctor': {
      const root = resolveRoot(one);
      const entries = readAll(root);
      const problems = [];

      const seen = new Map();
      for (const e of entries) {
        if (!e.id) problems.push(`${e.filename}: missing id`);
        if (!e.title) problems.push(`${e.filename}: missing title`);
        if (!TYPES.includes(e.type)) problems.push(`${e.filename}: unknown type "${e.type}"`);
        if (e.id) {
          if (seen.has(e.id)) problems.push(`duplicate id ${e.id}: ${seen.get(e.id)} and ${e.filename}`);
          else seen.set(e.id, e.filename);
        }
        const expected = e.id && e.title ? `${e.id}-` : null;
        if (expected && !e.filename.startsWith(expected)) {
          problems.push(`${e.filename}: filename does not start with its id (${e.id})`);
        }
      }

      // Retired entries with no retirement date are almost always a hand-edit.
      for (const e of entries) {
        if (e.status === 'retired' && !e.retired_on) {
          problems.push(`${e.filename}: retired but no retired_on date`);
        }
      }

      out(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${path.join(root, DIR_NAME)}`);
      if (!problems.length) {
        out('No problems found.');
        return 0;
      }
      out('');
      for (const p of problems) out(`  ! ${p}`);
      return 1;
    }

    default:
      err(`Unknown command: ${command}`);
      err('');
      err(USAGE);
      return 2;
  }
}

export function main() {
  try {
    process.exitCode = run();
  } catch (e) {
    err(`error: ${e.message}`);
    process.exitCode = 1;
  }
}
