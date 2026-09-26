import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const chain = {
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  single: jest.fn(),
};

jest.unstable_mockModule('../../src/config/supabase.js', () => ({
  getSupabaseAdmin: jest.fn(() => chain),
  getSupabaseUser: jest.fn(() => chain),
  getSupabase: jest.fn(() => chain),
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logDebug: jest.fn(),
}));

const { logMoConversation, hashIp } = await import('../../src/services/mo/moLog.service.js');

describe('logMoConversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chain.single.mockResolvedValue({ data: { id: 'log-id-1' }, error: null });
  });

  it('inserts a well-formed row and returns its id', async () => {
    const id = await logMoConversation({
      userId: 'user-1',
      source: 'chat',
      question: 'How much is road worthiness?',
      answer: 'It depends on your state.',
      actionType: '/licenses/renew',
      hasLadipoSearch: true,
    });

    expect(id).toBe('log-id-1');
    expect(chain.from).toHaveBeenCalledWith('mo_conversations');
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        source: 'chat',
        question: 'How much is road worthiness?',
        answer: 'It depends on your state.',
        action_type: '/licenses/renew',
        has_ladipo_search: true,
      }),
    );
  });

  it('returns null without throwing when the insert fails', async () => {
    chain.single.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(
      logMoConversation({ source: 'public', question: 'hi' }),
    ).resolves.toBeNull();
  });

  it('skips invalid source or empty question without touching the db', async () => {
    await expect(
      logMoConversation({ source: 'sms', question: 'hi' }),
    ).resolves.toBeNull();
    await expect(
      logMoConversation({ source: 'chat', question: '   ' }),
    ).resolves.toBeNull();
    expect(chain.from).not.toHaveBeenCalled();
  });

  it('truncates over-long questions to the storage cap', async () => {
    await logMoConversation({ source: 'chat', question: 'x'.repeat(5000) });
    const payload = chain.insert.mock.calls[0][0];
    expect(payload.question).toHaveLength(2000);
  });
});

describe('hashIp', () => {
  it('is deterministic and null-safe', () => {
    expect(hashIp('102.89.46.105')).toBe(hashIp('102.89.46.105'));
    expect(hashIp(null)).toBeNull();
    expect(hashIp('102.89.46.105')).toHaveLength(64);
  });
});
