#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import cliProgress from 'cli-progress';
import { BANNER, SEPARATOR, c } from './banner.js';
import { loadRouter9Config, isRouter9Configured, resolveTempMailProviders } from './config.js';
import { confirm, isInteractive, askNumber, askDelay } from './prompt.js';
import { TempMailManager, DEFAULT_TEMP_MAIL_PROVIDERS } from './tempmail.js';
import { R4Client } from './r4client.js';
import { syncKeysToRouter9, SyncEntry, SyncSummary } from './sync.js';
import { randName, randomInt, sleep } from './utils.js';

interface Options {
  count: number;
  workers: number;
  provider: string;
  model: string;
  password: string;
  outputDir: string;
  valid: string;
  failed: string;
  delay: string;
  router9: boolean | undefined;
  noRouter9: boolean | undefined;
}

interface Result {
  name: string;
  key: string;
  valid: boolean;
}

async function generateOne(mgr: TempMailManager, password: string, model: string): Promise<Result | null> {
  const name = randName();
  let gen;
  try {
    gen = await mgr.generate();
  } catch {
    return null;
  }

  const client = new R4Client(password, model);

  try {
    await client.signup(gen.addr, name);
  } catch {
    return null;
  }

  const verifyUrl = await mgr.getVerifyLink(gen.addr, 90_000, 4_000);
  if (!verifyUrl) return null;

  try {
    await client.verify(verifyUrl);
    await sleep(1000);
    await client.login(gen.addr);
  } catch {
    return null;
  }

  let key: string;
  try {
    key = await client.createKey(name);
  } catch {
    return null;
  }

  const valid = await client.testKey(key);
  return { name, key, valid };
}

