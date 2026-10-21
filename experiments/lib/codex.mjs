// Locate the Codex CLI without hardcoding anyone's home directory.
//
// On Windows, npm is a .cmd shim and `execFileSync('npm', ...)` fails with
// ENOENT unless shell: true is set. That failure is silent if the caller falls
// back to a bare "codex", because `codex` is not on PATH either — the result is
// `spawn codex ENOENT` on every run, with no obvious cause.
//
// Resolution order:
//   1. CODEX_BIN env var
//   2. npm global root (shell: true)
//   3. %APPDATA%\npm\node_modules (Windows default)
//   4. bare `codex` on PATH

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function entryUnder(root) {
  const p = path.join(root, '@openai', 'codex', 'bin', 'codex.js');
  return fs.existsSync(p) ? p : null;
}

export function resolveCodex() {
  if (process.env.CODEX_BIN) return { cmd: process.env.CODEX_BIN, prefix: [] };

  const candidates = [];

  try {
    candidates.push(
      execFileSync('npm', ['root', '-g'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: true,
      }).trim()
    );
  } catch {
    /* npm not available */
  }

  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
  candidates.push('/usr/local/lib/node_modules', '/usr/lib/node_modules');

  for (const root of candidates) {
    const entry = entryUnder(root);
    if (entry) return { cmd: 'node', prefix: [entry] };
  }

  return { cmd: 'codex', prefix: [] };
}

export function codexAvailable(resolved = resolveCodex()) {
  if (resolved.cmd === 'node') return fs.existsSync(resolved.prefix[0]);
  try {
    execFileSync(resolved.cmd, ['--version'], { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}
