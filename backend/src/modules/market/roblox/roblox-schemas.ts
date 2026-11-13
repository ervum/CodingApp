import { z } from 'zod';

export const SortsResponse = z.looseObject({
  sorts: z.array(
    z.looseObject({
      sortId: z.string(),
      sortDisplayName: z.string().optional(),
    }),
  ),
});
export type SortsResponseData = z.infer<typeof SortsResponse>;

const SortGame = z.looseObject({
  universeId: z.union([z.number(), z.string()]).transform(String),
});

export const SortContentResponse = z
  .looseObject({
    games: z.array(SortGame).optional(),
    items: z.array(SortGame).optional(),
  })
  .transform((r) => (r.games ?? r.items ?? []).map((g) => g.universeId));
export type SortContentResponseData = z.infer<typeof SortContentResponse>;

export const GamesResponse = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.number(),
      rootPlaceId: z.number().nullable().optional(),
      name: z.string(),
      creator: z.looseObject({
        name: z.string(),
        type: z.string().optional(),
      }),
      playing: z.number().nullable().optional(),
      visits: z.number().nullable().optional(),
      favoritedCount: z.number().nullable().optional(),
      maxPlayers: z.number().nullable().optional(),
      genre_l1: z.string().nullable().optional(),
      genre_l2: z.string().nullable().optional(),
      genre: z.string().nullable().optional(),
    }),
  ),
});
export type GamesResponseData = z.infer<typeof GamesResponse>;

export const VotesResponse = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.number(),
      upVotes: z.number(),
      downVotes: z.number(),
    }),
  ),
});
export type VotesResponseData = z.infer<typeof VotesResponse>;

export const IconsResponse = z.looseObject({
  data: z.array(
    z.looseObject({
      targetId: z.number(),
      state: z.string(),
      imageUrl: z.string().nullable().optional(),
    }),
  ),
});
export type IconsResponseData = z.infer<typeof IconsResponse>;
