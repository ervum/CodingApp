import type { Id, IsoDateString } from './common.dto.js';
import type { DataSource, IngestionStatus, MarketSortId } from '../enums.js';

export interface MarketRowDto {
  rank: number; universeId: string; rootPlaceId: string | null; name: string; creatorName: string; genre: string | null;
  iconUrl: string | null; playing: number; visits: number; favoritedCount: number;
  upVotes: number; downVotes: number; likeRatio: number | null;   // 0..1
  delta7dPct: number | null;  // e.g. 12.4 means +12.4 %
  sparkline: number[];        // up to 8 daily-average CCU points, oldest → newest
  updatedAt: IsoDateString;
}
export interface MarketLeaderboardDto {
  sort: MarketSortId; source: DataSource; capturedAt: IsoDateString | null; isStale: boolean;
  lastError: string | null; genres: string[]; rows: MarketRowDto[];
}
export interface MarketHistoryPointDto { capturedAt: IsoDateString; playing: number; upVotes: number; downVotes: number; }
export interface MarketIngestionRunDto {
  id: Id; status: IngestionStatus; source: DataSource; startedAt: IsoDateString; finishedAt: IsoDateString | null;
  sortsFetched: string[]; gamesFetched: number; requestCount: number; errorCode: string | null; errorMessage: string | null; warnings: string[];
}
export interface MarketVelocityCardDto {
  name: string;
  deltaPct: number;
  sparkline: number[];
}
export interface MarketCorpusRowDto {
  rank: number;
  game: string;
  genre: string;
  coreLoop: string;
  sessionLength: string;
  monetisation: string;
  referenceNotes: string;
}
export interface MarketBenchmarkRowDto {
  rank: number;
  dimension: string;
  target: string;
  carriedBy: string;
  tier: 'must-hit' | 'strong';
  failureMeaning: string;
}
export interface MarketBreakoutRowDto {
  game: string;
  playing: number;
  peak: number;
  visits: string;
  age: string;
  likePct: number;
  growth: string;
  fit: string;
  genre: string;
  firstSeen: string;
}
