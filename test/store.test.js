import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parse, stringify } from '../src/frontmatter.js';
import {
  init,
  create,
  retire,
  renew,
  check,
  stale,
  readAll,
  slugify,
  findRoot,
  listIndex,
  render,
  expiresOn,
  expiredMatching,
  DIR_NAME,
} from '../src/store.js';
import { handle } from '../src/mcp.js';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whynot-'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

test('frontmatter round-trips scalars, lists, and quoted values', () => {
  const data = {
    id: '0001',
    title: 'session 不存 Redis',
    type: 'rejected',
    status: 'live',
    created: '2026-10-14',
    revisit_when: 'Redis 支持跨区域强一致时',
    evidence: ['commit:a3f9c2', 'pr:412'],
    tags: ['infra', 'session'],
  };
  const text = stringify(data, '## 为什么\n\n延迟太高。');
  const back = parse(text);

  assert.equal(back.data.title, 'session 不存 Redis');
  assert.equal(back.data.revisit_when, 'Redis 支持跨区域强一致时');
  assert.deepEqual(back.data.evidence, ['commit:a3f9c2', 'pr:412']);
  assert.deepEqual(back.data.tags, ['infra', 'session']);
  assert.match(back.body, /延迟太高/);
});

test('parse tolerates a file with no frontmatter', () => {
  const { data, body } = parse('# just markdown\n');
  assert.deepEqual(data, {});
  assert.match(body, /just markdown/);
});

test('slugify strips Windows-illegal characters and keeps CJK', () => {
  assert.equal(slugify('Redis? No: <thanks>'), 'redis-no-thanks');
  assert.equal(slugify('不存 Redis'), '不存-redis');
  assert.equal(slugify('***'), 'entry');
  assert.ok(slugify('a'.repeat(200)).length <= 40);
});

test('init creates the dir and appends the eol rule', () => {
  const root = tmpRepo();
  init(root);

  assert.ok(fs.existsSync(path.join(root, DIR_NAME)));
  const attrs = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  assert.match(attrs, /\*\.md text eol=lf/);

  // Idempotent: a second init must not duplicate the rule.
  init(root);
  const again = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  assert.equal((again.match(/eol=lf/g) || []).length, 1);
});

test('findRoot walks up from a subdirectory', () => {
  const root = tmpRepo();
  init(root);
  const deep = path.join(root, 'src', 'a', 'b');
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(findRoot(deep), root);
});

test('create then check finds the entry by keyword', () => {
  const root = tmpRepo();
  init(root);
  create(root, {
    title: 'session 不存 Redis',
    type: 'rejected',
    revisit_when: 'Redis 支持跨区域强一致时',
    tags: ['infra'],
    evidence: ['pr:412'],
    body: '## 为什么\n\nus-east 故障时读延迟 8s。',
  });

  assert.equal(check(root, { query: 'redis' }).length, 1);
  assert.equal(check(root, { query: 'session' }).length, 1);
  assert.equal(check(root, { query: 'postgres' }).length, 0);
  assert.equal(check(root, { tags: ['infra'] }).length, 1);
  assert.equal(check(root, { tags: ['frontend'] }).length, 0);
});

test('retire keeps the file but removes it from live results', () => {
  const root = tmpRepo();
  init(root);
  const { id, file } = create(root, { title: 'no graphql', type: 'rejected', body: 'x' });

  assert.equal(check(root, {}).length, 1);
  retire(root, id);

  assert.equal(check(root, {}).length, 0, 'retired entries are not live');
  assert.ok(fs.existsSync(file), 'the file must survive retirement');
  assert.equal(readAll(root)[0].status, 'retired');
});

