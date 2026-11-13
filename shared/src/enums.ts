const values = <T extends string>(...v: readonly T[]) => Object.freeze(Object.fromEntries(v.map((x) => [x, x])) as { readonly [K in T]: K });

export const MembershipRole = values('OWNER', 'ADMIN', 'PRODUCER', 'VIEWER');
export type MembershipRole = keyof typeof MembershipRole;
export const ROLE_RANK: Record<MembershipRole, number> = { VIEWER: 0, PRODUCER: 1, ADMIN: 2, OWNER: 3 };

export const LlmProvider = values(
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE',
  'GOOGLE_WEB',
  'CLAUDE_WEB',
  'CHATGPT_WEB',
  'GEMINI_APP',
  'CLAUDE_APP',
  'GPT_APP',
  'ANTIGRAVITY',
  'CLAUDE_CODE',
  'CODEX',
  'XAI',
  'OLLAMA',
  'RUNPOD',
  'OPENAI_COMPATIBLE',
);
export type LlmProvider = keyof typeof LlmProvider;

export const WEB_SESSION_PROVIDERS: readonly LlmProvider[] = [
  'GOOGLE_WEB',
  'CLAUDE_WEB',
  'CHATGPT_WEB',
];

export const DESKTOP_APP_PROVIDERS: readonly LlmProvider[] = [
  'ANTIGRAVITY',
  'GEMINI_APP',
  'CLAUDE_APP',
  'GPT_APP',
];

export const CLI_AGENT_PROVIDERS: readonly LlmProvider[] = [
  'ANTIGRAVITY',
  'CLAUDE_CODE',
  'CODEX',
];

export const BROWSER_MANAGED_PROVIDERS: readonly LlmProvider[] = [
  'GOOGLE_WEB',
  'CLAUDE_WEB',
  'CHATGPT_WEB',
  'GEMINI_APP',
  'CLAUDE_APP',
  'GPT_APP',
  'ANTIGRAVITY',
];

export const KEYLESS_PROVIDERS: readonly LlmProvider[] = [
  'GOOGLE_WEB',
  'CLAUDE_WEB',
  'CHATGPT_WEB',
  'GEMINI_APP',
  'CLAUDE_APP',
  'GPT_APP',
  'ANTIGRAVITY',
  'CLAUDE_CODE',
  'CODEX',
  'OLLAMA',
  'RUNPOD',
  'OPENAI_COMPATIBLE',
];

export const AgentKey = values(
  'lead', 'pulse', 'architect', 'builder', 'frame', 'scenic', 'balance', 'librarian',
  'splash', 'producer', 'liveops', 'merchant', 'playtest', 'tester108', 'reviewer', 'browser',
);
export type AgentKey = keyof typeof AgentKey;

export const AgentStatus = values('IDLE', 'WORKING', 'WAITING_ON_HUMAN', 'BLOCKED', 'PAUSED', 'ERROR', 'OFFLINE');
export type AgentStatus = keyof typeof AgentStatus;

export const AgentTool = values(
  'vault_search', 'vault_read', 'vault_update_document', 'delegate_task', 'request_human',
  'save_artifact', 'market_query', 'create_pitch', 'generate_image', 'submit_for_review',
  'flag_blocker', 'acquire_studio_lane', 'release_studio_lane', 'record_build', 'update_milestone',
  'list_workspace_files', 'read_workspace_file', 'grep_workspace', 'edit_workspace_file',
  'studio_inspect_tree', 'studio_read_script', 'studio_run_diagnostics', 'studio_run_playtest',
  'run_terminal_command', 'comment_workspace_file',
  'pc_observe', 'pc_act', 'pc_window', 'pc_sandbox', 'studio_direct',
  'browser_navigate', 'browser_observe', 'browser_act', 'browser_extract', 'browser_tabs',
  'asset_register', 'asset_search',
);
export type AgentTool = keyof typeof AgentTool;

/**
 * Hierarchy of priority for PC / Roblox Studio / Sandbox access (100 = highest need, 20 = lowest need).
 * When multiple agents contend for the physical Main PC or limited studio resources, higher-priority agents win.
 */
