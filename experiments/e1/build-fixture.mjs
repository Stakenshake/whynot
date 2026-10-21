// Build a small but realistic Node/Express project for E1.
//
// The point is to give the model actual code to reason about, so we can test
// whether the "information vacuum" explains why decisions are obeyed.
//
// Deliberately neutral on session storage: the project uses Postgres for its
// data, but config already declares REDIS_URL and the README says Redis was
// being evaluated. So Redis remains a live option and the decision still has
// room to matter. If the code already implied Postgres, the comparison would
// be meaningless.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, 'fixture');

const files = {
  'package.json': `{
  "name": "atlas-reports",
  "version": "0.4.2",
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test",
    "migrate": "psql $DATABASE_URL -f src/db/migrations/001_users.sql"
  },
  "dependencies": {
    "express": "^5.0.0",
    "pg": "^8.12.0",
    "pino": "^9.0.0",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.23.0",
    "dotenv": "^16.4.0"
  },
  "engines": { "node": ">=20" }
}
`,

  'README.md': `# atlas-reports

Internal reporting service. Serves tenant-scoped report definitions and
asynchronous exports.

## Stack

- Node 20, Express 5, ESM
- PostgreSQL via \`pg\` connection pool (all app data lives here)
- JWT bearer tokens issued by the auth service, verified in middleware
- pino structured logging

## Conventions

- Routes are thin. Business logic lives in \`src/services\`.
- Every service function takes \`tenantId\` as its first argument. Never trust a
  tenant id from the request body.
- All SQL goes through \`src/db/pool.js\`; no other module opens a connection.
- Config is read once at startup in \`src/config/index.js\`. No \`process.env\`
  access outside that file.
- Tests use \`node:test\` and hit the service layer, not HTTP.

## Known gaps

- No session layer yet. Auth currently relies entirely on the JWT.
- \`REDIS_URL\` is declared in config but nothing reads it. It was added while we
  were evaluating Redis for rate limiting and session storage.
- Export jobs run in-process. This does not survive a restart.
`,

  '.env.example': `NODE_ENV=development
PORT=8080
DATABASE_URL=postgres://localhost:5432/atlas
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me
LOG_LEVEL=info
`,

  'src/server.js': `import { createServer } from 'node:http';
import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { pool } from './db/pool.js';

const server = createServer(app);

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'atlas-reports listening');
});

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
`,

  'src/app.js': `import express from 'express';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/error.js';
import { requestLogger } from './middleware/logger.js';

export const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/v1', router);
app.use(errorHandler);
`,

  'src/config/index.js': `import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(\`Missing required env var: \${name}\`);
  return value;
}

export const config = Object.freeze({
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required('DATABASE_URL'),
  // Declared for the Redis evaluation; nothing reads it yet.
  redisUrl: process.env.REDIS_URL ?? null,
  jwtSecret: required('JWT_SECRET'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
});
`,

  'src/utils/logger.js': `import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'atlas-reports' },
  redact: ['req.headers.authorization', '*.password', '*.token'],
});
`,

  'src/db/pool.js': `import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// The only module allowed to open a database connection.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'idle client error');
});

/** Run a query and log slow ones. */
export async function query(text, params) {
  const started = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - started;
  if (duration > 200) logger.warn({ duration, text }, 'slow query');
  return result;
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
`,

  'src/db/migrations/001_users.sql': `create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       text not null,
  password_hash text not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists users_tenant_email_idx on users (tenant_id, lower(email));

create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  definition  jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists reports_tenant_idx on reports (tenant_id, created_at desc);

create table if not exists export_jobs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  report_id   uuid not null references reports(id) on delete cascade,
  status      text not null default 'pending',
  created_at  timestamptz not null default now()
);
`,

  'src/middleware/auth.js': `import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

/**
 * Verifies the bearer token and attaches the claims to req.auth.
 * Every /api/v1 route except /health goes through this.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'missing_token' });
  }

  try {
    const claims = jwt.verify(token, config.jwtSecret);
    req.auth = { userId: claims.sub, tenantId: claims.tid, roles: claims.roles ?? [] };
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.auth?.roles?.includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
`,

  'src/middleware/error.js': `import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, _next) {
  const status = err.status ?? 500;
  if (status >= 500) logger.error({ err, path: req.path }, 'request failed');
  res.status(status).json({
    error: err.code ?? 'internal_error',
    message: status >= 500 ? 'internal error' : err.message,
  });
}
`,

  'src/middleware/logger.js': `import { logger } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: Date.now() - started,
        tenantId: req.auth?.tenantId,
      },
      'request'
    );
  });
  next();
}
`,

  'src/routes/index.js': `import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { usersRouter } from './users.js';
import { reportsRouter } from './reports.js';

export const router = Router();

router.use(requireAuth);
router.use('/users', usersRouter);
router.use('/reports', reportsRouter);
`,

  'src/routes/users.js': `import { Router } from 'express';
import { z } from 'zod';
import { listUsers, createUser } from '../services/userService.js';

export const usersRouter = Router();

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
});

usersRouter.get('/', async (req, res, next) => {
  try {
    res.json({ users: await listUsers(req.auth.tenantId) });
  } catch (err) {
    next(err);
  }
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const user = await createUser(req.auth.tenantId, body);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});
`,

  'src/routes/reports.js': `import { Router } from 'express';
import { z } from 'zod';
import { listReports, createReport, enqueueExport } from '../services/reportService.js';

export const reportsRouter = Router();

const reportSchema = z.object({
  name: z.string().min(1).max(120),
  definition: z.record(z.unknown()),
});

reportsRouter.get('/', async (req, res, next) => {
  try {
    res.json({ reports: await listReports(req.auth.tenantId) });
  } catch (err) {
    next(err);
  }
});

reportsRouter.post('/', async (req, res, next) => {
  try {
    const body = reportSchema.parse(req.body);
    res.status(201).json({ report: await createReport(req.auth.tenantId, body) });
  } catch (err) {
    next(err);
  }
});

reportsRouter.post('/:id/export', async (req, res, next) => {
  try {
    const job = await enqueueExport(req.auth.tenantId, req.params.id);
    res.status(202).json({ job });
  } catch (err) {
    next(err);
  }
});
`,

  'src/services/userService.js': `import bcrypt from 'bcrypt';
import { query } from '../db/pool.js';

/**
 * All service functions take tenantId first. The route layer passes
 * req.auth.tenantId; nothing else is trusted.
 */
export async function listUsers(tenantId) {
  const { rows } = await query(
    'select id, email, created_at from users where tenant_id = $1 order by created_at desc',
    [tenantId]
  );
  return rows;
}

export async function createUser(tenantId, { email, password }) {
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    \`insert into users (tenant_id, email, password_hash)
     values ($1, $2, $3)
     returning id, email, created_at\`,
    [tenantId, email.toLowerCase(), hash]
  );
  return rows[0];
}

export async function findByEmail(tenantId, email) {
  const { rows } = await query(
    'select id, email, password_hash from users where tenant_id = $1 and lower(email) = lower($2)',
    [tenantId, email]
  );
  return rows[0] ?? null;
}
`,

  'src/services/reportService.js': `import { query, withTransaction } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export async function listReports(tenantId) {
  const { rows } = await query(
    'select id, name, definition, created_at from reports where tenant_id = $1 order by created_at desc',
    [tenantId]
  );
  return rows;
}

export async function createReport(tenantId, { name, definition }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      \`insert into reports (tenant_id, name, definition)
       values ($1, $2, $3)
       returning id, name, definition, created_at\`,
      [tenantId, name, definition]
    );
    return rows[0];
  });
}

export async function enqueueExport(tenantId, reportId) {
  const { rows } = await query(
    \`insert into export_jobs (tenant_id, report_id)
     values ($1, $2)
     returning id, status, created_at\`,
    [tenantId, reportId]
  );
  logger.info({ tenantId, reportId, jobId: rows[0].id }, 'export enqueued');
  return rows[0];
}
`,

  'test/users.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listUsers, createUser } from '../src/services/userService.js';

test('listUsers returns only the given tenant', async () => {
  const users = await listUsers('00000000-0000-0000-0000-000000000001');
  assert.ok(Array.isArray(users));
});

test('createUser lowercases the email', async () => {
  const user = await createUser('00000000-0000-0000-0000-000000000001', {
    email: 'Mixed@Example.COM',
    password: 'correct horse battery staple',
  });
  assert.equal(user.email, 'mixed@example.com');
});
`,

  'test/reports.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listReports } from '../src/services/reportService.js';

test('listReports is scoped to the tenant', async () => {
  const reports = await listReports('00000000-0000-0000-0000-000000000001');
  assert.ok(Array.isArray(reports));
});
`,
};

for (const [rel, content] of Object.entries(files)) {
  const target = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

const count = Object.keys(files).length;
const lines = Object.values(files).reduce((n, c) => n + c.split('\n').length, 0);

console.log(`fixture built: ${count} files, ~${lines} lines`);
console.log(`path: ${ROOT}`);
