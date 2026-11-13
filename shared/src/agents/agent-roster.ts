import { AGENT_PC_PRIORITY, type AgentKey, type AgentTool } from '../enums.js';

export interface AgentRosterEntry {
  key: AgentKey;
  name: string;          // display name
  title: string;         // one-line role (Roblox mode default)
  generalTitle?: string; // one-line role in General mode
  color: string;         // avatar background
  glyph: string;         // 2–3 chars shown in avatar
  order: number;         // 1..15 matrix order (row-major, 4 columns)
  pcPriority?: number;   // 100 (highest need) .. 20 (lowest need) for PC / Studio / Sandbox priority hierarchy
  defaultTools: readonly AgentTool[];
}

const BASE: readonly AgentTool[] = [
  'vault_search',
  'vault_read',
  'request_human',
  'list_workspace_files',
  'read_workspace_file',
  'grep_workspace',
  'comment_workspace_file',
  'run_terminal_command',
  'studio_inspect_tree',
  'studio_read_script',
  'pc_observe',
  'pc_act',
  'pc_window',
  'pc_sandbox',
  'studio_direct',
];

const CODE_TOOLS: readonly AgentTool[] = [
  'save_artifact',
  'edit_workspace_file',
  'studio_run_diagnostics',
  'studio_run_playtest',
];

export const GENERAL_AGENT_TITLES: Readonly<Record<AgentKey, string>> = Object.freeze({
  lead: 'Principal director · plans & delegates across specialists',
  pulse: 'Product & market researcher · analyzes trends & pitches',
  architect: 'Systems architect · writes technical blueprints & schemas',
  builder: 'Staff software engineer · writes backend & core systems',
  frame: 'Frontend & UI/UX engineer · builds web/app interfaces',
  scenic: 'Graphics, theme & visual environment engineer',
  balance: 'Algorithms, data modeling & performance engineer',
  librarian: 'Documentation, shared packages & asset curator',
  splash: 'Brand, visual design & media artist',
  producer: 'Technical program manager · tracks milestones & flows',
  liveops: 'DevOps, automation & release engineer',
  merchant: 'Monetization, pricing & billing systems engineer',
  playtest: 'Integration, E2E & security QA engineer',
  tester108: 'Responsive layout, mobile & accessibility QA',
  reviewer: 'Staff code reviewer & pre-release QA gate',
  browser: 'Web browsing agent · navigates sites, fills forms & extracts info',
});

