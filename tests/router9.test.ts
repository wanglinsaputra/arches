import { describe, it, expect, vi, afterEach } from 'vitest';
import { Router9Client, Router9Error } from '../src/router9.js';
import { syncKeysToRouter9 } from '../src/sync.js';

const BASE = 'http://router9.local';
const PASS = 'secret-pass';
const NODE_ID = 'openai-compatible-chat-1fb61662-bc01-49d8-aca1-b65253b795ad';

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch() {
  const fn = vi.fn() as FetchMock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function okRes(body: unknown, status = 200) {
  return jsonResponse(body, status);
}

function loginOk(fn: FetchMock) {
  fn.mockResolvedValueOnce(jsonResponse({ ok: true }, 200, { 'set-cookie': 'session=x; Path=/' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Router9Client', () => {
  describe('authenticate', () => {
    it('stores the session cookie from login', async () => {
      const fetchMock = mockFetch();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ ok: true }, 200, { 'set-cookie': 'session=abc123; Path=/' }),
      );
      const client = new Router9Client(BASE, PASS);
      await client.authenticate();
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE}/api/auth/login`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws AUTH_FAILED on wrong password', async () => {
      const fetchMock = mockFetch();
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid password. 4 attempt(s) left.' }, 401));
      const client = new Router9Client(BASE, 'wrong');
      const err = await client.authenticate().catch((e: Router9Error) => e);
      expect(err.code).toBe('AUTH_FAILED');
    });

    it('throws NOT_CONFIGURED when password missing', async () => {
      const client = new Router9Client(BASE, '');
      const err = await client.authenticate().catch((e: Router9Error) => e);
      expect(err.code).toBe('NOT_CONFIGURED');
    });

    it('throws UNREACHABLE on network error', async () => {
      const fetchMock = mockFetch();
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      const client = new Router9Client('http://127.0.0.1:1', PASS);
      const err = await client.authenticate().catch((e: Router9Error) => e);
      expect(err.code).toBe('UNREACHABLE');
    });
  });

  describe('provider nodes', () => {
    it('lists provider nodes', async () => {
      const fetchMock = mockFetch();
      loginOk(fetchMock);
      fetchMock.mockResolvedValueOnce(okRes({ nodes: [{ id: NODE_ID, type: 'openai-compatible', name: 'coder.r4.chat', prefix: '1', baseUrl: 'https://api.coder.r4.chat/v1' }] }));
      const client = new Router9Client(BASE, PASS);
      await client.authenticate();
      const nodes = await client.getProviderNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('openai-compatible');
    });

    it('finds the OpenAI Compatible node', async () => {
      const client = new Router9Client(BASE, PASS);
      const nodes = [
        { id: 'x', type: 'deepseek', name: 'DeepSeek', prefix: 'd', baseUrl: 'https://api.deepseek.com/v1' },
        { id: NODE_ID, type: 'openai-compatible', name: 'coder.r4.chat', prefix: '1', baseUrl: 'https://api.coder.r4.chat/v1' },
      ];
      const found = client.findOpenAICompatibleNode(nodes, 'https://api.coder.r4.chat/v1');
      expect(found?.id).toBe(NODE_ID);
    });

    it('prefers a node matching the baseUrl', async () => {
      const client = new Router9Client(BASE, PASS);
      const nodes = [
        { id: 'a', type: 'openai-compatible', name: 'other', prefix: 'o', baseUrl: 'https://other.com/v1' },
        { id: NODE_ID, type: 'openai-compatible', name: 'coder.r4.chat', prefix: '1', baseUrl: 'https://api.coder.r4.chat/v1' },
      ];
      const found = client.findOpenAICompatibleNode(nodes, 'https://api.coder.r4.chat/v1');
      expect(found?.id).toBe(NODE_ID);
    });

    it('returns null when no OpenAI Compatible node exists', async () => {
      const client = new Router9Client(BASE, PASS);
      const found = client.findOpenAICompatibleNode([{ id: 'x', type: 'deepseek', name: 'DeepSeek', prefix: 'd', baseUrl: 'u' }]);
      expect(found).toBeNull();
    });
  });

  describe('bulkAddKeys', () => {
    it('adds multiple keys and skips duplicates', async () => {
      const fetchMock = mockFetch();
      fetchMock.mockResolvedValue(okRes({ connection: { id: 'c1' } }, 201));
      const client = new Router9Client(BASE, PASS);
      const result = await client.bulkAddKeys(
        NODE_ID,
        [
          { name: 'k1', key: 'key-1' },
          { name: 'k2', key: 'key-2' },
          { name: 'dup', key: 'key-1' },
        ],
        new Set(['key-1']),
      );
      expect(result.synced).toBe(1); // only key-2 added; key-1 already in existing set
      expect(result.failed).toBe(0);
    });

    it('continues on partial failure', async () => {
      const fetchMock = mockFetch();
      fetchMock.mockResolvedValueOnce(okRes({ connection: {} }, 201));
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429));
      fetchMock.mockResolvedValueOnce(okRes({ connection: {} }, 201));
      const client = new Router9Client(BASE, PASS);
      const result = await client.bulkAddKeys(NODE_ID, [
        { name: 'a', key: 'ka' },
        { name: 'b', key: 'kb' },
        { name: 'c', key: 'kc' },
      ]);
      expect(result.synced).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.failures[0].name).toBe('b');
    });
  });
});

describe('syncKeysToRouter9', () => {
  const keys = [
    { name: 'alpha', key: 'coder_aaa' },
    { name: 'beta', key: 'coder_bbb' },
  ];

  it('disabled when ROUTER9_URL missing', async () => {
    const summary = await syncKeysToRouter9({ url: undefined, password: PASS }, keys);
    expect(summary.status).toBe('disabled');
    expect(summary.errors.join('')).toContain('ROUTER9_URL');
  });

  it('disabled when ROUTER9_PASS missing', async () => {
    const summary = await syncKeysToRouter9({ url: BASE, password: undefined }, keys);
    expect(summary.status).toBe('disabled');
    expect(summary.errors.join('')).toContain('ROUTER9_PASS');
  });

  it('error and does not throw when 9router unreachable', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const summary = await syncKeysToRouter9({ url: 'http://127.0.0.1:1', password: PASS }, keys);
    expect(summary.status).toBe('error');
    expect(summary.failed).toBe(2);
  });

  it('error on auth failure, main flow not blocked', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid password' }, 401));
    const summary = await syncKeysToRouter9({ url: BASE, password: 'bad' }, keys);
    expect(summary.status).toBe('error');
    expect(summary.errors.length).toBeGreaterThan(0);
  });

  it('reuses existing OpenAI Compatible node (no duplicate)', async () => {
    const fetchMock = mockFetch();
    loginOk(fetchMock);
    fetchMock.mockResolvedValueOnce(okRes({ nodes: [{ id: NODE_ID, type: 'openai-compatible', name: 'coder.r4.chat', prefix: '1', baseUrl: 'https://api.coder.r4.chat/v1' }] }));
    fetchMock.mockResolvedValue(okRes({ connection: {} }, 201));
    const summary = await syncKeysToRouter9({ url: BASE, password: PASS }, keys);
    expect(summary.status).toBe('ok');
    expect(summary.synced).toBe(2);
    const createdNodes = fetchMock.mock.calls.filter(
      (call) => (call[0] as string).endsWith('/api/provider-nodes') && (call[1] as RequestInit).method === 'POST',
    );
    expect(createdNodes).toHaveLength(0);
  });

  it('creates OpenAI Compatible node when absent', async () => {
    const fetchMock = mockFetch();
    loginOk(fetchMock);
    fetchMock.mockResolvedValueOnce(okRes({ nodes: [] }));
    fetchMock.mockResolvedValueOnce(okRes({ node: { id: NODE_ID, type: 'openai-compatible', name: 'coder.r4.chat', prefix: 'r4', baseUrl: 'https://api.coder.r4.chat/v1' } }, 201));
    fetchMock.mockResolvedValue(okRes({ connection: {} }, 201));
    const summary = await syncKeysToRouter9({ url: BASE, password: PASS }, keys);
    expect(summary.status).toBe('ok');
    expect(summary.synced).toBe(2);
    const createdNodes = fetchMock.mock.calls.filter(
      (call) => (call[0] as string).endsWith('/api/provider-nodes') && (call[1] as RequestInit).method === 'POST',
    );
    expect(createdNodes).toHaveLength(1);
  });

  it('password never appears in errors or output', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: `bad password ${PASS}` }, 401));
    const summary = await syncKeysToRouter9({ url: BASE, password: PASS }, keys);
    const allText = JSON.stringify(summary) + summary.errors.join(' ');
    expect(allText).not.toContain(PASS);
  });
});