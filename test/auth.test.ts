import { describe, expect, test } from 'bun:test';
import { assertInteractiveOAuthInput } from '../src/auth';

describe('assertInteractiveOAuthInput', () => {
  test('rejects OAuth prompting without an interactive terminal', () => {
    expect(() => assertInteractiveOAuthInput(false)).toThrow(
      'Google OAuth authorization requires an interactive terminal.'
    );
  });

  test('allows OAuth prompting in an interactive terminal', () => {
    expect(() => assertInteractiveOAuthInput(true)).not.toThrow();
  });
});
