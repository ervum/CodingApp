import type { MarketGame, PrismaClient } from '../../src/generated/prisma/client.js';
import { ago } from './ids.js';
import type { Prng } from './prng.js';

interface MarketSeedRow {
  rowNum: number;
  suffix: string;
  name: string;
  creatorName: string;
  genreL1: string;
  playingNow: number;
  playing7dAgo: number;
  visits: bigint;
  favorites: bigint;
  upVotes: number;
  downVotes: number;
}

const MARKET_ROWS: readonly MarketSeedRow[] = [
  { rowNum: 1,  suffix: '01', name: 'Sample Obby',            creatorName: 'Skyline Studio',    genreL1: 'Obby',      playingNow: 18400, playing7dAgo: 12950, visits: 420000000n,  favorites: 1400000n, upVotes: 192000, downVotes: 19000 },
  { rowNum: 2,  suffix: '02', name: 'Sample Workshop',        creatorName: 'Clockwork Labs',    genreL1: 'Tycoon',    playingNow: 9600,  playing7dAgo: 7330,  visits: 185000000n,  favorites: 620000n,  upVotes: 87000,  downVotes: 13000 },
  { rowNum: 3,  suffix: '03', name: 'Sample Relay',           creatorName: 'Dash Collective',   genreL1: 'Obby',      playingNow: 14200, playing7dAgo: 11930, visits: 310000000n,  favorites: 980000n,  upVotes: 141000, downVotes: 14000 },
  { rowNum: 4,  suffix: '04', name: 'Sample Harbor',          creatorName: 'Tideworks',         genreL1: 'Simulator', playingNow: 11800, playing7dAgo: 10350, visits: 270000000n,  favorites: 810000n,  upVotes: 118000, downVotes: 15000 },
  { rowNum: 5,  suffix: '05', name: 'Sample Tower',           creatorName: 'Citadel Nine',      genreL1: 'Strategy',  playingNow: 22400, playing7dAgo: 20180, visits: 640000000n,  favorites: 1900000n, upVotes: 264000, downVotes: 26000 },
  { rowNum: 6,  suffix: '06', name: 'Speed Run 4',            creatorName: 'Vurse',             genreL1: 'Obby',      playingNow: 18000, playing7dAgo: 14800, visits: 1400000000n, favorites: 3200000n, upVotes: 410000, downVotes: 40500 },
  { rowNum: 7,  suffix: '07', name: 'Rooftop Runner',         creatorName: 'Cloudforge Studio', genreL1: 'Obby',      playingNow: 6400,  playing7dAgo: 5380,  visits: 145000000n,  favorites: 490000n,  upVotes: 71000,  downVotes: 8800 },
  { rowNum: 8,  suffix: '08', name: "Obby But You're a Cat",  creatorName: 'Whisker Works',     genreL1: 'Obby',      playingNow: 22700, playing7dAgo: 18400, visits: 1100000000n, favorites: 1900000n, upVotes: 233000, downVotes: 41000 },
  { rowNum: 9,  suffix: '09', name: 'Tower Defense Galaxy',   creatorName: 'Orbit Nine',        genreL1: 'Strategy',  playingNow: 34100, playing7dAgo: 35900, visits: 1600000000n, favorites: 2800000n, upVotes: 388000, downVotes: 52000 },
  { rowNum: 10, suffix: '10', name: 'Midnight Hospital',      creatorName: 'Lantern Horror',    genreL1: 'Horror',    playingNow: 15600, playing7dAgo: 12100, visits: 600000000n,  favorites: 1400000n, upVotes: 176000, downVotes: 24000 },
  { rowNum: 11, suffix: '11', name: 'Speed Run Racers',       creatorName: 'Nitro Kids',        genreL1: 'Racing',    playingNow: 9800,  playing7dAgo: 10600, visits: 450000000n,  favorites: 700000n,  upVotes: 84000,  downVotes: 19000 },
  { rowNum: 12, suffix: '12', name: 'Mega Mall Roleplay',     creatorName: 'Citylight Group',   genreL1: 'Roleplay',  playingNow: 72400, playing7dAgo: 69600, visits: 6200000000n, favorites: 9800000n, upVotes: 1020000, downVotes: 180000 },
  { rowNum: 13, suffix: '13', name: 'Sword Clash Arena',      creatorName: 'Steel Pixel',       genreL1: 'Fighting',  playingNow: 18300, playing7dAgo: 20700, visits: 720000000n,  favorites: 1200000n, upVotes: 160000, downVotes: 38000 },
  { rowNum: 14, suffix: '14', name: 'Fishing Frontier',       creatorName: 'Reel Deal Games',   genreL1: 'Simulator', playingNow: 26900, playing7dAgo: 22000, visits: 890000000n,  favorites: 1700000n, upVotes: 241000, downVotes: 22000 },
  { rowNum: 15, suffix: '15', name: 'Rarity Rush RNG',        creatorName: 'Lucky Seven Studio', genreL1: 'RNG',      playingNow: 19700, playing7dAgo: 13900, visits: 380000000n,  favorites: 1000000n, upVotes: 148000, downVotes: 19000 },
  { rowNum: 16, suffix: '16', name: 'Garden Grow Life',       creatorName: 'Petal Games',       genreL1: 'Simulator', playingNow: 54300, playing7dAgo: 47800, visits: 2900000000n, favorites: 4700000n, upVotes: 590000, downVotes: 48000 },
  { rowNum: 17, suffix: '17', name: 'Zombie Rails',           creatorName: 'Rust Belt Devs',    genreL1: 'Shooter',   playingNow: 13400, playing7dAgo: 16900, visits: 510000000n,  favorites: 980000n,  upVotes: 121000, downVotes: 31000 },
  { rowNum: 18, suffix: '18', name: 'Hide and Seek Mansion',  creatorName: 'Peekaboo Inc',      genreL1: 'Party',     playingNow: 7700,  playing7dAgo: 6880,  visits: 260000000n,  favorites: 480000n,  upVotes: 66000,  downVotes: 9000 },
  { rowNum: 19, suffix: '19', name: 'Mining Mayhem 2',        creatorName: 'Pickaxe Pals',      genreL1: 'Simulator', playingNow: 12600, playing7dAgo: 9100,  visits: 300000000n,  favorites: 820000n,  upVotes: 104000, downVotes: 13000 },
  { rowNum: 20, suffix: '20', name: 'Kaiju Smash City',       creatorName: 'Titan Toys',        genreL1: 'Action',    playingNow: 5200,  playing7dAgo: 3100,  visits: 95000000n,   favorites: 260000n,  upVotes: 41000,  downVotes: 5800 },
  { rowNum: 21, suffix: '21', name: 'Bakery Tycoon Deluxe',   creatorName: 'Crumb Studio',      genreL1: 'Tycoon',    playingNow: 4100,  playing7dAgo: 2700,  visits: 70000000n,   favorites: 190000n,  upVotes: 30500,  downVotes: 3900 },
  { rowNum: 22, suffix: '22', name: 'Volcano Escape',         creatorName: 'Ember Games',       genreL1: 'Survival',  playingNow: 3600,  playing7dAgo: 2100,  visits: 48000000n,   favorites: 150000n,  upVotes: 22000,  downVotes: 3600 },
  { rowNum: 23, suffix: '23', name: 'Racing Pets Derby',      creatorName: 'Pawprint Labs',     genreL1: 'Racing',    playingNow: 2900,  playing7dAgo: 1700,  visits: 31000000n,   favorites: 99000n,   upVotes: 15500,  downVotes: 1900 },
  { rowNum: 24, suffix: '24', name: 'Crystal Caverns RNG',    creatorName: 'Geode Works',       genreL1: 'RNG',       playingNow: 4800,  playing7dAgo: 2900,  visits: 88000000n,   favorites: 240000n,  upVotes: 39000,  downVotes: 4200 },
];

