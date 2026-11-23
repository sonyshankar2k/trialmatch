import {
  AUDIT_ACTION_LABELS,
  SYNCED_FIELD_LABELS,
  type AuditChange,
  type AuditEvent,
} from '@trialmatch/shared';

const FIELD_LABELS: Record<string, string> = {
  ...SYNCED_FIELD_LABELS,
  nctId: 'NCT ID',
  pseudonym: 'Pseudonym',
  age: 'Age',
  conditions: 'Conditions',
  medications: 'Medications',
  notes: 'Notes',
  criteria: 'Criteria',
  decision: 'Decision',
  note: 'Review note',
};

export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

/** A value as a person reads it: lists joined, nothing shown as "none". */
export function formatValue(v: AuditChange['from']): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (Array.isArray(v))
    return v.length ? v.map(formatValue).join('; ') : 'none';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** "Age: 40 → 41", "Notes changed (not recorded)", "Status: Recruiting" for a new record. */
export function describeChange(c: AuditChange): string {
  const name = fieldLabel(c.field);
  if (c.redacted) return `${name} changed (text not recorded)`;
  if (c.from === undefined || c.from === null)
    return `${name}: ${formatValue(c.to)}`;
  return `${name}: ${formatValue(c.from)} → ${formatValue(c.to)}`;
}

export const actionLabel = (e: AuditEvent) =>
  AUDIT_ACTION_LABELS[e.action] ?? e.action;

export const actorName = (e: AuditEvent) => e.actor?.name ?? 'System';

export const formatWhen = (iso: string) => new Date(iso).toLocaleString();
