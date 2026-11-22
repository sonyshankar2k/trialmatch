import { useId, useState } from 'react';
import { errorMessage } from '../../lib/api';
import { AuditEventList } from './AuditEventList';
import { useHistory, type HistorySubject } from './api';

/**
 * Week 9: who did what to this record, and when. Closed by default and loaded
 * on opening, so the page doesn't fetch history nobody asked for.
 */
export function HistoryPanel({ subject }: { subject: HistorySubject }) {
  const [open, setOpen] = useState(false);
  const history = useHistory(subject, open);
  const headingId = useId();
  const bodyId = useId();
  return (
    <section className="card mt-6 p-4" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-base font-semibold">
          History
        </h2>
        <button
          type="button"
          className="btn-secondary px-2.5 py-1 text-xs"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide history' : 'Show history'}
        </button>
      </div>
      {open && (
        <div id={bodyId} className="mt-3">
          {history.isPending ? (
            <p className="text-sm text-slate-500">Loading history…</p>
          ) : history.isError ? (
            <p role="alert" className="text-sm text-red-700">
              {errorMessage(history.error)}
            </p>
          ) : (
            <AuditEventList events={history.data} />
          )}
        </div>
      )}
    </section>
  );
}
