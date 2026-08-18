import { randomChoice, randomString } from './utils.js';

export interface TempMailProvider {
  readonly name: string;
  generate(): Promise<string>;
  getVerifyLink(email: string, timeoutMs: number, intervalMs: number): Promise<string | null>;
}

export class NoProviderAvailableError extends Error {
  constructor(provider: string) {
    super(`Temp mail provider ${provider} could not initialize`);
    this.name = 'NoProviderAvailableError';
  }
}

const R4_VERIFY_RE = /https:\/\/api\.coder\.r4\.chat\/api\/auth\/verify-email\?token=[^\s"<>]+/;

/**
 * Mail.tm temp mail provider (REST API).
 */
export class MailTmProvider implements TempMailProvider {
  readonly name = 'mail.tm';
  private readonly apiBase = 'https://api.mail.tm';
  private domain: string | null = null;
  private readonly tokens = new Map<string, string>();

  constructor(private readonly password: string) {}

  private async getDomain(): Promise<string> {
    if (this.domain) return this.domain;
    const res = await fetch(`${this.apiBase}/domains`);
    if (!res.ok) throw new Error(`Mail.tm: failed to fetch domains (${res.status})`);
    const data = (await res.json()) as { 'hydra:member': Array<{ domain: string }> };
    const domains = data['hydra:member'];
    if (!domains.length) throw new Error('Mail.tm: no domains available');
    this.domain = randomChoice(domains).domain;
    return this.domain;
  }

  async generate(): Promise<string> {
    const domain = await this.getDomain();
    for (let attempt = 0; attempt < 3; attempt++) {
      const address = `wl${randomString(10)}@${domain}`;
      const res = await fetch(`${this.apiBase}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password: this.password }),
      });
      if (res.ok) return address;
    }
    throw new Error('Mail.tm: could not create account after 3 attempts');
  }

  private async getToken(email: string): Promise<string> {
    const cached = this.tokens.get(email);
    if (cached) return cached;
    const res = await fetch(`${this.apiBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: email, password: this.password }),
    });
    if (!res.ok) throw new Error(`Mail.tm: token request failed (${res.status})`);
    const data = (await res.json()) as { token: string };
    this.tokens.set(email, data.token);
    return data.token;
  }

  async getVerifyLink(email: string, timeoutMs: number, intervalMs: number): Promise<string | null> {
    const token = await this.getToken(email);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.apiBase}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            'hydra:member': Array<{ id: string; from: { address: string } }>;
          };
          for (const msg of data['hydra:member']) {
            if (msg.from?.address?.includes('r4.chat')) {
              const srcRes = await fetch(`${this.apiBase}/sources/${msg.id}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (srcRes.ok) {
                const src = (await srcRes.json()) as { data?: string };
                const decoded = decodeQuotedPrintable(src.data ?? '');
                const link = decoded.match(R4_VERIFY_RE);
                if (link) return link[0];
              }
            }
          }
        }
      } catch {
        // transient network error, keep polling
      }
      await sleepMs(intervalMs);
    }
    return null;
  }
}

export interface TempMailRegistry {
  [name: string]: (password: string) => TempMailProvider;
}

export const TEMP_MAIL_PROVIDERS: TempMailRegistry = {
  'mail.tm': (password) => new MailTmProvider(password),
};

async function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal quoted-printable decoder. Handles soft line breaks (`=\r\n`)
 * and `=XX` byte escapes. Good enough to recover an embedded URL.
 */
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}