test('ids increment and filenames stay Windows-safe', () => {
  const root = tmpRepo();
  init(root);
  const a = create(root, { title: 'one', type: 'decision', body: 'x' });
  const b = create(root, { title: 'two: <bad>?', type: 'decision', body: 'x' });

  assert.equal(a.id, '0001');
  assert.equal(b.id, '0002');
  for (const e of readAll(root)) {
    assert.doesNotMatch(path.basename(e.file), /[\\/:*?"<>|]/, 'no Windows-illegal chars in filenames');
  }
});

test('an expired entry is invisible to the agent', () => {
  // The safety mechanism. A 2019 "do not use TypeScript" note caused 6/6 model
  // responses to reject TypeScript for a brand-new 2026 service, and asking the
  // agent to "be skeptical" did not fix it. So the entry stops being shown.
  const root = tmpRepo();
  init(root);
  create(root, { title: '不使用 TypeScript', type: 'rejected', body: '团队不熟', created: '2019-03-02' });

  const now = new Date('2026-10-20');
  assert.equal(check(root, { now }).length, 0, 'expired entries must not be returned');
  assert.equal(listIndex(root, { now }).length, 0, 'nor appear in the index');

  // ...but it is not lost, and it is not silently retired.
  assert.equal(readAll(root)[0].status, 'live');
  const found = stale(root, { now });
  assert.equal(found.length, 1);
  assert.equal(found[0].expired, true);
  assert.match(found[0].reasons.join(' '), /EXPIRED/);
});

test('renewing makes an expired entry visible again', () => {
  const root = tmpRepo();
  init(root);
  const { id } = create(root, { title: 'old', type: 'rejected', body: 'x', created: '2020-01-01' });

  const now = new Date('2026-10-20');
  assert.equal(check(root, { now }).length, 0);

  const done = renew(root, id, { days: 30, now });
  assert.ok(done.expires_on > '2026-10-20');
  assert.equal(check(root, { now }).length, 1, 'renewed entries come back');
  assert.equal(stale(root, { now }).filter((e) => e.expired).length, 0);
});

test('expiry defaults differ by type and can be overridden', () => {
  const root = tmpRepo();
  init(root);
  create(root, { title: 'r', type: 'rejected', body: 'x', created: '2026-01-01' });
  create(root, { title: 'c', type: 'constraint', body: 'x', created: '2026-01-01' });
  create(root, { title: 'custom', type: 'rejected', body: 'x', created: '2026-01-01', ttl_days: 7 });

  const byTitle = Object.fromEntries(readAll(root).map((e) => [e.title, e]));
  assert.equal(byTitle.r.expires_on, '2026-04-01'); // rejected = 90d
  assert.equal(byTitle.c.expires_on, '2027-01-01'); // constraint = 365d
  assert.equal(byTitle.custom.expires_on, '2026-01-08'); // explicit override
});

test('expires_on: never makes an entry explicitly permanent', () => {
  const root = tmpRepo();
  init(root);
  create(root, { title: 'legal', type: 'constraint', body: 'x', created: '2019-01-01', expires_on: 'never' });

  const now = new Date('2030-01-01');
  assert.equal(check(root, { now }).length, 1, 'permanent entries never expire');
  assert.equal(expiresOn(readAll(root)[0]), null);
});

test('expiredMatching reports existence so the agent can ask, without the content', () => {
  const root = tmpRepo();
  init(root);
  create(root, {
    title: 'session 不存 Redis',
    type: 'rejected',
    body: 'us-east 故障时延迟 8s',
    created: '2019-01-01',
    tags: ['infra'],
  });

  const now = new Date('2026-10-20');
  const gone = expiredMatching(root, { query: 'redis', now });

  assert.equal(gone.length, 1, 'the agent is told something exists');
  assert.equal(gone[0].id, '0001');
  // The caller must only forward the fact of it, never the reasoning.
  assert.match(gone[0].body, /延迟/);
  assert.equal(check(root, { query: 'redis', now }).length, 0);
});

test('MCP handshake and tools/list', () => {
  const initRes = handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(initRes.result.serverInfo.name, 'whynot');
  assert.equal(initRes.result.protocolVersion, '2024-11-05');

  // An unknown protocol version falls back rather than failing.
  const odd = handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '9999-01-01' } });
  assert.equal(odd.result.protocolVersion, '2024-11-05');

  const list = handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ['decisions_check', 'decisions_record', 'decisions_stale']
  );

  // Notifications produce no response.
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('MCP tool call round-trip writes and reads a decision', () => {
  const root = tmpRepo();
  init(root);

  const rec = handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'decisions_record',
      arguments: {
        root,
        title: 'session 不存 Redis',
        why: 'us-east 故障时读延迟 8s',
        type: 'rejected',
        tags: ['infra'],
      },
    },
  });
  assert.match(rec.result.content[0].text, /Recorded as 0001/);

  const got = handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'decisions_check', arguments: { root, query: 'redis' } },
  });
  assert.match(got.result.content[0].text, /session 不存 Redis/);
  assert.match(got.result.content[0].text, /us-east/);
});

