// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0).
//
// Hand-rolled on purpose: it keeps the package dependency-free so `node` can
// run it with no install step, which is what makes the validation experiments
// frictionless. Swap in @modelcontextprotocol/sdk once the shape is settled.

import path from 'node:path';
import {
  findRoot,
  check,
  listIndex,
  expiredMatching,
  create,
  stale,
  render,
  readAll,
  daysUntilExpiry,
  TYPES,
  DEFAULT_TTL_DAYS,
} from './store.js';

export const SERVER_INFO = { name: 'whynot', version: '0.1.0' };

// Versions we know how to speak. We echo the client's choice when we can.
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2024-11-05'];
const DEFAULT_PROTOCOL = '2024-11-05';

const TOOLS = [
  {
    name: 'decisions_check',
    description:
      'Look up decisions, constraints, and rejected approaches already recorded for this repository. ' +
      'Call this BEFORE proposing a technical approach, so you do not re-suggest something the team already ruled out.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to match against title, tags, and body. Omit to list everything live.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only return entries carrying at least one of these tags.',
        },
        type: {
          type: 'string',
          enum: TYPES,
          description: 'Restrict to one entry type.',
        },
      },
    },
  },
  {
    name: 'decisions_record',
    description:
      'Record a decision, constraint, or — most valuable — an approach that was tried and REJECTED, with the reason. ' +
      'Use this when the user rejects a suggestion, or when you discover a path that does not work.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short statement of the decision or rejection.' },
        why: { type: 'string', description: 'The reason. For rejections, what specifically failed.' },
        type: { type: 'string', enum: TYPES, default: 'rejected' },
        revisit_when: {
          type: 'string',
          description:
            'Condition under which this should be reconsidered. Strongly preferred over leaving it blank.',
        },
        ttl_days: {
          type: 'number',
          description:
            `Days until this entry expires and stops being shown. Defaults: rejected ${DEFAULT_TTL_DAYS.rejected}, ` +
            `decision ${DEFAULT_TTL_DAYS.decision}, constraint ${DEFAULT_TTL_DAYS.constraint}.`,
        },
        evidence: {
          type: 'array',
          items: { type: 'string' },
          description: 'Pointers that let a human verify this later, e.g. "commit:a3f9c2", "pr:412", a URL.',
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'why'],
    },
  },
  {
    name: 'decisions_stale',
    description:
      'List entries that need a human decision: those that have expired (and are therefore no longer being applied) ' +
      'and those expiring soon. Use this when planning, so expired knowledge gets re-confirmed instead of silently lost.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function resolveRoot(args) {
  const explicit = args?.root || process.env.WHYNOT_ROOT;
  if (explicit) return path.resolve(explicit);
  const found = findRoot(process.cwd());
  if (!found) {
    throw new Error(
      `No ${'.decisions'} directory found from ${process.cwd()} upward. Run \`whynot init\` in your repo first.`
    );
  }
  return found;
}

function text(s) {
  return { content: [{ type: 'text', text: s }] };
}

