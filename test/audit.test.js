import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { audit, renderAudit } from '../src/audit.js';

function tmpRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whynot-audit-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  return root;
}

test('flags an absolute rule with no condition', () => {
  const root = tmpRepo({
    'AGENTS.md': '# Rules\n\nNever use TypeScript in this project.\n\nUse tabs.\n',
  });

  const report = audit(root);
  assert.equal(report.scanned, 1);
  assert.equal(report.findings.length, 1);
  assert.match(report.findings[0].text, /Never use TypeScript/);
  assert.match(report.findings[0].reasons.join(' '), /no stated condition/);
});

test('does not flag a rule that states a condition', () => {
  const root = tmpRepo({
    'AGENTS.md': 'Never use TypeScript unless the team has a build pipeline.\n',
  });

  const report = audit(root);
  assert.equal(report.findings.length, 0);
});

test('recognises Chinese absolute phrasing and Chinese conditions', () => {
  const root = tmpRepo({
    'CLAUDE.md': ['不要使用 Redis。', '除非 Redis 支持跨区域强一致，否则不要用 Redis。'].join('\n'),
  });

  const report = audit(root);
  assert.equal(report.findings.length, 1, 'only the unconditional line is flagged');
  assert.match(report.findings[0].text, /不要使用 Redis/);
});

test('scans every known config location', () => {
  const root = tmpRepo({
    'AGENTS.md': 'Never do A.\n',
    'CLAUDE.md': 'Never do B.\n',
    '.cursor/rules/style.mdc': 'Never do C.\n',
    '.github/copilot-instructions.md': 'Never do D.\n',
  });

  const report = audit(root);
  assert.equal(report.scanned, 4);
  assert.equal(report.findings.length, 4);
});

test('reports topics mentioned in more than one file', () => {
  const root = tmpRepo({
    'AGENTS.md': 'Never use redis for sessions.\n',
    'CLAUDE.md': 'Never put sessions in redis.\n',
  });

  const report = audit(root);
  assert.ok(report.duplicatedTokens.includes('redis'));
});

test('says so plainly when there is nothing to scan', () => {
  const root = tmpRepo({ 'README.md': '# nothing here\n' });
  const text = renderAudit(audit(root));
  assert.match(text, /No agent config files found/);
});

test('rendering is plain text and admits it is a heuristic', () => {
  const root = tmpRepo({ 'AGENTS.md': 'Never use TypeScript.\n' });
  const text = renderAudit(audit(root));

  assert.match(text, /look like permanent constraints/);
  assert.match(text, /heuristics, not errors/);
  assert.doesNotMatch(text, /\u001b\[/, 'no ANSI escapes — this gets pasted into issues');
});
