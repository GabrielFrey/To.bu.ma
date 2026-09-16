export type ClassValue = string | number | false | null | undefined | ClassValue[];

/**
 * Join conditional class names. Deliberately tiny: this is the only thing the
 * project needs from a `clsx`/`classnames` dependency.
 *
 *   cn('px-2', active && 'bg-accent', ['text-ink', error && 'text-danger-ink'])
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const value of values) {
    if (!value && value !== 0) continue;
    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) out.push(nested);
    } else {
      out.push(String(value));
    }
  }
  return out.join(' ');
}
