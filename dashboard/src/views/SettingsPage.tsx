import { useState } from 'react';
import { getApiKey, getBaseUrl, setApiKey, setBaseUrl } from '../api';
import { Button, Card, PageHeader } from '../components/primitives';

export function SettingsPage({ onApplied }: { onApplied: () => void }) {
  const [keyInput, setKeyInput] = useState(getApiKey());
  const [urlInput, setUrlInput] = useState(getBaseUrl());
  const [saved, setSaved] = useState(false);

  const apply = () => {
    setApiKey(keyInput.trim());
    setBaseUrl(urlInput.trim());
    setSaved(true);
    onApplied();
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Connection only. Budgets and policies are edited from their pages or the assistant."
      />
      <Card title="API connection">
        <form
          className="max-w-md space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label className="block text-sm">
            <span className="text-xs text-muted">Backend base URL</span>
            <input
              className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
              placeholder="Blank uses the Vite proxy in dev"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-muted">API key</span>
            <input
              className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
              placeholder="x-api-key"
              value={keyInput}
              autoComplete="off"
              onChange={(e) => {
                setKeyInput(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit">Save and refresh</Button>
            {saved && <span className="text-xs text-success-ink">Saved</span>}
          </div>
          <p className="text-xs text-muted">
            Demo key is <code>tbm_demo_local_key</code>. The dashboard proxies <code>/v1</code> to
            localhost:4000 in development.
          </p>
        </form>
      </Card>
    </div>
  );
}
