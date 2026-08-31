import { describe, expect, test } from 'bun:test';
import { APIErrorCode, APIResponseError } from '@notionhq/client';
import { withNotionReadRetry } from '../src/notion-workout-pages';

describe('withNotionReadRetry', () => {
  test('retries a rate-limited read using the larger server or exponential delay', async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withNotionReadRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw rateLimitedError('3');
      }
      return 'ok';
    }, {
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
    expect(delays).toEqual([3_000]);
  });

  test('stops after the configured retry limit', async () => {
    let attempts = 0;

    await expect(withNotionReadRetry(async () => {
      attempts += 1;
      throw rateLimitedError();
    }, {
      maxRetries: 2,
      sleep: async () => {},
    })).rejects.toMatchObject({ code: APIErrorCode.RateLimited });
    expect(attempts).toBe(3);
  });

  test('does not retry non-rate-limit failures', async () => {
    const error = new Error('boom');
    let attempts = 0;

    await expect(withNotionReadRetry(async () => {
      attempts += 1;
      throw error;
    }, {
      sleep: async () => {},
    })).rejects.toBe(error);
    expect(attempts).toBe(1);
  });
});

function rateLimitedError(retryAfter?: string): APIResponseError {
  const headers = new Headers();
  if (retryAfter) {
    headers.set('retry-after', retryAfter);
  }
  return new APIResponseError({
    code: APIErrorCode.RateLimited,
    status: 429,
    message: 'rate limited',
    headers,
    rawBodyText: '{}',
  });
}
