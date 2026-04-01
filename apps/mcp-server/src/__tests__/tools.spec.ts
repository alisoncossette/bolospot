import { tools } from '../tools/index.js';

describe('MCP Tool Definitions', () => {
  // ─── Schema validation ──────────────────────────────────────────

  it('every tool has a unique name', () => {
    const names = tools.map(t => t.definition.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every tool has a non-empty description', () => {
    for (const tool of tools) {
      expect(tool.definition.description.length).toBeGreaterThan(10);
    }
  });

  it('every tool has an inputSchema', () => {
    for (const tool of tools) {
      expect(tool.definition.inputSchema).toBeDefined();
      expect(tool.definition.inputSchema.type).toBe('object');
    }
  });

  it('every tool has a handler function', () => {
    for (const tool of tools) {
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('every tool is assigned to at least one toolset', () => {
    for (const tool of tools) {
      expect(tool.toolsets.length).toBeGreaterThan(0);
      for (const ts of tool.toolsets) {
        expect(['developer', 'scheduling', 'account']).toContain(ts);
      }
    }
  });

  // ─── Tool count guardrails ──────────────────────────────────────

  it('total tool count stays under 25', () => {
    expect(tools.length).toBeLessThanOrEqual(25);
  });

  it('developer toolset has 15 or fewer tools', () => {
    const devTools = tools.filter(t => t.toolsets.includes('developer'));
    expect(devTools.length).toBeLessThanOrEqual(15);
  });

  it('scheduling toolset has 10 or fewer tools', () => {
    const schedTools = tools.filter(t => t.toolsets.includes('scheduling'));
    expect(schedTools.length).toBeLessThanOrEqual(10);
  });

  it('account toolset has 5 or fewer tools', () => {
    const acctTools = tools.filter(t => t.toolsets.includes('account'));
    expect(acctTools.length).toBeLessThanOrEqual(5);
  });

  // ─── Naming conventions ─────────────────────────────────────────

  it('all tool names are snake_case', () => {
    for (const tool of tools) {
      expect(tool.definition.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  // ─── Required tools exist ───────────────────────────────────────

  const requiredTools = [
    'check_access',
    'request_access',
    'lookup_handle',
    'create_grant',
    'revoke_grant',
    'list_bolos',
    'get_availability',
    'get_events',
    'book_meeting',
    'relay_send',
    'relay_inbox',
    'relay_reply',
    'relay_check_responses',
    'register_widget',
    'update_widget',
    'deactivate_widget',
    'update_profile',
  ];

  for (const name of requiredTools) {
    it(`required tool "${name}" exists`, () => {
      const found = tools.find(t => t.definition.name === name);
      expect(found).toBeDefined();
    });
  }

  // ─── Toolset assignments ────────────────────────────────────────

  describe('developer toolset', () => {
    const devToolNames = tools
      .filter(t => t.toolsets.includes('developer'))
      .map(t => t.definition.name);

    it('includes all relay tools', () => {
      expect(devToolNames).toContain('relay_send');
      expect(devToolNames).toContain('relay_inbox');
      expect(devToolNames).toContain('relay_reply');
      expect(devToolNames).toContain('relay_check_responses');
      expect(devToolNames).toContain('relay_ack');
    });

    it('includes widget management tools', () => {
      expect(devToolNames).toContain('register_widget');
      expect(devToolNames).toContain('update_widget');
      expect(devToolNames).toContain('deactivate_widget');
    });

    it('includes grant tools', () => {
      expect(devToolNames).toContain('create_grant');
      expect(devToolNames).toContain('revoke_grant');
      expect(devToolNames).toContain('check_access');
    });

    it('does NOT include scheduling-only tools', () => {
      expect(devToolNames).not.toContain('get_availability');
      expect(devToolNames).not.toContain('book_meeting');
      expect(devToolNames).not.toContain('get_booking_profile');
      expect(devToolNames).not.toContain('find_mutual_time');
    });
  });

  describe('scheduling toolset', () => {
    const schedToolNames = tools
      .filter(t => t.toolsets.includes('scheduling'))
      .map(t => t.definition.name);

    it('includes calendar and booking tools', () => {
      expect(schedToolNames).toContain('get_availability');
      expect(schedToolNames).toContain('book_meeting');
      expect(schedToolNames).toContain('get_booking_profile');
      expect(schedToolNames).toContain('get_events');
    });

    it('does NOT include relay tools', () => {
      expect(schedToolNames).not.toContain('relay_send');
      expect(schedToolNames).not.toContain('relay_inbox');
      expect(schedToolNames).not.toContain('register_widget');
    });
  });

  // ─── Required parameters ────────────────────────────────────────

  describe('parameter schemas', () => {
    it('check_access requires handle', () => {
      const tool = tools.find(t => t.definition.name === 'check_access')!;
      expect(tool.definition.inputSchema.required).toContain('handle');
    });

    it('relay_send requires recipientHandle and content', () => {
      const tool = tools.find(t => t.definition.name === 'relay_send')!;
      const schema = tool.definition.inputSchema;
      expect(schema.properties).toHaveProperty('handle');
      expect(schema.properties).toHaveProperty('query');
    });

    it('book_meeting requires start_time, duration, timezone', () => {
      const tool = tools.find(t => t.definition.name === 'book_meeting')!;
      const required = tool.definition.inputSchema.required || [];
      expect(required).toContain('start_time');
      expect(required).toContain('duration');
      expect(required).toContain('timezone');
    });

    it('register_widget requires slug, name, scopes', () => {
      const tool = tools.find(t => t.definition.name === 'register_widget')!;
      const required = tool.definition.inputSchema.required || [];
      expect(required).toContain('slug');
      expect(required).toContain('name');
      expect(required).toContain('scopes');
    });
  });
});

// ─── cleanHandle ──────────────────────────────────────────────────

describe('cleanHandle', () => {
  // Import dynamically since it's ESM
  let cleanHandle: (h: string) => string;

  beforeAll(async () => {
    const mod = await import('../api-client.js');
    cleanHandle = mod.cleanHandle;
  });

  it('strips @ prefix', () => {
    expect(cleanHandle('@sarah')).toBe('sarah');
  });

  it('lowercases handle', () => {
    expect(cleanHandle('@Sarah')).toBe('sarah');
    expect(cleanHandle('MIKE')).toBe('mike');
  });

  it('handles already-clean input', () => {
    expect(cleanHandle('tom')).toBe('tom');
  });
});
