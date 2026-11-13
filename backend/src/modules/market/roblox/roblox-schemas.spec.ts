import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GamesResponse,
  IconsResponse,
  SortContentResponse,
  SortsResponse,
  VotesResponse,
} from './roblox-schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

describe('roblox-schemas', () => {
  it('parses get-sorts fixture and tolerates unknown keys', () => {
    const parsed = SortsResponse.parse(readFixture('get-sorts.json'));
    expect(parsed.sorts).toHaveLength(4);
    expect(parsed.sorts[0]?.sortId).toBe('top-earning');
  });

  it('parses get-sort-content fixture with games[] or items[] and transforms universeIds to strings', () => {
    const ids = SortContentResponse.parse(readFixture('get-sort-content.json'));
    expect(ids).toEqual(['994732206', '5873291042']);

    const itemsPayload = {
      items: [{ universeId: 12345 }, { universeId: '67890' }],
    };
    expect(SortContentResponse.parse(itemsPayload)).toEqual(['12345', '67890']);
  });

  it('parses games and votes fixtures', () => {
    const games = GamesResponse.parse(readFixture('games.json'));
    expect(games.data[0]?.name).toBe('Blox Fruits');
    expect(games.data[0]?.playing).toBe(312400);

    const votes = VotesResponse.parse(readFixture('votes.json'));
    expect(votes.data[0]?.upVotes).toBe(6420000);
  });

  it('parses icons payload and fails gracefully on drifted schema', () => {
    const icons = IconsResponse.parse({
      data: [{ targetId: 994732206, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/icon.png' }],
    });
    expect(icons.data[0]?.imageUrl).toContain('rbxcdn.com');

    const driftedSorts = SortsResponse.safeParse({ wrongRootKey: [] });
    expect(driftedSorts.success).toBe(false);
  });
});
