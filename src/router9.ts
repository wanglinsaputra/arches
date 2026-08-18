export interface ProviderNode {
  id: string;
  type: string;
  name: string;
  prefix: string;
  baseUrl: string;
  apiType?: string;
}

export interface Connection {
  id: string;
  provider: string;
  name: string;
  apiKey?: string;
  priority: number;
  isActive: boolean;
  [key: string]: unknown;
}

export interface ApiKeyEntry {
  name: string;
  key: string;
}

export interface BulkAddResult {
  synced: number;
  failed: number;
  failures: Array<{ name: string; reason: string }>;
}

export interface Router9Error extends Error {
  code:
    | 'NOT_CONFIGURED'
    | 'AUTH_FAILED'
    | 'UNREACHABLE'
    | 'NODE_CREATE_FAILED'
    | 'BULK_ADD_FAILED'
    | 'HTTP_ERROR';
  status?: number;
}

const NODE_TYPE = 'openai-compatible';

export class Router9Client {
  private sessionCookie: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
  ) {}

  private redact(message: string): string {
    if (!this.password) return message;
    return message.split(this.password).join('[REDACTED]');
  }

  private error(code: Router9Error['code'], message: string, status?: number): Router9Error {
    const err = new Error(this.redact(message)) as Router9Error;
    err.code = code;
    err.status = status;
    return err;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; data: unknown }> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (this.sessionCookie) headers.set('Cookie', this.sessionCookie);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers, redirect: 'manual' });
    } catch {
      throw this.error('UNREACHABLE', `9router unreachable at ${this.baseUrl}`);
    }

    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length) {
      const authCookie = setCookies
        .map((sc) => sc.split(';')[0])
        .find((c) => c.includes('='));
      if (authCookie) this.sessionCookie = authCookie;
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON response; keep data null
    }
    return { status: res.status, data };
  }

  async authenticate(): Promise<void> {
    if (!this.password) {
      throw this.error('NOT_CONFIGURED', 'ROUTER9_PASS is not set');
    }
    const { status, data } = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: this.password }),
    });
    if (status === 200) {
      if (!this.sessionCookie) {
        const body = data as { token?: string };
        if (body?.token) this.sessionCookie = `session=${body.token}`;
      }
      return;
    }
    const msg = (data as { error?: string })?.error ?? `HTTP ${status}`;
    throw this.error('AUTH_FAILED', `9router authentication failed: ${msg}`, status);
  }

  async getProviderNodes(): Promise<ProviderNode[]> {
    const { status, data } = await this.request('/api/provider-nodes');
    if (status !== 200) {
      const msg = (data as { error?: string })?.error ?? `HTTP ${status}`;
      throw this.error('HTTP_ERROR', `failed to list provider nodes: ${msg}`, status);
    }
    const list = (data as { nodes?: ProviderNode[] })?.nodes;
    return Array.isArray(list) ? list : [];
  }

  findOpenAICompatibleNode(nodes: ProviderNode[], baseUrl?: string): ProviderNode | null {
    const compatible = nodes.filter((n) => n.type === NODE_TYPE);
    if (!compatible.length) return null;
    if (baseUrl) {
      const match = compatible.find((n) => n.baseUrl === baseUrl);
      if (match) return match;
    }
    return compatible[0];
  }

  async createOpenAICompatibleNode(name: string, baseUrl: string, prefix: string): Promise<ProviderNode> {
    const { status, data } = await this.request('/api/provider-nodes', {
      method: 'POST',
      body: JSON.stringify({
        name,
        prefix,
        baseUrl,
        type: NODE_TYPE,
        apiType: 'chat',
      }),
    });
    if (status === 200 || status === 201) {
      const node = (data as { node?: ProviderNode })?.node;
      if (node?.id) return node;
    }
    const msg = (data as { error?: string })?.error ?? `HTTP ${status}`;
    throw this.error('NODE_CREATE_FAILED', `failed to create OpenAI Compatible node: ${msg}`, status);
  }

  async getConnections(): Promise<Connection[]> {
    const { status, data } = await this.request('/api/providers');
    if (status !== 200) {
      const msg = (data as { error?: string })?.error ?? `HTTP ${status}`;
      throw this.error('HTTP_ERROR', `failed to list connections: ${msg}`, status);
    }
    const list = (data as { connections?: Connection[] })?.connections;
    return Array.isArray(list) ? list : [];
  }

  async addKey(nodeId: string, entry: ApiKeyEntry): Promise<void> {
    const { status, data } = await this.request('/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        provider: nodeId,
        name: entry.name,
        apiKey: entry.key,
        priority: 1,
      }),
    });
    if (status === 200 || status === 201) return;
    const msg = (data as { error?: string })?.error ?? `HTTP ${status}`;
    throw this.error('BULK_ADD_FAILED', `failed to add key "${entry.name}": ${msg}`, status);
  }

  /**
   * Bulk-add keys to an OpenAI Compatible node. Skips keys already present
   * on the node and continues on individual failures so one bad key doesn't
   * kill the rest.
   */
  async bulkAddKeys(
    nodeId: string,
    keys: ApiKeyEntry[],
    existingKeys: Set<string> = new Set(),
  ): Promise<BulkAddResult> {
    const result: BulkAddResult = { synced: 0, failed: 0, failures: [] };
    for (const entry of keys) {
      if (existingKeys.has(entry.key)) continue;
      try {
        await this.addKey(nodeId, entry);
        result.synced++;
      } catch (e) {
        result.failed++;
        result.failures.push({ name: entry.name, reason: (e as Error).message });
      }
    }
    return result;
  }
}