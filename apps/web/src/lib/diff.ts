/** The fields of `next` that differ from `base` (deep compare), for field-level PATCH saves. */
export function changedFields<T extends object>(base: T, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(base[key]))
      out[key] = next[key];
  }
  return out;
}
