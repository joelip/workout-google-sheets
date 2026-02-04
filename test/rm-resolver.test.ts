import { test, expect, describe } from 'bun:test';
import { RMResolver, RMConfig } from '../src/rm-resolver';

describe('RMResolver', () => {
  const testConfig: RMConfig = {
    repMaxes: [
      { exercise: 'squat', weight: 315, aliases: ['back squat', 'barbell squat'] },
      { exercise: 'bench press', weight: 225, aliases: ['bench', 'barbell bench'] },
      { exercise: 'deadlift', weight: 405, aliases: ['conventional deadlift', 'dl'] },
      { exercise: 'rdl', weight: 275, aliases: ['romanian deadlift'] },
      { exercise: 'clean grip rdl', weight: 225 },
    ],
    defaultUnit: 'lbs',
  };

  const resolver = new RMResolver(testConfig);

  describe('basic percentage patterns', () => {
    test('resolves @75% 1RM with context', () => {
      const result = resolver.resolveLine('4 x 6 reps @ 75% 1RM', 'C. Back Squat: 4 x 6 reps');
      expect(result).toBe('4 x 6 reps @ 75% 1RM (236 lbs)');
    });

    test('resolves @80%1RM without space', () => {
      const result = resolver.resolveLine('3 x 5 @80%1RM', 'A. Bench Press');
      expect(result).toBe('3 x 5 @80%1RM (180 lbs)');
    });

    test('resolves @ 85% RM with spaces', () => {
      const result = resolver.resolveLine('5 x 3 @ 85% RM, rest 3 min', 'B. Deadlift');
      expect(result).toBe('5 x 3 @ 85% RM (344 lbs), rest 3 min');
    });
  });

  describe('explicit exercise patterns', () => {
    test('resolves @75% squat', () => {
      const result = resolver.resolveLine('4 x 6 @ 75% squat, rest 2 min');
      expect(result).toBe('4 x 6 @ 75% squat (236 lbs), rest 2 min');
    });

    test('resolves @80% bench press', () => {
      const result = resolver.resolveLine('3 x 5 @ 80% bench press');
      expect(result).toBe('3 x 5 @ 80% bench press (180 lbs)');
    });

    test('resolves @90% deadlift', () => {
      const result = resolver.resolveLine('1 x 1 @ 90% deadlift');
      expect(result).toBe('1 x 1 @ 90% deadlift (365 lbs)');
    });
  });

  describe('of 1RM patterns', () => {
    test('resolves 75% of 1RM with context', () => {
      const result = resolver.resolveLine('Use 75% of 1RM', 'Clean Grip RDL');
      expect(result).toBe('Use 75% of 1RM (169 lbs)');
    });

    test('resolves 80% of squat', () => {
      const result = resolver.resolveLine('Work up to 80% of squat');
      expect(result).toBe('Work up to 80% of squat (252 lbs)');
    });
  });

  describe('alias matching', () => {
    test('matches exercise alias', () => {
      const result = resolver.resolveLine('5 x 5 @ 70% 1RM', 'A. Back Squat');
      expect(result).toBe('5 x 5 @ 70% 1RM (221 lbs)');
    });

    test('matches dl alias', () => {
      const result = resolver.resolveLine('3 x 3 @ 85% dl');
      expect(result).toBe('3 x 3 @ 85% dl (344 lbs)');
    });
  });

  describe('no match scenarios', () => {
    test('preserves original when no RM config matches', () => {
      const result = resolver.resolveLine('4 x 6 @ 75% 1RM', 'A. Overhead Press');
      expect(result).toBe('4 x 6 @ 75% 1RM');
    });

    test('preserves original when no percentage pattern', () => {
      const result = resolver.resolveLine('4 x 6 @ 185 lbs', 'A. Squat');
      expect(result).toBe('4 x 6 @ 185 lbs');
    });
  });

  describe('hasRMReference', () => {
    test('detects @75% pattern', () => {
      expect(resolver.hasRMReference('4 x 6 @ 75% 1RM')).toBe(true);
    });

    test('detects percentage of pattern', () => {
      expect(resolver.hasRMReference('Use 80% of 1RM')).toBe(true);
    });

    test('returns false for no RM reference', () => {
      expect(resolver.hasRMReference('4 x 6 @ 185 lbs')).toBe(false);
    });
  });

  describe('rounding', () => {
    test('rounds to nearest whole number', () => {
      // 315 * 0.73 = 229.95, should round to 230
      const result = resolver.resolveLine('@ 73% squat');
      expect(result).toBe('@ 73% squat (230 lbs)');
    });
  });
});
