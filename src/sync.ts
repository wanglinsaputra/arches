import { c } from './banner.js';
import { getMissingRouter9Vars, Router9Config } from './config.js';
import { Router9Client, Router9Error } from './router9.js';

export interface SyncEntry {
  name: string;
  key: string;
}

export interface SyncSummary {
  status: 'disabled' | 'ok' | 'error';
  nodeId?: string;
  synced: number;
  failed: number;
  errors: string[];
}

const R4_BASE_URL = 'https://api.coder.r4.chat/v1';
const NODE_NAME = 'coder.r4.chat';
const NODE_PREFIX = 'r4';

/**
 * Sync API keys to the 9Router "OpenAI Compatible" node.
 * When disabled or misconfigured, returns a disabled summary without throwing,
 * so the main key-generation flow is never blocked by 9router.
 */
export async function syncKeysToRouter9(
  router9: Router9Config,
  keys: SyncEntry[],
): Promise<SyncSummary> {
  if (!router9.url || !router9.password) {
    const missing = getMissingRouter9Vars(router9);
    return {
      status: 'disabled',
      synced: 0,
      failed: keys.length,
      errors: [`9router integration disabled — missing: ${missing.join(', ')}`],
    };
  }

  const client = new Router9Client(router9.url, router9.password);
  const summary: SyncSummary = { status: 'ok', synced: 0, failed: 0, errors: [] };

  try {
    await client.authenticate();
  } catch (e) {
    summary.status = 'error';
    summary.failed = keys.length;
    summary.errors.push(safeMessage(e));
    return summary;
  }

  // Find or create the OpenAI Compatible node
  let nodeId: string;
  try {
    const nodes = await client.getProviderNodes();
    const existing = client.findOpenAICompatibleNode(nodes, R4_BASE_URL);
    if (existing) {
      console.log(`  ${c.yellow('✓')} ${c.white('Existing')} ${c.cyan('OpenAI Compatible')} ${c.white('node found')}`);
      console.log(`  ${c.white(`Using existing node (${existing.name})`)}`);
      nodeId = existing.id;
    } else {
      console.log(`  ${c.cyan('Creating OpenAI Compatible node...')}`);
      const created = await client.createOpenAICompatibleNode(NODE_NAME, R4_BASE_URL, NODE_PREFIX);
      console.log(`  ${c.green('✓')} ${c.white('OpenAI Compatible node created')}`);
      nodeId = created.id;
    }
  } catch (e) {
    summary.status = 'error';
    summary.failed = keys.length;
    summary.errors.push(safeMessage(e));
    return summary;
  }

  const result = await client.bulkAddKeys(nodeId, keys);
  summary.nodeId = nodeId;
  summary.synced = result.synced;
  summary.failed = result.failed;
  for (const f of result.failures) summary.errors.push(f.reason);

  return summary;
}

function safeMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isRouter9Error(e: unknown): e is Router9Error {
  return e instanceof Error && 'code' in e && (e as Router9Error).code !== undefined;
}