export const AGENT_PC_PRIORITY: Readonly<Record<AgentKey, number>> = Object.freeze({
  playtest: 100,   // #1: Runs live gameplay, multiplayer & save-recovery checks in Studio
  tester108: 95,   // #2: Plays the opening on phone/tablet viewports & tests UI responsiveness
  builder: 90,     // #3: Writes Luau systems, syncs into Studio, and verifies runtime behavior
  scenic: 85,      // #4: Builds 3D world, terrain, zones, and lighting inside Studio
  frame: 80,       // #5: Builds ScreenGui, menus, HUDs, and interactive UI elements
  reviewer: 75,    // #6: Pre-release QA gate, purchase safety, and publish verification
  lead: 70,        // #7: Principal director overseeing studio state, builds, and delegations
  liveops: 60,     // #8: Release engineering, publishing, and live telemetry verification
  architect: 55,   // #9: Systems architect verifying DataModel hierarchy & module contracts
  balance: 50,     // #10: Economy, pacing, and combat math tuning tests
  merchant: 45,    // #11: Shop offers, gamepasses, and DeveloperProduct testing
  producer: 40,    // #12: Stage/build tracking and milestone verification
  librarian: 35,   // #13: Asset/model/module curation and import checks
  splash: 30,      // #14: Thumbnails, icons, and visual asset capture
  browser: 25,     // #15: Web browser agent for autonomous web navigation & extraction
  pulse: 20,       // #16: Market research and pitch authoring
});

export const AGENT_PC_PRIORITY_ORDER: readonly AgentKey[] = Object.freeze([
  'playtest',
  'tester108',
  'builder',
  'scenic',
  'frame',
  'reviewer',
  'lead',
  'liveops',
  'architect',
  'balance',
  'merchant',
  'producer',
  'librarian',
  'splash',
  'browser',
  'pulse',
]);

export const SandboxAccessPolicy = values('ALLOW', 'ASK', 'DENY');
export type SandboxAccessPolicy = keyof typeof SandboxAccessPolicy;

export const SandboxProviderKind = values('LOCAL', 'CLOUD_GPU');
export type SandboxProviderKind = keyof typeof SandboxProviderKind;

export const TaskStatus = values('QUEUED', 'RUNNING', 'NEEDS_HUMAN', 'BLOCKED', 'PAUSED', 'DONE', 'FAILED', 'CANCELLED');
export type TaskStatus = keyof typeof TaskStatus;
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['QUEUED', 'RUNNING', 'NEEDS_HUMAN', 'BLOCKED', 'PAUSED'];

export const TaskPriority = values('LOW', 'NORMAL', 'HIGH', 'URGENT');
export type TaskPriority = keyof typeof TaskPriority;

export const TaskOrigin = values('USER', 'LEAD_DELEGATION', 'AGENT_DELEGATION', 'SYSTEM', 'REVIEW_FEEDBACK');
export type TaskOrigin = keyof typeof TaskOrigin;

