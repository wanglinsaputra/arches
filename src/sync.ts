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
  nodeCreated?: boolean;
  modelAdded?: boolean;
  modelTested?: boolean;
  modelTestOk?: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

const R4_BASE_URL = 'https://api.coder.r4.chat/v1';
const NODE_NAME = 'coder.r4.chat';
const NODE_PREFIX = 'WangLinS';

/**
 * Sync API keys to the 9Router "OpenAI Compatible" node.
 * When disabled or misconfigured, returns a disabled summary without throwing,
 * so the main key-generation flow is never blocked by 9router.
 *
 * When the node does not exist yet it is created with the WangLinS prefix,
 * the given model is added to its Available Models, and the model is tested.
 */
export async function syncKeysToRouter9(
  router9: Router9Config,
  keys: SyncEntry[],
  model: string,
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
    } else if (keys.length > 0) {
      console.log(`  ${c.cyan('Creating OpenAI Compatible node...')}`);
      const created = await client.createOpenAICompatibleNode(NODE_NAME, R4_BASE_URL, NODE_PREFIX);
      console.log(`  ${c.green('✓')} ${c.white('OpenAI Compatible node created')}`);
      nodeId = created.id;
      summary.nodeCreated = true;
      try {
        await client.addModel(nodeId, model);
        summary.modelAdded = true;
        console.log(`  ${c.green('✓')} ${c.white(`Model added: ${model}`)}`);
      } catch (e) {
        summary.errors.push(`add model: ${safeMessage(e)}`);
      }
    } else {
      return { ...summary, status: 'ok', errors: ['no keys to sync'] };
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

  // Always test the model after creation (regardless of user preference)
  if (summary.nodeCreated && summary.modelAdded) {
    summary.modelTested = true;
    summary.modelTestOk = await client.testModel(nodeId, model, NODE_PREFIX);
    console.log(
      summary.modelTestOk
        ? `  ${c.green('✓')} ${c.white(`Model test passed: ${NODE_PREFIX}/${model}`)}`
        : `  ${c.yellow('⚠')} ${c.white(`Model test failed: ${NODE_PREFIX}/${model}`)}`,
    );
  }

  return summary;
}

function safeMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isRouter9Error(e: unknown): e is Router9Error {
  return e instanceof Error && 'code' in e && (e as Router9Error).code !== undefined;
}