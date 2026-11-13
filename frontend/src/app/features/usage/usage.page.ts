import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { StudioUsageReportDto, UsageBucketDto } from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { StudioApiService } from '../../core/api/studio-api.service';
import { UsageApiService } from '../../core/api/usage-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-usage-page',
  standalone: true,
  imports: [FormsModule, DecimalPipe, AgentAvatarComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @use 'rd';
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
        @include rd.scrollbar;
      }
      .usage-page {
        padding: 24px 32px 48px;
        max-width: rd.layout('content-max');
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .usage-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .usage-title {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        color: #ffffff;
      }
      .usage-sub {
        margin: 4px 0 0;
        font-family: var(--rd-font-mono);
        font-size: 12px;
        color: #9ca3af;
      }
      .usage-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
      }
      .usage-kpi {
        background: #12141e;
        border: 1px solid #1f2232;
        border-radius: 10px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .usage-kpi__label {
        font-family: var(--rd-font-mono);
        font-size: 11px;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .usage-kpi__val {
        font-family: var(--rd-font-mono);
        font-size: 20px;
        font-weight: 700;
        color: #ffffff;
      }
      .usage-kpi__meta {
        font-size: 11px;
        color: #6b7280;
      }
      .usage-grid {
        display: grid;
        grid-template-columns: 1.5fr 1fr;
        gap: 16px;
        @include rd.respond-below('lg') {
          grid-template-columns: 1fr;
        }
      }
      .usage-card {
        background: #12141e;
        border: 1px solid #1f2232;
        border-radius: 10px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .usage-card__title {
        margin: 0;
        font-family: var(--rd-font-mono);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #e5e7eb;
      }
      .usage-chart {
        width: 100%;
        height: 150px;
      }
      .usage-budgets {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .usage-budget-row {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr auto;
        gap: 10px;
        align-items: end;
        @include rd.respond-below('md') {
          grid-template-columns: 1fr;
        }
      }
      .usage-progress {
        height: 8px;
        border-radius: 999px;
        background: #1d2030;
        overflow: hidden;
      }
      .usage-progress__fill {
        height: 100%;
        background: #7c3aed;
        transition: width 0.2s ease;
        &.is-warn {
          background: #f59e0b;
        }
        &.is-danger {
          background: #ef4444;
        }
      }
      .usage-tabs {
        display: flex;
        gap: 8px;
      }
      .usage-tab {
        height: 30px;
        padding: 0 12px;
        border-radius: 6px;
        border: 1px solid #1f2232;
        background: #12141e;
        color: #9ca3af;
        font-family: var(--rd-font-mono);
        font-size: 12px;
        cursor: pointer;
        &.is-active {
          background: rgba(124, 58, 237, 0.22);
          border-color: #7c3aed;
          color: #ffffff;
        }
      }
      .usage-table-wrap {
        background: #12141e;
        border: 1px solid #1f2232;
        border-radius: 10px;
        overflow-x: auto;
      }
      .usage-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--rd-font-mono);
        font-size: 12px;
        thead th {
          text-align: left;
          padding: 10px 14px;
          background: #151824;
          border-bottom: 1px solid #1f2232;
          font-size: 10px;
          color: #6b7280;
          letter-spacing: 0.06em;
        }
        tbody tr {
          border-bottom: 1px solid #1a1d2b;
        }
        td {
          padding: 10px 14px;
          color: #d1d5db;
        }
      }
      .usage-agent-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        color: #ffffff;
      }
    `,
  ],
  template: `
    <div class="usage-page">
      <header class="usage-header">
        <div>
          <h1 class="usage-title">Token, Cost &amp; Agent Performance Telemetry</h1>
          <p class="usage-sub">
            14-day studio token consumption, estimated USD cost, budget guardrails, and specialist run metrics
          </p>
        </div>
        <button
          type="button"
          class="rd-btn rd-btn--secondary rd-btn--sm"
          [disabled]="loading()"
          (click)="reload()"
        >
          <rd-icon name="refresh" [size]="14" />
          <span>{{ loading() ? 'Refreshing…' : 'Refresh' }}</span>
        </button>
      </header>

      @if (report(); as rep) {
        <div class="usage-kpis">
          <div class="usage-kpi">
            <span class="usage-kpi__label">Today's Tokens</span>
            <span class="usage-kpi__val">{{ rep.totals.todayTokens | number }}</span>
            <span class="usage-kpi__meta">Est. \${{ rep.totals.todayCostUsd | number: '1.2-4' }} today</span>
          </div>
          <div class="usage-kpi">
            <span class="usage-kpi__label">14-Day Total Tokens</span>
            <span class="usage-kpi__val">{{ rep.totals.periodTotalTokens | number }}</span>
            <span class="usage-kpi__meta">
              {{ rep.totals.periodInputTokens | number }} in · {{ rep.totals.periodOutputTokens | number }} out
            </span>
          </div>
          <div class="usage-kpi">
            <span class="usage-kpi__label">14-Day Est. Cost</span>
            <span class="usage-kpi__val">\${{ rep.totals.periodCostUsd | number: '1.2-4' }}</span>
            <span class="usage-kpi__meta">Across {{ rep.totals.periodRuns | number }} agent runs</span>
          </div>
          <div class="usage-kpi">
            <span class="usage-kpi__label">Tool Calls &amp; Reliability</span>
            <span class="usage-kpi__val">{{ rep.totals.periodToolCalls | number }} calls</span>
            <span class="usage-kpi__meta">
              Failure rate: {{ rep.totals.periodFailureRatePct | number: '1.0-1' }}% ({{ rep.totals.periodFailedRuns }} failed)
            </span>
          </div>
        </div>

        <div class="usage-grid">
          <section class="usage-card">
            <h2 class="usage-card__title">Daily Token Consumption (14 Days)</h2>
            <svg class="usage-chart" viewBox="0 0 420 140" preserveAspectRatio="none">
              @for (bar of chartBars(); track bar.day) {
                <g>
                  <rect
                    [attr.x]="bar.x"
                    [attr.y]="bar.y"
                    [attr.width]="bar.w"
                    [attr.height]="bar.h"
                    rx="3"
                    fill="#7c3aed"
                  >
                    <title>{{ bar.day }}: {{ bar.tokens | number }} tokens (\${{ bar.cost | number: '1.2-4' }})</title>
                  </rect>
                </g>
              }
            </svg>
          </section>

          <section class="usage-card">
            <h2 class="usage-card__title">Studio Budget Guardrails</h2>
            <div class="usage-budgets">
              <div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                  <span>Daily Token Budget</span>
                  <span>
                    {{ rep.totals.todayTokens | number }} /
                    {{ rep.budgets.dailyTokenBudget ? (rep.budgets.dailyTokenBudget | number) : 'Unlimited' }}
                  </span>
                </div>
                <div class="usage-progress">
                  <div
                    class="usage-progress__fill"
                    [class.is-warn]="tokenBudgetPct() >= 80 && tokenBudgetPct() < 100"
                    [class.is-danger]="tokenBudgetPct() >= 100"
                    [style.width.%]="tokenBudgetPct()"
                  ></div>
                </div>
              </div>

              @if (store.isAdmin()) {
                <form class="usage-budget-row" (ngSubmit)="saveBudgets()">
                  <label class="rd-field">
                    <span class="rd-label">Daily Tokens</span>
                    <input
                      type="number"
                      min="1000"
                      step="10000"
                      class="rd-input"
                      name="dailyTokenBudget"
                      placeholder="Unlimited"
                      [ngModel]="draftDailyTokenBudget()"
                      (ngModelChange)="draftDailyTokenBudget.set($event)"
                    />
                  </label>
                  <label class="rd-field">
                    <span class="rd-label">Daily Cost ($)</span>
                    <input
                      type="number"
                      min="0.01"
                      step="1"
                      class="rd-input"
                      name="dailyCostBudgetUsd"
                      placeholder="Unlimited"
                      [ngModel]="draftDailyCostUsd()"
                      (ngModelChange)="draftDailyCostUsd.set($event)"
                    />
                  </label>
                  <label class="rd-field">
                    <span class="rd-label">Per-Task Tokens</span>
                    <input
                      type="number"
                      min="500"
                      step="5000"
                      class="rd-input"
                      name="perTaskTokenBudget"
                      placeholder="Unlimited"
                      [ngModel]="draftPerTaskTokens()"
                      (ngModelChange)="draftPerTaskTokens.set($event)"
                    />
                  </label>
                  <button
                    type="submit"
                    class="rd-btn rd-btn--primary rd-btn--sm"
                    [disabled]="savingBudgets()"
                  >
                    {{ savingBudgets() ? 'Saving…' : 'Save Budgets' }}
                  </button>
                </form>
              }
            </div>
          </section>
        </div>

        <div class="usage-tabs">
          <button
            type="button"
            class="usage-tab"
            [class.is-active]="activeBreakdown() === 'agent'"
            (click)="activeBreakdown.set('agent')"
          >
            By Agent ({{ rep.byAgent.length }})
          </button>
          <button
            type="button"
            class="usage-tab"
            [class.is-active]="activeBreakdown() === 'model'"
            (click)="activeBreakdown.set('model')"
          >
            By Model &amp; Provider ({{ rep.byModel.length }})
          </button>
          <button
            type="button"
            class="usage-tab"
            [class.is-active]="activeBreakdown() === 'game'"
            (click)="activeBreakdown.set('game')"
          >
            By Game ({{ rep.byGame.length }})
          </button>
        </div>

        <div class="usage-table-wrap">
          <table class="usage-table">
            <thead>
              <tr>
                <th>BUCKET</th>
                <th>RUNS</th>
                <th>INPUT TOKENS</th>
                <th>OUTPUT TOKENS</th>
                <th>TOTAL TOKENS</th>
                <th>TOOL CALLS</th>
                <th>MEDIAN DURATION</th>
                <th>FAIL RATE</th>
                <th>EST. COST</th>
              </tr>
            </thead>
            <tbody>
              @for (row of activeBuckets(); track row.key) {
                <tr>
                  <td>
                    <div class="usage-agent-cell">
                      @if (row.agentKey) {
                        <rd-agent-avatar [agentKey]="row.agentKey" size="xs" />
                      }
                      <div>
                        <div>{{ row.label }}</div>
                        @if (row.sublabel) {
                          <div style="font-size:10px;color:#6b7280;">{{ row.sublabel }}</div>
                        }
                      </div>
                    </div>
                  </td>
                  <td>{{ row.runCount | number }}</td>
                  <td>{{ row.inputTokens | number }}</td>
                  <td>{{ row.outputTokens | number }}</td>
                  <td><strong>{{ row.totalTokens | number }}</strong></td>
                  <td>{{ row.toolCallCount | number }}</td>
                  <td>{{ (row.medianDurationMs / 1000) | number: '1.1-1' }}s</td>
                  <td>{{ row.failureRatePct | number: '1.0-1' }}%</td>
                  <td>\${{ row.costUsd | number: '1.2-4' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class UsagePage {
  readonly store = inject(StudioStoreService);
  private readonly usageApi = inject(UsageApiService);
  private readonly studioApi = inject(StudioApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(false);
  readonly savingBudgets = signal(false);
  readonly report = signal<StudioUsageReportDto | null>(null);
  readonly activeBreakdown = signal<'agent' | 'model' | 'game'>('agent');

  readonly draftDailyTokenBudget = signal<number | null>(null);
  readonly draftDailyCostUsd = signal<number | null>(null);
  readonly draftPerTaskTokens = signal<number | null>(null);

  readonly activeBuckets = computed<UsageBucketDto[]>(() => {
    const r = this.report();
    if (!r) return [];
    switch (this.activeBreakdown()) {
      case 'agent':
        return r.byAgent;
      case 'model':
        return r.byModel;
      case 'game':
        return r.byGame;
    }
  });

  readonly tokenBudgetPct = computed<number>(() => {
    const r = this.report();
    const limit = r?.budgets.dailyTokenBudget;
    if (!r || !limit || limit <= 0) return 0;
    return Math.min(100, Math.round((r.totals.todayTokens / limit) * 100));
  });

  readonly chartBars = computed(() => {
    const r = this.report();
    const series = r?.dailySeries ?? [];
    if (series.length === 0) return [];
    const maxTokens = Math.max(...series.map((s) => s.totalTokens), 1);
    const count = series.length;
    const slotW = 400 / Math.max(1, count);
    const barW = Math.max(8, Math.floor(slotW - 6));

    return series.map((pt, idx) => {
      const h = Math.max(4, Math.round((pt.totalTokens / maxTokens) * 116));
      return {
        day: pt.day,
        tokens: pt.totalTokens,
        cost: pt.costUsd,
        x: Math.round(10 + idx * slotW),
        y: 130 - h,
        w: barW,
        h,
      };
    });
  });

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (studioId) {
        void this.reload();
      }
    });
  }

  async reload(): Promise<void> {
    const studioId = this.store.studioId();
    if (!studioId) return;
    this.loading.set(true);
    try {
      const rep = await firstValueFrom(this.usageApi.getOverview(studioId, 14));
      this.report.set(rep);
      this.draftDailyTokenBudget.set(rep.budgets.dailyTokenBudget);
      this.draftDailyCostUsd.set(rep.budgets.dailyCostBudgetUsd);
      this.draftPerTaskTokens.set(rep.budgets.perTaskTokenBudget);
    } catch {
      this.toast.error('Failed to load usage & telemetry report');
    } finally {
      this.loading.set(false);
    }
  }

  async saveBudgets(): Promise<void> {
    const studioId = this.store.studioId();
    if (!studioId || this.savingBudgets()) return;
    this.savingBudgets.set(true);
    try {
      const tok =
        this.draftDailyTokenBudget() !== null && Number(this.draftDailyTokenBudget()) >= 1000
          ? Math.round(Number(this.draftDailyTokenBudget()))
          : null;
      const cost =
        this.draftDailyCostUsd() !== null && Number(this.draftDailyCostUsd()) >= 0.01
          ? Number(this.draftDailyCostUsd())
          : null;
      const perTask =
        this.draftPerTaskTokens() !== null && Number(this.draftPerTaskTokens()) >= 500
          ? Math.round(Number(this.draftPerTaskTokens()))
          : null;

      await firstValueFrom(
        this.studioApi.update(studioId, {
          dailyTokenBudget: tok,
          dailyCostBudgetUsd: cost,
          perTaskTokenBudget: perTask,
        }),
      );
      this.toast.success('Updated studio token & cost budgets');
      await this.reload();
    } catch {
      this.toast.error('Failed to update studio budgets');
    } finally {
      this.savingBudgets.set(false);
    }
  }
}