async function writeKeys(entries: Result[], file: string): Promise<void> {
  const lines = entries.map((e) => `${e.name}|${e.key}`).join('\n');
  if (lines) await fs.appendFile(file, lines + '\n');
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('r4-bot')
    .description('WangLinS — R4 Coder Auto API Key Generator')
    .version('1.0.0')
    .option('-c, --count <n>', 'number of keys to create', '1')
    .option('-w, --workers <n>', 'concurrent workers', '1')
    .option('-p, --provider <names>', 'temp mail providers (comma-separated)', DEFAULT_TEMP_MAIL_PROVIDERS)
    .option('-m, --model <id>', 'model used to validate keys', 'deepseek-v4-flash-free')
    .option('--password <pw>', 'account password', 'WangLinS2026!')
    .option('--output-dir <dir>', 'directory for result files', 'results')
    .option('--valid <file>', 'output file for valid keys (inside output-dir)', 'valid.txt')
    .option('--failed <file>', 'output file for failed keys', 'failed.txt')
    .option('--delay <min-max>', 'delay between accounts in seconds', '15-40')
    .option('--router9', 'enable 9router auto-add')
    .option('--no-router9', 'disable 9router auto-add');

  program.parse();
  const opts = program.opts<Options>();

  let count = Number(opts.count) || 1;
  let workers = Number(opts.workers) || 1;
  let delay = opts.delay;

  console.log(BANNER);
  console.log(`${SEPARATOR}\n`);

  const router9Cfg = loadRouter9Config();
  let router9Enabled: boolean;
  if (opts.router9 !== undefined) {
    router9Enabled = opts.router9;
  } else if (isInteractive()) {
    router9Enabled = await confirm('Add to 9router?', isRouter9Configured(router9Cfg));
  } else {
    router9Enabled = isRouter9Configured(router9Cfg);
  }

  // interactive wizard: prompt for settings not provided as flags
  if (isInteractive()) {
    if (program.getOptionValueSource('count') === 'default') {
      count = await askNumber('How many keys to create?', count);
    }
    if (program.getOptionValueSource('workers') === 'default') {
      workers = await askNumber('Concurrent workers?', workers);
    }
    if (program.getOptionValueSource('delay') === 'default') {
      delay = await askDelay('Delay between accounts (min-max sec)?', delay);
    }
  }

  count = Math.max(1, count);
  workers = Math.max(1, workers);
  const [delayMin, delayMax] = delay.split('-').map((n) => Math.max(0, Number(n) || 0));

  const tempMailProviders = resolveTempMailProviders(
    program.getOptionValueSource('provider') === 'default' ? undefined : opts.provider,
    DEFAULT_TEMP_MAIL_PROVIDERS,
  );

  // resolve result files inside output-dir; create the folder when missing
  const validFile = path.join(opts.outputDir, opts.valid);
  const failedFile = path.join(opts.outputDir, opts.failed);
  await fs.mkdir(opts.outputDir, { recursive: true });

  console.log(`  ${c.white('Provider :')} ${c.cyan(tempMailProviders)}`);
  console.log(`  ${c.white('Model    :')} ${c.cyan(opts.model)}`);
  console.log(`  ${c.white('Count    :')} ${c.cyan(String(count))}`);
  console.log(`  ${c.white('Workers  :')} ${c.cyan(String(workers))}`);
  console.log(`  ${c.white('Password :')} ${c.cyan('*'.repeat(opts.password.length))}`);
  console.log(`  ${c.white('Output   :')} ${c.cyan(opts.outputDir + '/')}`);
  console.log(`  ${c.white('Valid    :')} ${c.green(opts.valid)}`);
  console.log(`  ${c.white('Failed   :')} ${c.red(opts.failed)}`);
  console.log(`  ${c.white('Delay    :')} ${c.cyan(`${delayMin}-${delayMax}s`)}`);
  console.log(`  ${c.white('9router  :')} ${router9Enabled ? c.green('ENABLED') : c.yellow('DISABLED')}`);
  console.log(`\n${SEPARATOR}\n`);

  // load existing keys to avoid duplicates
  const existingKeys = new Set<string>();
  for (const file of [validFile, failedFile]) {
    try {
      const content = await fs.readFile(file, 'utf8');
      for (const line of content.split('\n')) {
        const idx = line.indexOf('|');
        if (idx >= 0) existingKeys.add(line.slice(idx + 1).trim());
      }
    } catch {
      // file may not exist yet
    }
  }
  if (existingKeys.size) {
    console.log(`  ${c.yellow(`ℹ ${existingKeys.size} existing keys, skipping duplicates`)}\n`);
  }

  const mgr = new TempMailManager(tempMailProviders);
  const bar = new cliProgress.SingleBar(
    { format: `${c.cyan('  Creating')} [{bar}] {value}/{total} [{duration_formatted}]` },
    cliProgress.Presets.shades_classic,
  );
  bar.start(count, 0);

  let validCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const allResults: Result[] = [];

  const runOne = async (): Promise<void> => {
    const result = await generateOne(mgr, opts.password, opts.model);
    if (!result) {
      skippedCount++;
      bar.increment(1);
      return;
    }
    if (existingKeys.has(result.key)) {
      skippedCount++;
      bar.increment(1);
      return;
    }
    allResults.push(result);
    if (result.valid) validCount++;
    else failedCount++;
    bar.increment(1);
  };

  if (workers <= 1) {
    for (let i = 0; i < count; i++) {
      await runOne();
      if (i < count - 1) await sleep(randomInt(delayMin, delayMax) * 1000);
    }
  } else {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = cursor++;
        if (i >= count) return;
        await runOne();
        await sleep(randomInt(delayMin, delayMax) * 1000);
      }
    };
    await Promise.all(Array.from({ length: workers }, worker));
  }

  bar.stop();

  await writeKeys(allResults.filter((r) => r.valid), validFile);
  await writeKeys(allResults.filter((r) => !r.valid), failedFile);

  console.log(`\n${SEPARATOR}`);
  console.log(`  ${c.green(`✓ Valid  : ${validCount}`)}  → ${opts.outputDir}/${opts.valid}`);
  console.log(`  ${c.red(`✗ Failed : ${failedCount}`)}  → ${opts.outputDir}/${opts.failed}`);
  if (skippedCount) console.log(`  ${c.yellow(`- Skipped: ${skippedCount}`)}`);
  console.log(`${SEPARATOR}`);

  if (router9Enabled) {
    const toSync: SyncEntry[] = allResults.filter((r) => r.valid).map((k) => ({ name: k.name, key: k.key }));
    console.log(`\n  ${c.white('9router integration:')} ${c.green('ENABLED')}`);
    const summary: SyncSummary = await syncKeysToRouter9(router9Cfg, toSync, opts.model);
    if (summary.status === 'ok') {
      console.log(`  ${c.green(`✓ Synced: ${summary.synced}`)}`);
      if (summary.failed > 0) console.log(`  ${c.yellow(`⚠ 9router failed: ${summary.failed}`)}`);
      if (summary.modelTested) {
        console.log(
          summary.modelTestOk
            ? `  ${c.green('✓ Model test: PASSED')}`
            : `  ${c.yellow('⚠ Model test: FAILED')}`,
        );
      }
    } else {
      console.log(`  ${c.red(`⚠ 9router ${summary.status}: ${summary.errors.join('; ')}`)}`);
    }
  } else {
    console.log(`\n  ${c.white('9router integration:')} ${c.yellow('DISABLED')}`);
  }

  console.log(`\n  ${c.cyan('Done — WangLinS')}\n`);
}

main().catch((e: unknown) => {
  console.error(`\n${c.red('Fatal:')} ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
