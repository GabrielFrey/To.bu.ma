import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type AgentSpend,
  type AssistantSpend,
  type BudgetRecord,
  type BudgetStatus,
  type CostPerTask,
  type ExpensivePrompt,
  type LoopRow,
  type PolicyEvent,
  type PolicyRecord,
  type ProjectSpend,
  type RecentRequest,
  type Recommendation,
  type SavingsLedger,
  type TaskSpend,
  type TotalSpend,
} from '../api';
import { periodRange, type PeriodId } from '../lib/period';

export interface DashboardData {
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  total: TotalSpend | null;
  agents: AgentSpend[];
  tasks: TaskSpend[];
  projects: ProjectSpend[];
  budgets: BudgetStatus[];
  budgetRecords: BudgetRecord[];
  warnings: PolicyEvent[];
  blocked: PolicyEvent[];
  expensive: ExpensivePrompt[];
  loops: LoopRow[];
  recs: Recommendation[];
  savings: SavingsLedger | null;
  costPerTask: CostPerTask | null;
  policies: PolicyRecord[];
  packs: { id: string; name: string; description: string; process: string }[];
  recent: RecentRequest[];
  assistantSpend: AssistantSpend | null;
  reload: () => Promise<void>;
}

type Snapshot = Omit<DashboardData, 'reload'>;

const EMPTY: Omit<Snapshot, 'loading' | 'error' | 'lastUpdated'> = {
  total: null,
  agents: [],
  tasks: [],
  projects: [],
  budgets: [],
  budgetRecords: [],
  warnings: [],
  blocked: [],
  expensive: [],
  loops: [],
  recs: [],
  savings: null,
  costPerTask: null,
  policies: [],
  packs: [],
  recent: [],
  assistantSpend: null,
};

async function settled<T>(promise: Promise<T>, fallback: T): Promise<{ value: T; error?: string }> {
  try {
    return { value: await promise };
  } catch (err) {
    return { value: fallback, error: (err as Error).message };
  }
}

export function useDashboardData(period: PeriodId, pausePolling: boolean): DashboardData {
  const [data, setData] = useState<Snapshot>({
    ...EMPTY,
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const load = useCallback(async () => {
    const range = periodRange(period);
    const [
      total,
      agents,
      tasks,
      projects,
      budgets,
      budgetRecords,
      warnings,
      blocked,
      expensive,
      loops,
      recs,
      savings,
      costPerTask,
      policies,
      packs,
      recent,
      assistantSpend,
    ] = await Promise.all([
      settled(api.total(range), null),
      settled(api.byAgent(range), []),
      settled(api.byTask(range), []),
      settled(api.byProject(range), []),
      settled(api.activeBudgets(), []),
      settled(api.budgets(), []),
      settled(api.warnings(range), []),
      settled(api.blocked(range), []),
      settled(api.expensive(range), []),
      settled(api.loops(range), []),
      settled(api.recommendations(range), []),
      settled(api.savingsLedger(), null),
      settled(api.costPerTask(), null),
      settled(api.policies(), []),
      settled(api.listPolicyPacks(), []),
      settled(api.recentRequests(range), []),
      settled(api.assistantSpend(), null),
    ]);

    const fatal = Boolean(total.error && !total.value);
    setData({
      loading: false,
      error: fatal ? total.error ?? 'Cannot reach the API.' : null,
      lastUpdated: fatal ? null : new Date(),
      total: total.value,
      agents: agents.value,
      tasks: tasks.value,
      projects: projects.value,
      budgets: budgets.value,
      budgetRecords: budgetRecords.value,
      warnings: warnings.value,
      blocked: blocked.value,
      expensive: expensive.value,
      loops: loops.value,
      recs: recs.value,
      savings: savings.value,
      costPerTask: costPerTask.value,
      policies: policies.value,
      packs: packs.value,
      recent: recent.value,
      assistantSpend: assistantSpend.value,
    });
  }, [period]);

  useEffect(() => {
    void load();
    if (pausePolling) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load, pausePolling]);

  return { ...data, reload: load };
}
