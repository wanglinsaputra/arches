const R4_BASE = 'https://api.coder.r4.chat';

const R4_SIGNUP = `${R4_BASE}/api/auth/sign-up/email`;
const R4_LOGIN = `${R4_BASE}/api/auth/sign-in/email`;
const R4_KEY = `${R4_BASE}/rpc/apiKeys/create`;
const R4_CHAT = `${R4_BASE}/v1/chat/completions`;

function parseSetCookie(setCookie: string[]): string[] {
  return setCookie
    .map((sc) => sc.split(';')[0])
    .filter((c) => c.includes('='));
}

export class R4Client {
  private cookies: string[] = [];

  constructor(
    private readonly password: string,
    private readonly model: string,
  ) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('Origin', 'https://coder.r4.chat');
    headers.set('Referer', 'https://coder.r4.chat/');
    if (this.cookies.length) headers.set('Cookie', this.cookies.join('; '));

    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length) this.cookies = parseSetCookie(setCookies);
    return res;
  }

  async signup(email: string, name: string): Promise<void> {
    const res = await this.request(R4_SIGNUP, {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: this.password,
        name,
        callbackURL: 'https://coder.r4.chat/verify-email',
      }),
    });
    if (!res.ok) throw new Error(`signup failed (${res.status})`);
    const data = (await res.json()) as { error?: string };
    if (data.error) throw new Error(`signup: ${data.error}`);
  }

  async verify(verifyUrl: string): Promise<void> {
    const res = await this.request(verifyUrl, { method: 'GET' });
    if (![301, 302, 303].includes(res.status)) {
      throw new Error(`verify failed (${res.status})`);
    }
  }

  async login(email: string): Promise<void> {
    const res = await this.request(R4_LOGIN, {
      method: 'POST',
      body: JSON.stringify({ email, password: this.password }),
    });
    if (!res.ok) throw new Error(`login failed (${res.status})`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('login: no session token returned');
  }

  async createKey(name: string): Promise<string> {
    const res = await this.request(R4_KEY, {
      method: 'POST',
      body: JSON.stringify({ json: { name } }),
    });
    if (!res.ok) throw new Error(`key creation failed (${res.status})`);
    const data = (await res.json()) as { json?: { key?: string } };
    const key = data.json?.key;
    if (!key) throw new Error('key creation: no key returned');
    return key;
  }

  async testKey(key: string): Promise<boolean> {
    const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(R4_CHAT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 10,
          }),
        });
        if (res.status >= 500 || res.status === 429) {
          // transient overload / rate limit — retry with backoff
          await sleepMs(1500 * (attempt + 1));
          continue;
        }
        if (!res.ok) return false;
        const data = (await res.json()) as { choices?: unknown[] };
        return Array.isArray(data.choices) && data.choices.length > 0;
      } catch {
        await sleepMs(1500 * (attempt + 1));
      }
    }
    return false;
  }
}