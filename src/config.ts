import 'dotenv/config';

export interface Router9Config {
  url: string | undefined;
  password: string | undefined;
}

export interface AppConfig {
  count: number;
  workers: number;
  model: string;
  password: string;
  validFile: string;
  failedFile: string;
  delayMin: number;
  delayMax: number;
  router9Enabled: boolean;
  router9: Router9Config;
}

export function loadRouter9Config(): Router9Config {
  return {
    url: process.env.ROUTER9_URL || undefined,
    password: process.env.ROUTER9_PASS || undefined,
  };
}

export function isRouter9Configured(cfg: Router9Config): boolean {
  return Boolean(cfg.url && cfg.password);
}

export function getMissingRouter9Vars(cfg: Router9Config): string[] {
  const missing: string[] = [];
  if (!cfg.url) missing.push('ROUTER9_URL');
  if (!cfg.password) missing.push('ROUTER9_PASS');
  return missing;
}

/**
 * Resolve the temp mail provider list: CLI value wins, falls back to
 * TEMPMAIL_PROVIDER env (comma/pipe/semicolon separated), then the default.
 */
export function resolveTempMailProviders(cliValue: string | undefined, fallback: string): string {
  if (cliValue && cliValue.trim()) return cliValue;
  const env = process.env.TEMPMAIL_PROVIDER;
  if (env && env.trim()) return env;
  return fallback;
}
