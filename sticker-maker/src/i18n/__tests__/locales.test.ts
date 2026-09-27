import sharedEmotions from '../../../supabase/functions/_shared/emotions.json';
import { EMOTION_PRESETS } from '../../domain/emotions';
import de from '../locales/de.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import pt from '../locales/pt.json';
import ru from '../locales/ru.json';

type Json = Record<string, unknown>;

function flatten(value: Json, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      return flatten(child as Json, path);
    }
    return [path];
  });
}

/** Plural suffixes differ per language by design, so compare the base keys. */
function baseKeys(value: Json): Set<string> {
  return new Set(
    flatten(value).map((key) => key.replace(/_(one|two|few|many|other)$/, '')),
  );
}

const locales: Record<string, Json> = { ru, es, fr, de, pt };

describe('translation coverage', () => {
  const reference = baseKeys(en as Json);

  it.each(Object.keys(locales))('%s has every English key', (language) => {
    const keys = baseKeys(locales[language] as Json);
    const missing = [...reference].filter((key) => !keys.has(key));
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(locales))('%s has no keys English does not have', (language) => {
    const keys = baseKeys(locales[language] as Json);
    const extra = [...keys].filter((key) => !reference.has(key));
    expect(extra).toEqual([]);
  });

  it.each(Object.keys({ en, ...locales }))('%s has no empty strings', (language) => {
    const value = ({ en, ...locales } as Record<string, Json>)[language] as Json;
    const empties = flatten(value).filter((key) => {
      const cursor = key.split('.').reduce<unknown>((node, part) => (node as Json)[part], value);
      return typeof cursor === 'string' && cursor.trim().length === 0;
    });
    expect(empties).toEqual([]);
  });
});

describe('emotion presets', () => {
  it('are loaded from the file the Edge Function also reads', () => {
    expect(EMOTION_PRESETS.length).toBe((sharedEmotions as unknown[]).length);
    expect(EMOTION_PRESETS.length).toBeGreaterThanOrEqual(24);
  });

  it('have unique ids and a non-empty prompt', () => {
    const ids = EMOTION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of EMOTION_PRESETS) {
      expect(preset.prompt.length).toBeGreaterThan(5);
      expect(preset.stickerEmojis.length).toBeGreaterThan(0);
      expect(preset.stickerEmojis.length).toBeLessThanOrEqual(3);
    }
  });

  it('covers every category shown in the picker', () => {
    const categories = new Set(EMOTION_PRESETS.map((preset) => preset.category));
    expect([...categories].sort()).toEqual(
      ['animal', 'celebration', 'daily', 'love', 'reaction', 'work'].sort(),
    );
  });
});
