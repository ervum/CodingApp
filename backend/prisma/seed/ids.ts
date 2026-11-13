export const SEED_IDS = {
  users: {
    ervum: 'seed_user_ervum',
    maya: 'seed_user_maya',
  },
  studios: {
    inclined: 'seed_studio_inclined',
    sandbox: 'seed_studio_sandbox',
  },
  games: {
    aar: 'seed_game_aar',
    dino: 'seed_game_dino',
  },
  tasks: {
    t01: 'seed_t01',
    t02: 'seed_t02',
    t03: 'seed_t03',
    t04: 'seed_t04',
    t05: 'seed_t05',
    t06: 'seed_t06',
    t07: 'seed_t07',
    t08: 'seed_t08',
    t09: 'seed_t09',
    t10: 'seed_t10',
    t11: 'seed_t11',
    t12: 'seed_t12',
    t13: 'seed_t13',
    t14: 'seed_t14',
    t15: 'seed_t15',
  },
  runs: {
    r01: 'seed_r01',
    r02: 'seed_r02',
    r03: 'seed_r03',
    r04: 'seed_r04',
    r05: 'seed_r05',
    r06: 'seed_r06',
    r07: 'seed_r07',
    r08: 'seed_r08',
    r09: 'seed_r09',
    r10: 'seed_r10',
    r11: 'seed_r11',
    r12: 'seed_r12',
    r13: 'seed_r13',
    r14: 'seed_r14',
    r15: 'seed_r15',
  },
  pitches: {
    p1: 'seed_pitch_p1',
    p2: 'seed_pitch_p2',
  },
  humanRequests: {
    hr1: 'seed_hr01',
    hr2: 'seed_hr02',
    hr3: 'seed_hr03',
    hr4: 'seed_hr04',
    hr5: 'seed_hr05',
  },
  reviewItems: {
    ri01: 'seed_ri01',
    ri02: 'seed_ri02',
    ri03: 'seed_ri03',
    ri04: 'seed_ri04',
    ri05: 'seed_ri05',
    ri06: 'seed_ri06',
    ri07: 'seed_ri07',
    ri08: 'seed_ri08',
    ri09: 'seed_ri09',
    ri10: 'seed_ri10',
  },
  blockers: {
    b1: 'seed_blocker_b1',
    b2: 'seed_blocker_b2',
    b3: 'seed_blocker_b3',
  },
  media: {
    'icon-aar-v2': 'seed_media_icon_aar_v2',
    'icon-aar-v3': 'seed_media_icon_aar_v3',
    'thumb-aar-boss': 'seed_media_thumb_aar_boss',
    'thumb-aar-10m': 'seed_media_thumb_aar_10m',
    'board-aar-trailer': 'seed_media_board_aar_trailer',
    'icon-dino-v1': 'seed_media_icon_dino_v1',
    'thumb-dino-sunset': 'seed_media_thumb_dino_sunset',
    'thumb-dino-museum': 'seed_media_thumb_dino_museum',
  },
} as const;

export function ago(
  now: Date,
  parts: { days?: number; hours?: number; minutes?: number },
): Date {
  const ms =
    ((parts.days ?? 0) * 86_400 +
      (parts.hours ?? 0) * 3_600 +
      (parts.minutes ?? 0) * 60) *
    1_000;
  return new Date(now.getTime() - ms);
}
