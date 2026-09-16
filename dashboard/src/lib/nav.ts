export const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', hint: 'Spend, limits, and what to do next' },
  { id: 'spend', label: 'Spend', hint: 'Who and what is burning tokens' },
  { id: 'budgets', label: 'Budgets', hint: 'Soft and hard limits' },
  { id: 'policies', label: 'Policies', hint: 'Active rules and simulated savings' },
  { id: 'requests', label: 'Requests', hint: 'Blocked, warnings, recent calls' },
  { id: 'assistant', label: 'Assistant', hint: 'Chat and voice' },
  { id: 'settings', label: 'Settings', hint: 'Connection and API key' },
] as const;

export type ViewId = (typeof NAV_ITEMS)[number]['id'];

const IDS = new Set<string>(NAV_ITEMS.map((n) => n.id));

export function isViewId(value: string): value is ViewId {
  return IDS.has(value);
}

export function viewFromHash(): ViewId {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return isViewId(raw) ? raw : 'overview';
}

export function hashForView(id: ViewId): string {
  return `#${id}`;
}
