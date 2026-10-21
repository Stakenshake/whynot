// Public API.
//
// `import { create, check } from 'whynot'` gives you the store. The MCP server
// and the CLI are separate entry points; they are not part of this surface.
//
// Everything here is synchronous and filesystem-backed. There is no client, no
// connection, and no state beyond the files in the repository.

export {
  // Layout
  findRoot,
  DIR_NAME,
  TYPES,
  // Write
  init,
  create,
  retire,
  renew,
  // Read
  readAll,
  check,
  listIndex,
  stale,
  render,
  summarize,
  // Expiry
  expiresOn,
  isExpired,
  daysUntilExpiry,
  DEFAULT_TTL_DAYS,
  NEVER,
} from './store.js';

export { audit, renderAudit } from './audit.js';
