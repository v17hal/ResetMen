import { describe, expect, it } from 'vitest';

import { drawWeighted } from '../../src/rewards/scratch.service.js';

/**
 * The prize draw.
 *
 * Tested with a scripted roll rather than real randomness, because "it looked about right
 * when I ran it" is not a claim anyone should make about something that gives away the
 * store's money. The distribution test at the end is what catches an off-by-one in the
 * cumulative walk — the kind of bug that makes the last prize unwinnable, or the first one
 * twice as likely as configured.
 */
const PRIZES = [
  { id: 'common', weight: 70 },
  { id: 'uncommon', weight: 25 },
  { id: 'rare', weight: 5 },
];

describe('drawWeighted', () => {
  it('returns null when there is nothing to draw', () => {
    expect(drawWeighted([], 0.5)).toBeNull();
  });

  it('ignores zero-weight entries', () => {
    expect(drawWeighted([{ id: 'never', weight: 0 }], 0.5)).toBeNull();
  });

  it('lands in the first slice at the bottom of the range', () => {
    expect(drawWeighted(PRIZES, 0)?.id).toBe('common');
  });

  it('lands in the last slice at the top of the range', () => {
    expect(drawWeighted(PRIZES, 0.999_999)?.id).toBe('rare');
  });

  it('respects slice boundaries exactly', () => {
    // Cumulative: common [0, 0.70), uncommon [0.70, 0.95), rare [0.95, 1.0).
    expect(drawWeighted(PRIZES, 0.699)?.id).toBe('common');
    expect(drawWeighted(PRIZES, 0.70)?.id).toBe('uncommon');
    expect(drawWeighted(PRIZES, 0.949)?.id).toBe('uncommon');
    expect(drawWeighted(PRIZES, 0.95)?.id).toBe('rare');
  });

  it('never returns null for a roll of 1, which Math.random excludes but callers may pass', () => {
    expect(drawWeighted(PRIZES, 1)).not.toBeNull();
  });

  it('handles a roll outside [0,1) without falling off either end', () => {
    expect(drawWeighted(PRIZES, -0.5)?.id).toBe('common');
    expect(drawWeighted(PRIZES, 7)).not.toBeNull();
  });

  it('produces the configured distribution over a swept range', () => {
    const counts = new Map<string, number>();

    for (let i = 0; i < 10_000; i += 1) {
      const picked = drawWeighted(PRIZES, i / 10_000);
      if (picked !== null) counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1);
    }

    // A uniform sweep should reproduce the weights almost exactly.
    expect(counts.get('common')).toBe(7_000);
    expect(counts.get('uncommon')).toBe(2_500);
    expect(counts.get('rare')).toBe(500);
  });

  it('is single-outcome when one prize holds all the weight', () => {
    const only = [{ id: 'grand', weight: 1 }, { id: 'off', weight: 0 }];
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      expect(drawWeighted(only, roll)?.id).toBe('grand');
    }
  });
});
