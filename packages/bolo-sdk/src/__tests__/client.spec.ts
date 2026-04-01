import { BoloClient, BoloError } from '../client.js';

// ─── Mock fetch globally ──────────────────────────────────────────
const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('BoloClient', () => {
  let client: BoloClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new BoloClient({
      apiKey: 'bolo_live_test123',
      baseUrl: 'https://api.test.com',
    });
  });

  // ─── Construction ───────────────────────────────────────────────

  describe('constructor', () => {
    it('uses default base URL when not provided', () => {
      const c = new BoloClient({ apiKey: 'test' });
      mockFetch.mockResolvedValue(mockResponse([]));
      c.listWidgets();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.bolospot.com'),
        expect.anything(),
      );
    });

    it('strips trailing slash from base URL', () => {
      const c = new BoloClient({ apiKey: 'test', baseUrl: 'https://api.test.com/' });
      mockFetch.mockResolvedValue(mockResponse([]));
      c.listWidgets();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/api\.test\.com\/api/),
        expect.anything(),
      );
    });
  });

  // ─── Auth header ────────────────────────────────────────────────

  describe('authentication', () => {
    it('sends API key as Bearer token', async () => {
      mockFetch.mockResolvedValue(mockResponse([]));
      await client.listWidgets();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer bolo_live_test123',
          }),
        }),
      );
    });
  });

  // ─── Error handling ─────────────────────────────────────────────

  describe('error handling', () => {
    it('throws BoloError on non-200 response', async () => {
      mockFetch.mockResolvedValue(mockResponse({ message: 'Not found' }, 404));
      await expect(client.lookupHandle('nobody')).rejects.toThrow(BoloError);
    });

    it('BoloError includes status code', async () => {
      mockFetch.mockResolvedValue(mockResponse({ message: 'Forbidden' }, 403));
      try {
        await client.checkAccess('sarah');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BoloError);
        expect((err as BoloError).statusCode).toBe(403);
      }
    });

    it('parses error message from JSON response', async () => {
      mockFetch.mockResolvedValue(mockResponse({ message: 'Rate limit exceeded' }, 429));
      try {
        await client.relaySend({ recipientHandle: 'sarah', content: 'hi' } as any);
        fail('Should have thrown');
      } catch (err) {
        expect((err as BoloError).message).toBe('Rate limit exceeded');
      }
    });
  });

  // ─── Widgets ────────────────────────────────────────────────────

  describe('widgets', () => {
    it('listWidgets calls GET /widgets', async () => {
      mockFetch.mockResolvedValue(mockResponse([{ slug: 'calendar', name: 'Calendar' }]));
      const result = await client.listWidgets();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/widgets',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toHaveLength(1);
    });

    it('registerWidget calls POST /widgets/register', async () => {
      mockFetch.mockResolvedValue(mockResponse({ slug: 'dating', name: 'Dating' }));
      await client.registerWidget({ slug: 'dating', name: 'Dating', scopes: ['date:initiate'] });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/widgets/register',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('updateWidget calls PATCH /widgets/:slug', async () => {
      mockFetch.mockResolvedValue(mockResponse({ slug: 'dating', name: 'Dating v2' }));
      await client.updateWidget('dating', { name: 'Dating v2' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/widgets/dating',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('deactivateWidget calls DELETE /widgets/:slug', async () => {
      mockFetch.mockResolvedValue(mockResponse({ slug: 'dating', isActive: false }));
      await client.deactivateWidget('dating');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/widgets/dating',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ─── Grants ─────────────────────────────────────────────────────

  describe('grants', () => {
    it('createGrant calls POST /grants', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'grant-1' }));
      await client.createGrant({
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/grants',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('checkAccess normalizes handle and calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockResponse({ exists: true, widgets: [] }));
      await client.checkAccess('@Sarah');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/@sarah/access/key',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('requestAccess normalizes handle', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'req-1', status: 'PENDING' }));
      await client.requestAccess({
        targetHandle: '@Tom',
        widget: 'calendar',
        scopes: ['free_busy'],
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/@tom/access/request/key',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // ─── Relay ──────────────────────────────────────────────────────

  describe('relay', () => {
    it('relaySend calls POST /relay/send', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'msg-1' }));
      await client.relaySend({ recipientHandle: 'sarah', content: 'hello' } as any);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/relay/send',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('relayInbox calls GET /relay/inbox', async () => {
      mockFetch.mockResolvedValue(mockResponse({ messages: [], count: 0 }));
      await client.relayInbox();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/relay/inbox',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('relayInbox passes since parameter', async () => {
      mockFetch.mockResolvedValue(mockResponse({ messages: [], count: 0 }));
      await client.relayInbox('2026-03-20T00:00:00Z');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since='),
        expect.anything(),
      );
    });

    it('relayReply calls POST /relay/:id/reply', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'reply-1' }));
      await client.relayReply('msg-1', { content: 'Yes, free at 9am' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/relay/msg-1/reply',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('relayAck calls POST /relay/ack with message IDs', async () => {
      mockFetch.mockResolvedValue(mockResponse({ acknowledged: 2 }));
      await client.relayAck(['msg-1', 'msg-2']);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/relay/ack',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ messageIds: ['msg-1', 'msg-2'] }),
        }),
      );
    });
  });

  // ─── Identity ───────────────────────────────────────────────────

  describe('identity', () => {
    it('lookupHandle normalizes and calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockResponse({ exists: true, handle: 'sarah' }));
      await client.lookupHandle('@Sarah');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/@sarah/lookup',
        expect.anything(),
      );
    });

    it('getBookingProfile normalizes handle', async () => {
      mockFetch.mockResolvedValue(mockResponse({ handle: 'sarah', timezone: 'America/New_York' }));
      await client.getBookingProfile('@Sarah');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/@sarah/booking/profile',
        expect.anything(),
      );
    });
  });
});
