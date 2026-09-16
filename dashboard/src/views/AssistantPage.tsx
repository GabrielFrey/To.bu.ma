import { AssistantPanel } from '../components/assistant/AssistantPanel';
import { PageHeader } from '../components/primitives';

/**
 * Dedicated assistant view. Chat, tool-call cards, confirmation gate, and
 * Web Speech controls live in `AssistantPanel` / `VoiceControls`.
 */
export function AssistantPage({ onMutated }: { onMutated?: () => void }) {
  return (
    <div>
      <PageHeader
        title="Assistant"
        description="Ask about spend, change budgets, or dictate. Destructive tools wait for confirmation. The assistant is metered on its own budget."
      />
      <AssistantPanel onMutated={onMutated} />
    </div>
  );
}
