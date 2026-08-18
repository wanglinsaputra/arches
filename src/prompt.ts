import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export function isInteractive(): boolean {
  return Boolean(input.isTTY);
}

/**
 * Ask a yes/no question. Defaults to "no" when `defaultYes` is false.
 * Returns true only for explicit y/yes (case-insensitive).
 */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const answer = (await rl.question(`${question} [${hint}] `)).trim().toLowerCase();
    if (answer === '') return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Ask for a plain value with a default. Empty input returns the default.
 */
export async function ask(question: string, defaultValue: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [${defaultValue}] `)).trim();
    return answer === '' ? defaultValue : answer;
  } finally {
    rl.close();
  }
}

/**
 * Ask for a positive integer. Empty input returns the default.
 */
export async function askNumber(question: string, defaultValue: number): Promise<number> {
  const raw = await ask(question, String(defaultValue));
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return Math.floor(n);
}

/**
 * Ask for a "min-max" delay range in seconds. Empty input returns the default.
 */
export async function askDelay(question: string, defaultValue: string): Promise<string> {
  const raw = await ask(question, defaultValue);
  const parts = raw.split('-').map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return defaultValue;
  }
  return `${Math.floor(parts[0])}-${Math.floor(parts[1])}`;
}