export const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
] as const;

export type PeriodId = (typeof PERIODS)[number]['id'];

export function periodRange(id: PeriodId): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  if (id === 'today') {
    from.setHours(0, 0, 0, 0);
  } else if (id === '7d') {
    from.setDate(from.getDate() - 7);
  } else {
    from.setDate(from.getDate() - 30);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export function periodLookbackHours(id: PeriodId): number {
  if (id === 'today') return 24;
  if (id === '7d') return 168;
  return 720;
}

export function periodLabel(id: PeriodId): string {
  return PERIODS.find((p) => p.id === id)?.label ?? id;
}
