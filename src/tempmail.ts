import { createProvider, type TempMailProvider } from '@wanglinsaputra/tempmail-wrapper';
import { sleep } from './utils.js';

const R4_VERIFY_RE = /https:\/\/api\.coder\.r4\.chat\/api\/auth\/verify-email\?token=[^\s"<>]+/;

// Domains commonly blocked by target services — skip these providers.
const BLOCKED_EMAIL_DOMAINS = new Set([
  'mailto.plus', 'tempmail.plus', 'yopmail.com', 'guerrillamail.com',
  'guerrillamail.net', 'sharklasers.com', 'mailinator.com', '10minutemail.com',
  'temp-mail.org', 'throwaway.email',
]);

export interface GeneratedMail {
  addr: string;
  provider: string;
}

export const DEFAULT_TEMP_MAIL_PROVIDERS = 'mail.tm,zoromail';

/**
 * Multi-provider temp mail manager (backed by @wanglinsaputra/tempmail-wrapper).
 * Tries providers in order and falls back to the next one when a provider
 * fails or returns a blocked domain, so one rate-limited provider doesn't
 * kill the whole batch.
 */
export class TempMailManager {
  private readonly providers: string[];
  private readonly clients = new Map<string, TempMailProvider>();

  constructor(providerNames: string[] | string) {
    const names = (Array.isArray(providerNames) ? providerNames : providerNames.split(/[,|;]+/))
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) throw new Error('no temp mail provider configured');
    this.providers = names;
  }

  async generate(): Promise<GeneratedMail> {
    const errors: string[] = [];
    for (const name of this.providers) {
      try {
        const client = createProvider(name);
        const addr = await client.generateEmail();
        const domain = addr.split('@')[1]?.toLowerCase() || '';
        if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
          errors.push(`${name}: blocked domain ${domain}`);
          continue;
        }
        this.clients.set(addr, client);
        return { addr, provider: name };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${name}: ${msg}`);
      }
    }
    throw new Error(`all temp mail providers failed: ${errors.join(' | ')}`);
  }

  /**
   * Poll the inbox for the R4 Coder verification email and extract the
   * verification link. Returns null on timeout.
   */
  async getVerifyLink(
    addr: string,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<string | null> {
    const client = this.clients.get(addr);
    if (!client) return null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const messages = await client.getInbox(addr);
        for (const msg of messages) {
          if (msg.sender && msg.sender.toLowerCase().includes('r4.chat')) {
            try {
              const detail = await client.readMessage(msg.id);
              const text = [detail.subject, detail.bodyText, detail.bodyHtml]
                .filter(Boolean)
                .join('\n');
              const match = text.match(R4_VERIFY_RE);
              if (match) return match[0];
            } catch {
              // unreadable message — keep polling
            }
          }
        }
      } catch {
        // transient network / rate-limit — keep polling
      }
      await sleep(intervalMs);
    }
    return null;
  }
}