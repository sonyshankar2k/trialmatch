/** Shown when a save gets 409: someone else saved first. The user chooses what happens next. */
export function ConflictBanner({
  onReload,
  onOverwrite,
}: {
  onReload: () => void;
  onOverwrite: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-medium">
        Someone else saved this record after you opened it.
      </p>
      <p className="mt-1">
        Load their version (your unsaved changes are discarded), or save yours
        over it.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary" onClick={onReload}>
          Load their version
        </button>
        <button type="button" className="btn-primary" onClick={onOverwrite}>
          Save mine anyway
        </button>
      </div>
    </div>
  );
}
