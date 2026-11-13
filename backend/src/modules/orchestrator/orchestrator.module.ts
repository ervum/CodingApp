import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { GamesModule } from '../games/games.module.js';
import { HumanRequestsModule } from '../human-requests/human-requests.module.js';
import { LanesModule } from '../lanes/lanes.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MarketModule } from '../market/market.module.js';
import { MediaModule } from '../media/media.module.js';
import { PitchesModule } from '../pitches/pitches.module.js';
import { ReviewModule } from '../review/review.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { LogBufferFactory } from './log-buffer.js';
import { OrchestratorService } from './orchestrator.service.js';
import { PromptResolverService } from './prompt-resolver.service.js';
import { RunExecutorService } from './run-executor.service.js';
import {
  AssetRegisterTool,
  AssetSearchTool,
} from './tools/asset.tools.js';
import { BrowserAgentService } from './tools/browser-agent.service.js';
import {
  BrowserActTool,
  BrowserExtractTool,
  BrowserNavigateTool,
  BrowserObserveTool,
  BrowserTabsTool,
} from './tools/browser.tools.js';
import { CreatePitchTool } from './tools/create-pitch.tool.js';
import { DelegateTaskTool } from './tools/delegate-task.tool.js';
import { FlagBlockerTool } from './tools/flag-blocker.tool.js';
import { GenerateImageTool } from './tools/generate-image.tool.js';
import { MarketQueryTool } from './tools/market-query.tool.js';
import { RecordBuildTool } from './tools/record-build.tool.js';
import { RequestHumanTool } from './tools/request-human.tool.js';
import {
  StudioInspectTreeTool,
  StudioReadScriptTool,
  StudioRunDiagnosticsTool,
  StudioRunPlaytestTool,
} from './tools/roblox-studio-mcp.tools.js';
import {
  PcActTool,
  PcObserveTool,
  PcSandboxTool,
  PcWindowTool,
} from './tools/pc-computer-use.tools.js';
import { PcDesktopAutomationService } from './tools/pc-desktop-automation.service.js';
import { StudioDirectTool } from './tools/roblox-studio-direct.tools.js';
import { SaveArtifactTool } from './tools/save-artifact.tool.js';
import {
  AcquireStudioLaneTool,
  ReleaseStudioLaneTool,
} from './tools/studio-lane.tools.js';
import { SubmitForReviewTool } from './tools/submit-for-review.tool.js';
import { ToolRegistryService } from './tools/tool-registry.service.js';
import { UpdateMilestoneTool } from './tools/update-milestone.tool.js';
import { VaultReadTool } from './tools/vault-read.tool.js';
import { VaultSearchTool } from './tools/vault-search.tool.js';
import { VaultUpdateDocumentTool } from './tools/vault-update-document.tool.js';
import {
  CommentWorkspaceFileTool,
  EditWorkspaceFileTool,
  GrepWorkspaceTool,
  ListWorkspaceFilesTool,
  ReadWorkspaceFileTool,
  RunTerminalCommandTool,
} from './tools/workspace-files.tools.js';
import { VaultContextService } from './vault-context.service.js';

@Module({
  imports: [
    LlmModule,
    VaultModule,
    TasksModule,
    HumanRequestsModule,
    MarketModule,
    PitchesModule,
    MediaModule,
    ReviewModule,
    LanesModule,
    GamesModule,
    AssetsModule,
  ],
  providers: [
    LogBufferFactory,
    VaultContextService,
    PromptResolverService,
    VaultSearchTool,
    VaultReadTool,
    VaultUpdateDocumentTool,
    DelegateTaskTool,
    RequestHumanTool,
    SaveArtifactTool,
    MarketQueryTool,
    CreatePitchTool,
    GenerateImageTool,
    SubmitForReviewTool,
    FlagBlockerTool,
    AcquireStudioLaneTool,
    ReleaseStudioLaneTool,
    RecordBuildTool,
    UpdateMilestoneTool,
    ListWorkspaceFilesTool,
    ReadWorkspaceFileTool,
    GrepWorkspaceTool,
    EditWorkspaceFileTool,
    CommentWorkspaceFileTool,
    RunTerminalCommandTool,
    StudioInspectTreeTool,
    StudioReadScriptTool,
    StudioRunDiagnosticsTool,
    StudioRunPlaytestTool,
    PcDesktopAutomationService,
    PcObserveTool,
    PcActTool,
    PcWindowTool,
    PcSandboxTool,
    StudioDirectTool,
    BrowserAgentService,
    BrowserNavigateTool,
    BrowserObserveTool,
    BrowserActTool,
    BrowserExtractTool,
    BrowserTabsTool,
    AssetRegisterTool,
    AssetSearchTool,
    ToolRegistryService,
    RunExecutorService,
    OrchestratorService,
  ],
  exports: [
    OrchestratorService,
    RunExecutorService,
    ToolRegistryService,
    PromptResolverService,
    VaultContextService,
    PcDesktopAutomationService,
    BrowserAgentService,
  ],
})
export class OrchestratorModule {}
