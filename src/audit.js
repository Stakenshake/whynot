// Audit an existing repository for agent rules that are likely to be obeyed
// long after they stopped being true.
//
// This is a heuristic, not a verdict. It looks for the two properties that
// caused the failure in our experiments: absolute language with no stated
// condition, and age. It does not call a model, and it never changes files.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CONFIG_CANDIDATES = [
  'AGENTS.md',
  'AGENTS.override.md',
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
];

// Absolute phrasing — the kind of rule that becomes a permanent constraint.
const ABSOLUTE = [
  /\bnever\b/i,
  /\balways\b/i,
  /\bmust not\b/i,
  /\bdo not\b/i,
  /\bdon'?t\b/i,
  /\bavoid\b/i,
  /不要/,
  /不能/,
  /必须/,
  /禁止/,
  /绝不/,
  /永远/,
  /一律/,
  /不允许/,
];

// Conditional phrasing — the escape hatch that lets a rule expire on its own.
const CONDITION = [
  /\bunless\b/i,
  /\bexcept\b/i,
  /\bif\b/i,
  /\bwhen\b/i,
  /\buntil\b/i,
  /\bonly (?:if|when)\b/i,
  /\brevisit\b/i,
  /除非/,
  /如果/,
  /若/,
  /当/,
  /直到/,
  /仅在/,
  /只有/,
];

// Instruction words carry no topic. Without this, "never" looks like a theme
// shared by every rule in the repo.
const STOPWORDS = new Set([
  'never', 'always', 'must', 'dont', 'avoid', 'only', 'also', 'just', 'even',
  'this', 'that', 'these', 'those', 'with', 'from', 'into', 'your', 'their',
  'there', 'here', 'have', 'has', 'been', 'being', 'when', 'unless', 'except',
  'until', 'some', 'more', 'than', 'then', 'they', 'them', 'what', 'which',
  'code', 'file', 'files', 'project', 'repo', 'repository', 'please', 'should',
  'would', 'could', 'make', 'sure', 'used', 'using', 'need', 'want', 'keep',
  'every', 'each', 'other', 'into', 'over', 'under', 'about', 'after', 'before',
]);

/** Topic-ish tokens. Trailing punctuation is stripped so "redis." == "redis". */
function topicTokens(text) {
  return [
    ...new Set(
      (text.toLowerCase().match(/[a-z][a-z0-9.+#-]{2,}/g) || [])
        .map((t) => t.replace(/[.+#-]+$/, ''))
        .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
    ),
  ];
}

function findConfigFiles(root) {
  const found = [];

  for (const rel of CONFIG_CANDIDATES) {
    const p = path.join(root, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) found.push(p);
  }

  // Directory-style configs.
  for (const dir of ['.cursor/rules', '.github/instructions']) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isFile() && /\.(md|mdc|txt)$/i.test(f)) found.push(p);
    }
  }

  return [...new Set(found)];
}

function lastCommitDaysAgo(root, file, now) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', path.relative(root, file)], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    return Math.floor((now - new Date(Number(out) * 1000)) / 86_400_000);
  } catch {
    return null; // not a git repo, or git missing — age unknown
  }
}

/** Lines that read like an instruction rather than prose or a heading. */
function candidateRules(text) {
  return text
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), number: i + 1 }))
    .filter(({ line }) => line.length >= 6 && !line.startsWith('#') && !line.startsWith('<!--'))
    .filter(({ line }) => ABSOLUTE.some((re) => re.test(line)));
}

export function audit(root, { now = new Date(), staleDays = 365 } = {}) {
  const files = findConfigFiles(root);
  const findings = [];
  const ages = new Map();

  for (const file of files) {
    const age = lastCommitDaysAgo(root, file, now);
    ages.set(file, age);

    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const rule of candidateRules(text)) {
      const hasCondition = CONDITION.some((re) => re.test(rule.line));
      const isOld = age !== null && age >= staleDays;
      if (hasCondition) continue;

      findings.push({
        file: path.relative(root, file),
        line: rule.number,
        text: rule.line.replace(/\s+/g, ' ').slice(0, 140),
        ageDays: age,
        reasons: [
          'absolute rule with no stated condition',
          ...(isOld ? [`unchanged for ${age} days`] : []),
        ],
      });
    }
  }

  // Same topic mentioned in several places drifts apart. Cheap proxy: shared
  // distinctive tokens between rules in different files.
  const byToken = new Map();
  for (const f of findings) {
    for (const token of topicTokens(f.text)) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(f);
    }
  }
  const duplicated = [...byToken.entries()]
    .filter(([, hits]) => new Set(hits.map((h) => h.file)).size > 1)
    .map(([token]) => token);

  return {
    files: files.map((f) => ({ path: path.relative(root, f), ageDays: ages.get(f) })),
    findings,
    duplicatedTokens: [...new Set(duplicated)].slice(0, 10),
    scanned: files.length,
  };
}

/** Human-readable report. Plain text so it can be pasted anywhere. */
export function renderAudit(report) {
  const lines = [];

  if (!report.scanned) {
    lines.push('No agent config files found.');
    lines.push('Looked for: AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules/*, .github/copilot-instructions.md');
    return lines.join('\n');
  }

  lines.push(`Scanned ${report.scanned} agent config file${report.scanned === 1 ? '' : 's'}:`);
  for (const f of report.files) {
    lines.push(`  ${f.path}${f.ageDays === null ? '' : `  (last changed ${f.ageDays}d ago)`}`);
  }
  lines.push('');

  if (!report.findings.length) {
    lines.push('No unqualified absolute rules found. Nothing to review.');
    return lines.join('\n');
  }

  lines.push(`${report.findings.length} rule${report.findings.length === 1 ? '' : 's'} look like permanent constraints:`);
  lines.push('');

  for (const f of report.findings.slice(0, 20)) {
    lines.push(`  ${f.file}:${f.line}`);
    lines.push(`    "${f.text}"`);
    lines.push(`    → ${f.reasons.join('; ')}`);
  }
  if (report.findings.length > 20) lines.push(`  ... and ${report.findings.length - 20} more`);

  if (report.duplicatedTokens.length) {
    lines.push('');
    lines.push(`Topics mentioned across more than one file (may have drifted): ${report.duplicatedTokens.join(', ')}`);
  }

  lines.push('');
  lines.push('These are heuristics, not errors. A rule with no condition is fine —');
  lines.push('until nobody remembers why it exists. whynot turns those into entries');
  lines.push('that expire unless someone renews them.');
  return lines.join('\n');
}
