import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const VOICE_LANGS = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'ru-RU', label: 'Русский' },
] as const;

export type VoiceLang = (typeof VOICE_LANGS)[number]['code'];

const LANG_KEY = 'tbm.voice.lang';
const SPEAK_KEY = 'tbm.voice.speakReplies';

export interface VoiceSupport {
  /** Speech-to-text. Chromium and Safari only; Firefox has never shipped it. */
  recognition: boolean;
  /** Text-to-speech. Broadly supported, including Firefox. */
  synthesis: boolean;
}

export interface UseVoiceOptions {
  /**
   * Called with a completed utterance. In hands-free mode this fires repeatedly
   * without further user action, so the caller is responsible for sending it.
   */
  onFinalTranscript?: (text: string) => void;
}

export interface UseVoice {
  support: VoiceSupport;
  /** Human-readable reason voice is degraded, or null when fully available. */
  unavailableReason: string | null;
  listening: boolean;
  speaking: boolean;
  /** Live, not-yet-final words. Empty between utterances. */
  interim: string;
  error: string | null;
  lang: VoiceLang;
  setLang: (lang: VoiceLang) => void;
  handsFree: boolean;
  setHandsFree: (on: boolean) => void;
  speakReplies: boolean;
  setSpeakReplies: (on: boolean) => void;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  speak: (text: string) => void;
  cancelSpeech: () => void;
}

function readStoredLang(): VoiceLang {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(LANG_KEY);
  return VOICE_LANGS.some((l) => l.code === stored) ? (stored as VoiceLang) : 'en-US';
}

/**
 * Markdown and identifiers read badly out loud. Strip the syntax, keep the words,
 * and drop code spans that are usually ids or JSON rather than prose.
 */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^\s*[-*]\s+/gm, ' ')
    .replace(/[*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Browser-only voice I/O: `SpeechRecognition` for dictation and
 * `speechSynthesis` for spoken replies. No keys, no network calls of our own,
 * no dependencies. Every capability is optional and reported through `support`
 * so the caller can render a text-only experience without branching on the
 * user agent.
 */
export function useVoice(options: UseVoiceOptions = {}): UseVoice {
  const support = useMemo<VoiceSupport>(
    () => ({
      recognition:
        typeof window !== 'undefined' &&
        Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
      synthesis: typeof window !== 'undefined' && 'speechSynthesis' in window,
    }),
    []
  );

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lang, setLangState] = useState<VoiceLang>(readStoredLang);
  const [handsFree, setHandsFreeState] = useState(false);
  const [speakReplies, setSpeakRepliesState] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(SPEAK_KEY) === '1'
  );

  const recognition = useRef<SpeechRecognition | null>(null);
  const running = useRef(false);
  /** Distinguishes "the user stopped me" from "the engine timed out". */
  const wantsToListen = useRef(false);
  const handsFreeRef = useRef(handsFree);
  const langRef = useRef(lang);
  const onFinal = useRef(options.onFinalTranscript);
  onFinal.current = options.onFinalTranscript;
  handsFreeRef.current = handsFree;
  langRef.current = lang;

  const cancelSpeech = useCallback(() => {
    if (!support.synthesis) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [support.synthesis]);

  // --- recognition -------------------------------------------------------
  useEffect(() => {
    if (!support.recognition) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      running.current = true;
      setListening(true);
      setError(null);
    };

    // Barge-in: the moment the user actually speaks, stop talking over them.
    rec.onspeechstart = () => {
      if (support.synthesis) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
    };

    rec.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          const finalText = text.trim();
          if (finalText) onFinal.current?.(finalText);
        } else {
          pending += text;
        }
      }
      setInterim(pending.trim());
    };

    rec.onerror = (event) => {
      // `no-speech` and `aborted` are routine in hands-free mode; surfacing them
      // as errors would make the UI flicker between states for no reason.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone permission denied. Allow mic access in your browser to dictate.'
          : `Speech recognition error: ${event.error}`
      );
      wantsToListen.current = false;
    };

    rec.onend = () => {
      running.current = false;
      setInterim('');
      // Chrome ends the session after a pause even with continuous = true, so
      // hands-free mode has to re-arm itself until the user turns it off.
      if (wantsToListen.current && handsFreeRef.current) {
        try {
          rec.lang = langRef.current;
          rec.continuous = true;
          rec.start();
          return;
        } catch {
          wantsToListen.current = false;
        }
      }
      wantsToListen.current = false;
      setListening(false);
    };

    recognition.current = rec;
    return () => {
      wantsToListen.current = false;
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onstart = null;
      rec.onspeechstart = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
      recognition.current = null;
    };
  }, [support.recognition, support.synthesis]);

  const startListening = useCallback(() => {
    const rec = recognition.current;
    if (!rec || running.current) return;
    cancelSpeech();
    wantsToListen.current = true;
    rec.lang = langRef.current;
    rec.continuous = handsFreeRef.current;
    try {
      rec.start();
    } catch {
      // start() throws if the engine has not finished tearing down the last
      // session; the next press works.
      wantsToListen.current = false;
    }
  }, [cancelSpeech]);

  const stopListening = useCallback(() => {
    wantsToListen.current = false;
    setListening(false);
    setInterim('');
    try {
      recognition.current?.stop();
    } catch {
      /* not started */
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (running.current) stopListening();
    else startListening();
  }, [startListening, stopListening]);

  // Leaving hands-free mode should not leave the mic hot.
  const setHandsFree = useCallback(
    (on: boolean) => {
      setHandsFreeState(on);
      handsFreeRef.current = on;
      if (!on && running.current) stopListening();
    },
    [stopListening]
  );

  const setLang = useCallback((next: VoiceLang) => {
    setLangState(next);
    langRef.current = next;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, next);
    if (recognition.current && running.current) recognition.current.lang = next;
  }, []);

  const setSpeakReplies = useCallback(
    (on: boolean) => {
      setSpeakRepliesState(on);
      if (typeof localStorage !== 'undefined') localStorage.setItem(SPEAK_KEY, on ? '1' : '0');
      if (!on) cancelSpeech();
    },
    [cancelSpeech]
  );

  // --- synthesis ---------------------------------------------------------
  const speak = useCallback(
    (text: string) => {
      if (!support.synthesis) return;
      const clean = speakableText(text);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = langRef.current;
      const voice = window.speechSynthesis
        .getVoices()
        .find((v) => v.lang === langRef.current || v.lang.replace('_', '-') === langRef.current);
      if (voice) utterance.voice = voice;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [support.synthesis]
  );

  useEffect(() => () => cancelSpeech(), [cancelSpeech]);

  const unavailableReason = !support.recognition
    ? support.synthesis
      ? 'Dictation is unavailable in this browser (Firefox has not shipped the Speech Recognition API). Spoken replies still work, and text chat is unaffected.'
      : 'Voice is unavailable in this browser. Text chat works normally.'
    : null;

  return {
    support,
    unavailableReason,
    listening,
    speaking,
    interim,
    error,
    lang,
    setLang,
    handsFree,
    setHandsFree,
    speakReplies,
    setSpeakReplies,
    startListening,
    stopListening,
    toggleListening,
    speak,
    cancelSpeech,
  };
}
