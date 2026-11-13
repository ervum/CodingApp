export interface VaultFolderSpec { name: string; order: number; alwaysInject: boolean; tags: string[]; }
export const VAULT_FOLDERS: readonly VaultFolderSpec[] = [
  { name: '00 For Any AI', order: 0, alwaysInject: true, tags: ['meta', 'rules'] },
  { name: '00 Start Here', order: 1, alwaysInject: false, tags: ['meta', 'onboarding'] },
  { name: '01 The First Five Minutes', order: 2, alwaysInject: false, tags: ['design', 'onboarding', 'ftue'] },
  { name: '02 The Core Loop', order: 3, alwaysInject: false, tags: ['design', 'loop'] },
  { name: '03 Rarity and RNG', order: 4, alwaysInject: false, tags: ['design', 'rng', 'math'] },
  { name: '04 Progression and Economy', order: 5, alwaysInject: false, tags: ['design', 'economy', 'math'] },
  { name: '05 UI and HUD', order: 6, alwaysInject: false, tags: ['ui', 'hud', 'mobile'] },
  { name: '06 World and Look', order: 7, alwaysInject: false, tags: ['art', 'world', 'lighting'] },
  { name: '07 Characters, VFX and Assets', order: 8, alwaysInject: false, tags: ['art', 'vfx', 'assets'] },
  { name: '08 Mobile', order: 9, alwaysInject: false, tags: ['mobile', 'ui', 'performance'] },
  { name: '09 Shops and Monetisation', order: 10, alwaysInject: false, tags: ['monetisation', 'shop'] },
  { name: '10 Retention and Social', order: 11, alwaysInject: false, tags: ['retention', 'social'] },
  { name: '11 Thumbnails, Icons and the Store Page', order: 12, alwaysInject: false, tags: ['marketing', 'art'] },
  { name: '12 Live Ops and Launch', order: 13, alwaysInject: false, tags: ['liveops', 'launch'] },
  { name: '13 Building It Right', order: 14, alwaysInject: false, tags: ['engineering', 'luau', 'qa'] },
  { name: 'Claude Design prompts', order: 15, alwaysInject: false, tags: ['prompts', 'ui'] },
  { name: 'Our assets', order: 16, alwaysInject: false, tags: ['assets', 'library'] },
  { name: 'Skills', order: 17, alwaysInject: false, tags: ['meta', 'skills'] },
];
/** Folder note convention: each folder contains "<folder>.md" as its primary document. */
export const folderNotePath = (folder: string) => `${folder}/${folder}.md`;
