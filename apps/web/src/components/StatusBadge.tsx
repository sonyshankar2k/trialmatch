import { STATUS_LABELS, type TrialStatus } from '@trialmatch/shared';

const colors: Record<TrialStatus, string> = {
  recruiting: 'bg-green-50 text-green-700 ring-green-600/20',
  not_yet_recruiting: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  active_not_recruiting: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  completed: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function StatusBadge({ status }: { status: TrialStatus }) {
  return (
    <span
      className={`inline-flex rounded-full whitespace-nowrap px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colors[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
