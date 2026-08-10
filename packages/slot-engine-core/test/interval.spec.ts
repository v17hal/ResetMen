import { describe, expect, it } from 'vitest';

import { contains, mergeIntervals, overlaps, subtract } from '../src/index.js';

const i = (start: number, end: number) => ({ start, end });

describe('interval arithmetic', () => {
  describe('overlaps — half-open [start, end)', () => {
    it('treats touching intervals as non-overlapping', () => {
      expect(overlaps(i(0, 10), i(10, 20))).toBe(false);
      expect(overlaps(i(10, 20), i(0, 10))).toBe(false);
    });

    it('detects genuine overlap', () => {
      expect(overlaps(i(0, 10), i(9, 20))).toBe(true);
      expect(overlaps(i(0, 100), i(40, 50))).toBe(true);
    });

    it('treats an empty interval as overlapping nothing', () => {
      expect(overlaps(i(5, 5), i(0, 10))).toBe(false);
    });
  });

  describe('contains', () => {
    it('accepts exact and inner fits', () => {
      expect(contains(i(0, 10), i(0, 10))).toBe(true);
      expect(contains(i(0, 10), i(2, 8))).toBe(true);
    });

    it('rejects anything that pokes out', () => {
      expect(contains(i(0, 10), i(0, 11))).toBe(false);
      expect(contains(i(0, 10), i(-1, 5))).toBe(false);
    });
  });

  describe('mergeIntervals', () => {
    it('merges overlapping and touching intervals', () => {
      expect(mergeIntervals([i(0, 10), i(5, 15), i(15, 20)])).toEqual([i(0, 20)]);
    });

    it('keeps disjoint intervals apart and sorted', () => {
      expect(mergeIntervals([i(30, 40), i(0, 10)])).toEqual([i(0, 10), i(30, 40)]);
    });

    it('drops empty intervals', () => {
      expect(mergeIntervals([i(5, 5), i(0, 10)])).toEqual([i(0, 10)]);
    });
  });

  describe('subtract', () => {
    it('cuts a hole in the middle', () => {
      expect(subtract([i(0, 100)], [i(40, 60)])).toEqual([i(0, 40), i(60, 100)]);
    });

    it('trims both ends', () => {
      expect(subtract([i(0, 100)], [i(0, 10), i(90, 100)])).toEqual([i(10, 90)]);
    });

    it('handles overlapping cuts', () => {
      expect(subtract([i(0, 100)], [i(10, 50), i(40, 60)])).toEqual([i(0, 10), i(60, 100)]);
    });

    it('returns nothing when fully covered', () => {
      expect(subtract([i(0, 100)], [i(0, 100)])).toEqual([]);
      expect(subtract([i(10, 20)], [i(0, 100)])).toEqual([]);
    });

    it('ignores cuts that fall outside the base', () => {
      expect(subtract([i(0, 10)], [i(50, 60)])).toEqual([i(0, 10)]);
    });

    it('works across multiple base windows — a split trading day', () => {
      expect(subtract([i(0, 40), i(60, 100)], [i(20, 70)])).toEqual([i(0, 20), i(70, 100)]);
    });

    it('is a no-op with no cuts', () => {
      expect(subtract([i(0, 10)], [])).toEqual([i(0, 10)]);
    });
  });
});
