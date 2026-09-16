import { useEffect } from 'react';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { Button } from '../primitives';

/**
 * Right-rail assistant. Stable name so later chat/voice work merges here rather
 * than inventing a second surface. The dedicated Assistant page uses the same
 * `AssistantPanel` when this drawer is closed.
 */
export function AssistantDrawer({
  open,
  onClose,
  onMutated,
}: {
  open: boolean;
  onClose: () => void;
  onMutated?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-ink-strong/20"
        aria-label="Close assistant"
        onClick={onClose}
      />
      <aside
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-surface-muted p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Assistant"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-strong">Assistant</p>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <AssistantPanel onMutated={onMutated} />
      </aside>
    </div>
  );
}
