import type { AuditChange } from '@trialmatch/shared';

/**
 * The fields that differ between two versions of a record. Fields in `redact`
 * are free text that may describe a person: the change is recorded, the text
 * is not.
 */
export function changesBetween<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
  redact: readonly (keyof T & string)[] = [],
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const field of fields) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push(
      redact.includes(field)
        ? { field, redacted: true }
        : {
            field,
            from: from as AuditChange['from'],
            to: to as AuditChange['to'],
          },
    );
  }
  return changes;
}

/** A record's fields as they were created, as changes from nothing. */
export const createdWith = <T extends object>(
  record: T,
  fields: readonly (keyof T & string)[],
  redact: readonly (keyof T & string)[] = [],
): AuditChange[] => changesBetween({} as T, record, fields, redact);