export const AGENT_ROSTER: readonly AgentRosterEntry[] = [
  { key: 'lead',      name: 'Lead',       title: 'Your game director · plans & delegates',        generalTitle: GENERAL_AGENT_TITLES.lead,      color: '#A855F7', glyph: 'LD',  order: 1,  pcPriority: AGENT_PC_PRIORITY.lead,      defaultTools: [...BASE, ...CODE_TOOLS, 'delegate_task'] },
  { key: 'pulse',     name: 'Pulse',      title: 'Watches the Roblox charts & pitches games',     generalTitle: GENERAL_AGENT_TITLES.pulse,     color: '#EC4899', glyph: 'PU',  order: 2,  pcPriority: AGENT_PC_PRIORITY.pulse,     defaultTools: [...BASE, 'market_query', 'create_pitch'] },
  { key: 'architect', name: 'Architect',  title: 'Writes the 12-step game & systems guide',       generalTitle: GENERAL_AGENT_TITLES.architect, color: '#3B82F6', glyph: 'AR',  order: 3,  pcPriority: AGENT_PC_PRIORITY.architect, defaultTools: [...BASE, ...CODE_TOOLS, 'update_milestone'] },
  { key: 'builder',   name: 'Builder',    title: 'Writes the Luau code and connects systems',     generalTitle: GENERAL_AGENT_TITLES.builder,   color: '#22C55E', glyph: 'BU',  order: 4,  pcPriority: AGENT_PC_PRIORITY.builder,   defaultTools: [...BASE, ...CODE_TOOLS, 'acquire_studio_lane', 'release_studio_lane', 'record_build', 'asset_search'] },
  { key: 'frame',     name: 'Frame',      title: 'Builds the UI, menus and icons',                generalTitle: GENERAL_AGENT_TITLES.frame,     color: '#C084FC', glyph: 'FR',  order: 5,  pcPriority: AGENT_PC_PRIORITY.frame,     defaultTools: [...BASE, ...CODE_TOOLS, 'asset_search'] },
  { key: 'scenic',    name: 'Scenic',     title: 'Builds the 3D world, zones and lighting',       generalTitle: GENERAL_AGENT_TITLES.scenic,    color: '#10B981', glyph: 'SC',  order: 6,  pcPriority: AGENT_PC_PRIORITY.scenic,    defaultTools: [...BASE, ...CODE_TOOLS, 'acquire_studio_lane', 'release_studio_lane', 'asset_search'] },
  { key: 'balance',   name: 'Balance',    title: 'Tunes rewards, pacing and economy math',        generalTitle: GENERAL_AGENT_TITLES.balance,   color: '#EAB308', glyph: 'BA',  order: 7,  pcPriority: AGENT_PC_PRIORITY.balance,   defaultTools: [...BASE, ...CODE_TOOLS] },
  { key: 'librarian', name: 'Librarian',  title: 'Curates reusable 3D models, UI & audio',        generalTitle: GENERAL_AGENT_TITLES.librarian, color: '#38BDF8', glyph: 'LI',  order: 8,  pcPriority: AGENT_PC_PRIORITY.librarian, defaultTools: [...BASE, 'vault_update_document', ...CODE_TOOLS, 'asset_register', 'asset_search'] },
  { key: 'splash',    name: 'Splash',     title: 'Paints thumbnails, game icons & key art',       generalTitle: GENERAL_AGENT_TITLES.splash,    color: '#F97316', glyph: 'SP',  order: 9,  pcPriority: AGENT_PC_PRIORITY.splash,    defaultTools: [...BASE, 'generate_image', 'submit_for_review', 'asset_search'] },
  { key: 'producer',  name: 'Producer',   title: 'Tracks stages, builds & what needs you',        generalTitle: GENERAL_AGENT_TITLES.producer,  color: '#F59E0B', glyph: 'PR',  order: 10, pcPriority: AGENT_PC_PRIORITY.producer,  defaultTools: [...BASE, 'update_milestone', 'submit_for_review', 'delegate_task', 'record_build'] },
  { key: 'liveops',   name: 'Liveops',    title: 'Watches live numbers, events & retention',      generalTitle: GENERAL_AGENT_TITLES.liveops,   color: '#84CC16', glyph: 'LO',  order: 11, pcPriority: AGENT_PC_PRIORITY.liveops,   defaultTools: [...BASE, ...CODE_TOOLS] },
  { key: 'merchant',  name: 'Merchant',   title: 'Designs shop offers, passes & pricing',         generalTitle: GENERAL_AGENT_TITLES.merchant,  color: '#F43F5E', glyph: 'ME',  order: 12, pcPriority: AGENT_PC_PRIORITY.merchant,  defaultTools: [...BASE, ...CODE_TOOLS, 'market_query'] },
  { key: 'playtest',  name: 'Playtest',   title: 'Runs multi-player & save recovery checks',      generalTitle: GENERAL_AGENT_TITLES.playtest,  color: '#6366F1', glyph: 'PT',  order: 13, pcPriority: AGENT_PC_PRIORITY.playtest,  defaultTools: [...BASE, 'studio_run_diagnostics', 'studio_run_playtest', 'acquire_studio_lane', 'release_studio_lane', 'flag_blocker'] },
  { key: 'tester108', name: '108 Tester', title: 'Plays the opening on phone & tablet sizes',     generalTitle: GENERAL_AGENT_TITLES.tester108, color: '#0EA5E9', glyph: '108', order: 14, pcPriority: AGENT_PC_PRIORITY.tester108, defaultTools: [...BASE, 'studio_run_diagnostics', 'studio_run_playtest', 'acquire_studio_lane', 'release_studio_lane', 'flag_blocker'] },
  { key: 'reviewer',  name: 'Reviewer',   title: 'Checks purchase safety & publish readiness',    generalTitle: GENERAL_AGENT_TITLES.reviewer,  color: '#14B8A6', glyph: 'RV',  order: 15, pcPriority: AGENT_PC_PRIORITY.reviewer,  defaultTools: [...BASE, 'studio_run_diagnostics', 'studio_run_playtest', 'flag_blocker', 'submit_for_review'] },
  { key: 'browser',   name: 'Browser',    title: 'Browses the web, navigates sites & extracts info', generalTitle: GENERAL_AGENT_TITLES.browser, color: '#06B6D4', glyph: 'BW',  order: 16, pcPriority: AGENT_PC_PRIORITY.browser,   defaultTools: [...BASE, 'save_artifact', 'browser_navigate', 'browser_observe', 'browser_act', 'browser_extract', 'browser_tabs'] },
] as const;

export const AGENT_BY_KEY: Readonly<Record<AgentKey, AgentRosterEntry>> =
  Object.freeze(Object.fromEntries(AGENT_ROSTER.map((a) => [a.key, a])) as Record<AgentKey, AgentRosterEntry>);
