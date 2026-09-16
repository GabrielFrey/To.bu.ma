import { useEffect } from 'react';
import { cn } from '../../lib/cn';
import { VOICE_LANGS, type UseVoice, type VoiceLang } from '../../hooks/useVoice';

/**
 * Mic controls. Two ways to dictate, because they suit different tasks:
 * press-and-hold for a single question, hands-free for a back-and-forth.
 *
 * Accessibility notes:
 * - The mic is a real <button>, so Space/Enter give keyboard push-to-talk for
 *   free (keydown starts, keyup stops).
 * - Ctrl+Shift+M toggles listening from anywhere on the page.
 * - State is announced in text and by an icon, never by colour alone.
 * - Animations are suppressed under prefers-reduced-motion.
 */
export function VoiceControls({ voice, disabled }: { voice: UseVoice; disabled?: boolean }) {
  const { support, listening, speaking, startListening, stopListening, toggleListening } = voice;

  useEffect(() => {
    if (!support.recognition || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleListening();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [support.recognition, disabled, toggleListening]);

  const state = listening ? 'listening' : speaking ? 'speaking' : 'idle';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {support.recognition && (
        <div className="relative">
          {listening && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-danger animate-pulse-ring motion-reduce:animate-none motion-reduce:hidden"
            />
          )}
          <button
            type="button"
            disabled={disabled}
            aria-pressed={listening}
            aria-label={listening ? 'Stop dictating' : 'Hold to dictate, or press to start'}
            title="Hold to talk · Ctrl+Shift+M to toggle"
            onPointerDown={startListening}
            onPointerUp={stopListening}
            onPointerLeave={() => listening && stopListening()}
            onKeyDown={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                e.preventDefault();
                startListening();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                stopListening();
              }
            }}
            className={cn(
              'relative w-9 h-9 rounded-full flex items-center justify-center text-base',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring',
              'disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
              listening
                ? 'bg-danger text-ink-inverse'
                : 'border border-edge-strong text-ink hover:bg-surface-muted'
            )}
          >
            <span aria-hidden="true">{listening ? '■' : '🎙'}</span>
          </button>
        </div>
      )}

      {support.recognition && (
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={voice.handsFree}
            disabled={disabled}
            onChange={(e) => voice.setHandsFree(e.target.checked)}
          />
          Hands-free
        </label>
      )}

      {support.synthesis && (
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={voice.speakReplies}
            onChange={(e) => voice.setSpeakReplies(e.target.checked)}
          />
          Speak replies
        </label>
      )}

      {(support.recognition || support.synthesis) && (
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="sr-only">Voice language</span>
          <select
            className={cn(
              'text-xs border border-edge-strong rounded px-1.5 py-1 bg-surface',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'
            )}
            value={voice.lang}
            onChange={(e) => voice.setLang(e.target.value as VoiceLang)}
          >
            {VOICE_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <VoiceState state={state} onStopSpeaking={voice.cancelSpeech} />
    </div>
  );
}

function VoiceState({
  state,
  onStopSpeaking,
}: {
  state: 'listening' | 'speaking' | 'idle';
  onStopSpeaking: () => void;
}) {
  if (state === 'idle') return null;
  const listening = state === 'listening';
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full',
        listening ? 'bg-danger-soft text-danger-ink' : 'bg-info-soft text-info-ink'
      )}
    >
      <span aria-hidden="true" className="flex items-end gap-0.5 h-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'w-0.5 h-3 rounded-full animate-bar-bounce motion-reduce:animate-none',
              listening ? 'bg-danger' : 'bg-info'
            )}
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      {listening ? 'Listening' : 'Speaking'}
      {!listening && (
        <button
          type="button"
          onClick={onStopSpeaking}
          className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring rounded"
        >
          stop
        </button>
      )}
    </span>
  );
}