export async function seedMarket(
  prisma: PrismaClient,
  now: Date,
  rng: Prng,
): Promise<void> {
  const startedAt = ago(now, { minutes: 20 });
  const finishedAt = ago(now, { minutes: 19 });

  const ingestionRun = await prisma.marketIngestionRun.create({
    data: {
      status: 'SUCCEEDED',
      source: 'SEED',
      startedAt,
      finishedAt,
      sortsFetched: ['top-earning', 'top-playing-now', 'up-and-coming', 'top-rated'],
      gamesFetched: 24,
      requestCount: 0,
      warnings: [],
    },
  });

  // 32 snapshots per game: every 6h from T-7d18h (186h20m ago) to T-20m
  // Sample i=0..31: t_31 = now - 20m, t_i = t_31 - (31 - i) * 6h
  const tLastMs = startedAt.getTime();
  const stepMs = 6 * 3600 * 1000;
  const t0Ms = tLastMs - 31 * stepMs;

  const gamesByRowNum = new Map<number, { row: MarketSeedRow; game: MarketGame }>();

  for (const row of MARKET_ROWS) {
    const universeId = BigInt(`9000000000000${row.suffix}`);
    const rootPlaceId = universeId + 1000n;

    const game = await prisma.marketGame.create({
      data: {
        universeId,
        rootPlaceId,
        name: row.name,
        creatorName: row.creatorName,
        creatorType: 'Group',
        genreL1: row.genreL1,
        genreL2: null,
        iconUrl: null,
        source: 'SEED',
        firstSeenAt: new Date(t0Ms),
        lastSeenAt: startedAt,
      },
    });
    gamesByRowNum.set(row.rowNum, { row, game });

    const maxPlayers = row.genreL1 === 'Party' || row.genreL1 === 'Survival' ? 12 : 30;
    const snapshotsData = [];

    for (let i = 0; i < 32; i++) {
      const tiMs = t0Ms + i * stepMs;
      const ti = new Date(tiMs);
      const f = i / 31;
      const daysBack = (tLastMs - tiMs) / (86_400 * 1_000);

      let playing: number;
      if (i === 31) {
        playing = row.playingNow;
      } else if (i >= 2 && i <= 5) {
        // Keep the 7-day-ago daily average anchored to playing7dAgo so 7d deltas match pitch copy exactly
        playing = row.playing7dAgo;
      } else {
        const base = row.playing7dAgo + (row.playingNow - row.playing7dAgo) * f;
        const hourUtc = ti.getUTCHours() + ti.getUTCMinutes() / 60;
        const diurnal = 1 + 0.18 * Math.sin((2 * Math.PI * (hourUtc - 14)) / 24);
        const noise = 1 + (rng() - 0.5) * 0.08;
        playing = Math.max(100, Math.round(base * diurnal * noise));
      }

      const visitsDelta = BigInt(Math.round(row.playingNow * 30 * daysBack));
      const visits = row.visits > visitsDelta ? row.visits - visitsDelta : row.visits;
      const favoritedCount = BigInt(Math.round(Number(row.favorites) * (1 - 0.001 * daysBack)));
      const upVotes = Math.round(row.upVotes * (1 - 0.002 * daysBack));
      const downVotes = Math.round(row.downVotes * (1 - 0.002 * daysBack));

      snapshotsData.push({
        marketGameId: game.id,
        ingestionRunId: i === 31 ? ingestionRun.id : null,
        capturedAt: ti,
        playing,
        visits,
        favoritedCount,
        upVotes,
        downVotes,
        maxPlayers,
      });
    }

    await prisma.marketSnapshot.createMany({ data: snapshotsData });
  }

  // Sort entries per Section 6.9
  const topEarningOrder = [1, 2, 3, 4, 5, 6, 7, 12, 16, 9, 14, 8, 15, 13, 10];
  const topPlayingOrder = [1, 2, 3, 4, 5, ...MARKET_ROWS.slice(5).sort((a, b) => b.playingNow - a.playingNow).map((r) => r.rowNum)];
  const upAndComingOrder = [1, 2, 3, 4, 5, 7, 20, 21, 24, 22];
  const topRatedOrder = [...MARKET_ROWS]
    .filter((r) => r.upVotes + r.downVotes >= 5000)
    .sort((a, b) => b.upVotes / (b.upVotes + b.downVotes) - a.upVotes / (a.upVotes + a.downVotes))
    .slice(0, 15)
    .map((r) => r.rowNum);

  const sortEntriesData: Array<{
    ingestionRunId: string;
    sort: 'TOP_EARNING' | 'TOP_PLAYING_NOW' | 'UP_AND_COMING' | 'TOP_RATED';
    rank: number;
    marketGameId: string;
    source: 'SEED';
  }> = [];

  const pushSort = (
    sort: 'TOP_EARNING' | 'TOP_PLAYING_NOW' | 'UP_AND_COMING' | 'TOP_RATED',
    order: readonly number[],
  ) => {
    order.forEach((rowNum, idx) => {
      const entry = gamesByRowNum.get(rowNum)!;
      sortEntriesData.push({
        ingestionRunId: ingestionRun.id,
        sort,
        rank: idx + 1,
        marketGameId: entry.game.id,
        source: 'SEED',
      });
    });
  };

  pushSort('TOP_EARNING', topEarningOrder);
  pushSort('TOP_PLAYING_NOW', topPlayingOrder);
  pushSort('UP_AND_COMING', upAndComingOrder);
  pushSort('TOP_RATED', topRatedOrder);

  await prisma.marketSortEntry.createMany({ data: sortEntriesData });
}
