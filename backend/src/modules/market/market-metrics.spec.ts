import { describe, expect, it } from 'vitest';
import { delta7dPct, likeRatio, sparkline } from './market-metrics.js';

describe('market-metrics', () => {
  describe('likeRatio', () => {
    it('returns null when total votes are 0', () => {
      expect(likeRatio(0, 0)).toBeNull();
    });

    it('calculates the ratio of upVotes to total votes', () => {
      expect(likeRatio(850, 150)).toBeCloseTo(0.85, 5);
      expect(likeRatio(100, 0)).toBe(1);
    });
  });

  describe('delta7dPct', () => {
    it('returns null when fewer than 2 days exist or 7d prior day is missing', () => {
      expect(delta7dPct([])).toBeNull();
      expect(delta7dPct([{ day: '2026-10-22', avg: 1000 }])).toBeNull();
      expect(
        delta7dPct([
          { day: '2026-10-20', avg: 1000 },
          { day: '2026-10-22', avg: 1200 },
        ]),
      ).toBeNull();
    });

    it('returns percentage change between latest day and exactly 7 days before', () => {
      const daily = [
        { day: '2026-10-15', avg: 1000 },
        { day: '2026-10-18', avg: 1100 },
        { day: '2026-10-22', avg: 1245 },
      ];
      expect(delta7dPct(daily)).toBe(24.5);
    });

    it('handles negative delta and zero baseline', () => {
      expect(
        delta7dPct([
          { day: '2026-10-15', avg: 2000 },
          { day: '2026-10-22', avg: 1500 },
        ]),
      ).toBe(-25);

      expect(
        delta7dPct([
          { day: '2026-10-15', avg: 0 },
          { day: '2026-10-22', avg: 500 },
        ]),
      ).toBeNull();
    });
  });

  describe('sparkline', () => {
    it('sorts chronologically, takes last 8 days, and rounds to integers', () => {
      const points = [
        { day: '2026-10-22', avg: 900.4 },
        { day: '2026-10-13', avg: 100.2 },
        { day: '2026-10-14', avg: 200.6 },
        { day: '2026-10-15', avg: 300.1 },
        { day: '2026-10-16', avg: 400.9 },
        { day: '2026-10-17', avg: 500.0 },
        { day: '2026-10-18', avg: 600.5 },
        { day: '2026-10-19', avg: 700.2 },
        { day: '2026-10-20', avg: 800.8 },
        { day: '2026-10-21', avg: 850.3 },
      ];
      expect(sparkline(points)).toEqual([300, 401, 500, 601, 700, 801, 850, 900]);
    });
  });
});