test('a tool error is reported in-band so the agent can recover', () => {
  const root = tmpRepo();
  init(root);
  const res = handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'decisions_record', arguments: { root, title: 'x' } }, // no why
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /Error/);
});

test('matching is scored, so a paraphrase still surfaces the entry', () => {
  const root = tmpRepo();
  init(root);
  create(root, { title: 'session 不存 Redis', type: 'rejected', tags: ['infra'], body: '延迟太高' });

  // Requiring every term would return nothing here — and the agent would then
  // re-propose Redis. Partial matches must still surface.
  assert.equal(check(root, { query: 'session 存储' }).length, 1);
  assert.equal(check(root, { query: 'redis 存储方案' }).length, 1);

  // A better match outranks a weaker one.
  create(root, { title: 'session cookie 太大', type: 'decision', body: '客户端加密方案' });
  const ranked = check(root, { query: 'session 存储' });
  assert.equal(ranked[0].title, 'session 不存 Redis');
});

test('check with no query returns the compact index, not full bodies', () => {
  const root = tmpRepo();
  init(root);
  create(root, { title: 'session 不存 Redis', type: 'rejected', tags: ['infra'], body: '一段很长的正文'.repeat(50) });

  const res = handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'decisions_check', arguments: { root } },
  });
  const text = res.result.content[0].text;

  assert.match(text, /session 不存 Redis/);
  assert.doesNotMatch(text, /一段很长的正文/, 'bodies must not be dumped into context');
  assert.match(text, /titles only/);
});

test('listIndex() returns titles and tags without bodies', () => {
  const root = tmpRepo();
  init(root);
  create(root, { title: 'a', type: 'rejected', tags: ['x'], body: 'BODYTEXT' });
  const rows = listIndex(root);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'a');
  assert.deepEqual(rows[0].tags, ['x']);
  assert.equal(rows[0].body, undefined);
});

test('rendering states the expiry, so the agent can weigh the entry', () => {
  const root = tmpRepo();
  init(root);
  create(root, { title: 'session 不存 Redis', type: 'rejected', body: '延迟', created: '2026-10-14' });

  const [entry] = readAll(root);
  const text = render(entry, { now: new Date('2026-10-20') });

  assert.match(text, /expires: \d{4}-\d{2}-\d{2} \(in \d+ days\)/);
  assert.match(text, /created: 2026-10-14/);
});

test('a conditional entry tells the agent to check the condition, not to obey', () => {
  const root = tmpRepo();
  init(root);
  create(root, {
    title: 'session 不存 Redis',
    type: 'rejected',
    body: '延迟',
    created: '2026-10-14',
    revisit_when: 'Redis 支持跨区域强一致时',
  });

  const [entry] = readAll(root);
  const text = render(entry, { now: new Date('2026-10-20') });
  assert.match(text, /revisit_when: Redis 支持跨区域强一致时/);
  assert.match(text, /ask the user/);
});

test('a permanent entry says so explicitly', () => {
  const root = tmpRepo();
  init(root);
  create(root, { title: 'x', type: 'constraint', body: 'y', expires_on: 'never' });
  assert.match(render(readAll(root)[0]), /expires: never/);
});