export const RunStatus = values('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'AWAITING_HUMAN');
export type RunStatus = keyof typeof RunStatus;

export const LogEntryKind = values('SYSTEM', 'CONTEXT', 'TEXT', 'TOOL_CALL', 'TOOL_RESULT', 'HANDOFF', 'ERROR', 'USAGE');
export type LogEntryKind = keyof typeof LogEntryKind;

export const MessageAuthor = values('USER', 'AGENT', 'SYSTEM');
export type MessageAuthor = keyof typeof MessageAuthor;

export const HumanRequestKind = values('PICK_NEXT_GAME', 'TRY_IT', 'DECISION', 'INFO');
export type HumanRequestKind = keyof typeof HumanRequestKind;
export const HumanRequestStatus = values('OPEN', 'RESOLVED', 'DISMISSED');
export type HumanRequestStatus = keyof typeof HumanRequestStatus;

export const ReviewKind = values('ICON', 'THUMBNAIL', 'TRAILER', 'STORYBOARD', 'STAGE', 'PUBLISH');
export type ReviewKind = keyof typeof ReviewKind;
export const ReviewTab = values('IMAGES_VIDEO', 'STAGES_PUBLISH');
export type ReviewTab = keyof typeof ReviewTab;
export const REVIEW_KIND_TAB: Record<ReviewKind, ReviewTab> = {
  ICON: 'IMAGES_VIDEO', THUMBNAIL: 'IMAGES_VIDEO', TRAILER: 'IMAGES_VIDEO', STORYBOARD: 'IMAGES_VIDEO',
  STAGE: 'STAGES_PUBLISH', PUBLISH: 'STAGES_PUBLISH',
};
export const ReviewStatus = values('TO_REVIEW', 'CHANGES_ASKED', 'APPROVED', 'REJECTED');
export type ReviewStatus = keyof typeof ReviewStatus;
export const Verdict = values('APPROVE', 'ASK_CHANGES', 'REJECT');
export type Verdict = keyof typeof Verdict;
export const VERDICT_TO_STATUS: Record<Verdict, ReviewStatus> = { APPROVE: 'APPROVED', ASK_CHANGES: 'CHANGES_ASKED', REJECT: 'REJECTED' };

export const BlockerSeverity = values('FIX_FIRST', 'SHOULD_FIX', 'NIT');
export type BlockerSeverity = keyof typeof BlockerSeverity;
export const BlockerStatus = values('OPEN', 'RESOLVED', 'WAIVED');
export type BlockerStatus = keyof typeof BlockerStatus;

export const GameStatus = values('CONCEPT', 'BLUEPRINT', 'BUILDING', 'TESTING', 'LIVE', 'PAUSED');
export type GameStatus = keyof typeof GameStatus;
export const BuildKind = values('SAVED', 'PUBLISHED');
export type BuildKind = keyof typeof BuildKind;
export const MobilePassStatus = values('NOT_STARTED', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED');
export type MobilePassStatus = keyof typeof MobilePassStatus;
export const MilestoneStatus = values('TODO', 'IN_PROGRESS', 'DONE');
export type MilestoneStatus = keyof typeof MilestoneStatus;

export const PitchStatus = values('DRAFT', 'PROPOSED', 'CHANGES_REQUESTED', 'PICKED', 'ARCHIVED');
export type PitchStatus = keyof typeof PitchStatus;
export const PitchSectionKey = values('FIRST_60_SECONDS', 'FIVE_MINUTE_LOOP', 'MINUTES_10_30', 'MONETIZATION', 'COMPETITORS', 'RISKS');
export type PitchSectionKey = keyof typeof PitchSectionKey;
export const PITCH_SECTION_TITLES: Record<PitchSectionKey, string> = {
  FIRST_60_SECONDS: 'First 60 seconds', FIVE_MINUTE_LOOP: '5-minute loop', MINUTES_10_30: 'Minutes 10-30',
  MONETIZATION: 'Monetization', COMPETITORS: 'Competitors', RISKS: 'Risks',
};

/** Prisma stores TOP_EARNING etc. and maps them to these Roblox sortIds in the DB. API/DTOs use the Roblox sortId strings. */
export const MarketSortId = values('top-earning', 'top-playing-now', 'up-and-coming', 'top-rated');
export type MarketSortId = keyof typeof MarketSortId;
export const MARKET_SORT_LABELS: Record<MarketSortId, string> = {
  'top-earning': 'Top earning', 'top-playing-now': 'Top playing now', 'up-and-coming': 'Up and coming', 'top-rated': 'Top rated',
};

export const DataSource = values('LIVE', 'SEED', 'COMPUTED');
export type DataSource = keyof typeof DataSource;
export const IngestionStatus = values('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
export type IngestionStatus = keyof typeof IngestionStatus;
export const AuthorKind = values('USER', 'AGENT', 'DISK', 'SEED');
export type AuthorKind = keyof typeof AuthorKind;

export const StudioAssetKind = values('MESH', 'AUDIO', 'DECAL', 'IMAGE', 'ANIMATION', 'OTHER');
export type StudioAssetKind = keyof typeof StudioAssetKind;

export const CodingMode = values('ROBLOX_MCP', 'LOCAL_SYNC');
export type CodingMode = keyof typeof CodingMode;

export const CodingSyncTool = values('SILICON', 'ROJO', 'AZUL', 'ARGON', 'PESTO', 'RBXMK');
export type CodingSyncTool = keyof typeof CodingSyncTool;

export const ContextMode = values('ROBLOX', 'GENERAL');
export type ContextMode = keyof typeof ContextMode;

export const TerminalShell = values('powershell', 'cmd', 'pwsh', 'bash', 'sh', 'wsl');
export type TerminalShell = keyof typeof TerminalShell;

export const ChatArchiveKind = values('FRESH_START', 'BRANCH');
export type ChatArchiveKind = keyof typeof ChatArchiveKind;

export const ChatDirective = values('PC_CONTROL', 'PC_CONTROL_SANDBOX', 'BROWSER', 'PLAN_FIRST');
export type ChatDirective = keyof typeof ChatDirective;

export const AgentKeyTuple = Object.values(AgentKey) as [AgentKey, ...AgentKey[]];
export const AgentToolTuple = Object.values(AgentTool) as [AgentTool, ...AgentTool[]];
export const TaskStatusTuple = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];
export const PitchSectionKeyTuple = Object.values(PitchSectionKey) as [PitchSectionKey, ...PitchSectionKey[]];
export const MarketSortIdTuple = Object.values(MarketSortId) as [MarketSortId, ...MarketSortId[]];
export const ChatDirectiveTuple = Object.values(ChatDirective) as [ChatDirective, ...ChatDirective[]];
export const StudioAssetKindTuple = Object.values(StudioAssetKind) as [StudioAssetKind, ...StudioAssetKind[]];
export const GameStatusTuple = Object.values(GameStatus) as [GameStatus, ...GameStatus[]];
