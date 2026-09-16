import { NAV_ITEMS, type ViewId } from '../../lib/nav';
import { cn } from '../../lib/cn';

export function Sidebar({
  view,
  onView,
  open,
  onClose,
}: {
  view: ViewId;
  onView: (id: ViewId) => void;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-ink-strong/20 lg:hidden"
          aria-label="Close navigation"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-border bg-surface',
          'transition-transform duration-200 motion-reduce:transition-none',
          open ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:translate-x-0'
        )}
      >
        <div className="border-b border-border px-4 py-4">
          <p className="text-sm font-semibold tracking-tight text-ink-strong">Token Budget Manager</p>
          <p className="mt-0.5 text-xs text-muted">Agent spend control plane</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Primary">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const current = item.id === view;
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-current={current ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      onView(item.id);
                      onClose();
                    }}
                    className={cn(
                      'block rounded-md px-3 py-2 text-sm',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring',
                      current
                        ? 'bg-accent-soft font-medium text-ink-strong'
                        : 'text-muted hover:bg-surface-muted hover:text-ink'
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="border-t border-border px-4 py-3 text-xs text-muted">
          Demo via <code>npm run demo</code>
        </p>
      </aside>
    </>
  );
}