export function callTool(name, args = {}) {
  const root = resolveRoot(args);

  switch (name) {
    case 'decisions_check': {
      const query = args.query || '';

      // Entries that have expired are deliberately never shown. Telling the
      // agent "this is old, be appropriately skeptical" was tested and does not
      // work; it cannot obey what it cannot see. It is told only that something
      // exists, so it can ask the user — the content stays hidden.
      const expiredNote = () => {
        const gone = expiredMatching(root, { query, tags: args.tags || [], type: args.type || null });
        if (!gone.length) return '';
        return (
          `\n\nNote: ${gone.length} older entr${gone.length === 1 ? 'y' : 'ies'} on this topic ` +
          `(${gone.map((e) => `[${e.id}]`).join(', ')}) ${gone.length === 1 ? 'has' : 'have'} expired and ` +
          `${gone.length === 1 ? 'is' : 'are'} not shown. They may or may not still apply. ` +
          `Tell the user and let them decide — do not guess.`
        );
      };

      // No query = "what is already settled here?" Return a compact index, not
      // full bodies. Dumping every entry would reintroduce exactly the context
      // bloat this tool exists to remove; the agent can follow up on the few
      // ids that look relevant.
      if (!query && !args.tags?.length && !args.type) {
        const rows = listIndex(root);
        if (!rows.length) return text('No decisions recorded yet.');
        return text(
          `${rows.length} settled decision${rows.length === 1 ? '' : 's'} in this repository ` +
            `(titles only — call again with a \`query\` to read the full entry):\n\n` +
            rows
              .map(
                (r) =>
                  `[${r.id}] (${r.type}) ${r.title}` +
                  (r.tags.length ? `  #${r.tags.join(' #')}` : '') +
                  (r.revisit_when ? `  — revisit when: ${r.revisit_when}` : '')
              )
              .join('\n')
        );
      }

      const found = check(root, {
        query,
        tags: args.tags || [],
        type: args.type || null,
      });

      if (!found.length) {
        return text(
          `No current decision matches "${query}". Nothing is settled on this topic right now.` +
            expiredNote()
        );
      }

      const header = `${found.length} live entr${found.length === 1 ? 'y' : 'ies'} relevant — treat these as already-settled:\n`;
      return text(header + '\n\n---\n\n' + found.map(render).join('\n\n---\n\n') + expiredNote());
    }

    case 'decisions_record': {
      // The schema declares these required; enforce it here too, because a
      // rejection recorded without a reason is worse than no record at all —
      // it will be trusted for months without saying anything useful.
      if (!args.title || !String(args.title).trim()) {
        throw new Error('title is required');
      }
      if (!args.why || !String(args.why).trim()) {
        throw new Error('why is required — say what specifically failed, not just "it did not work"');
      }

      const created = create(root, {
        title: args.title,
        type: args.type || 'rejected',
        revisit_when: args.revisit_when,
        ttl_days: args.ttl_days,
        evidence: args.evidence,
        tags: args.tags,
        body: `## 为什么\n\n${args.why}\n`,
      });

      const [saved] = readAll(root).filter((e) => e.id === created.id);
      const left = daysUntilExpiry(saved);
      return text(
        `Recorded as ${created.id} (${created.filename}). ` +
          (left === null
            ? 'Marked permanent — it will not expire.'
            : `It expires in ${left} days unless a human renews it. ` +
              'Tell the user, so a stale entry does not silently keep applying later.')
      );
    }

    case 'decisions_stale': {
      const found = stale(root);
      if (!found.length) return text('Nothing needs review.');

      const expired = found.filter((e) => e.expired);
      const soon = found.filter((e) => !e.expired);

      let msg = '';
      if (expired.length) {
        msg +=
          `${expired.length} entr${expired.length === 1 ? 'y has' : 'ies have'} EXPIRED and ` +
          `${expired.length === 1 ? 'is' : 'are'} no longer being applied. Ask the user whether each still ` +
          `holds, then have them run \`whynot renew <id>\` or \`whynot retire <id>\`:\n` +
          expired.map((e) => `- [${e.id}] ${e.title}`).join('\n');
      }
      if (soon.length) {
        msg +=
          (msg ? '\n\n' : '') +
          `${soon.length} will expire soon:\n` +
          soon.map((e) => `- [${e.id}] ${e.title} — ${e.reasons.join('; ')}`).join('\n');
      }
      return text(msg);
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export function handle(msg) {
  const { id, method, params } = msg || {};

  // Notifications have no id and expect no response.
  if (id === undefined || id === null) return null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      try {
        return { jsonrpc: '2.0', id, result: callTool(params?.name, params?.arguments) };
      } catch (err) {
        // Tool errors are reported in-band so the agent can recover.
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

export function serve(io = process) {
  let buffer = '';

  io.stdin.setEncoding('utf8');
  io.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // ignore unparseable lines rather than killing the server
      }

      const response = handle(msg);
      if (response) io.stdout.write(JSON.stringify(response) + '\n');
    }
  });

  io.stdin.on('end', () => process.exit(0));
}

// Allow `node src/mcp.js` directly.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  serve();
}
