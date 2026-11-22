import type { AuditEvent } from '@trialmatch/shared';
import { actionLabel, actorName, describeChange, formatWhen } from './describe';

/** Week 9: a record's history as a timeline, newest first. */
export function AuditEventList({ events }: { events: AuditEvent[] }) {
  if (events.length === 0)
    return (
      <p className="text-sm text-slate-500">Nothing has been recorded yet.</p>
    );
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="border-l-2 border-slate-200 pl-3">
          <p className="text-sm">
            <span className="font-medium">{actionLabel(e)}</span>
            {e.label && <span className="text-slate-600"> · {e.label}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {actorName(e)} · <time dateTime={e.at}>{formatWhen(e.at)}</time>
          </p>
          {e.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
              {e.changes.map((c) => (
                <li key={c.field}>{describeChange(c)}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
