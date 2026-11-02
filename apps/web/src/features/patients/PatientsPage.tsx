import { Link, useSearchParams } from 'react-router';
import { Pagination } from '../../components/Pagination';
import { errorMessage } from '../../lib/api';
import { useDebounced } from '../../lib/useDebounced';
import { usePatients } from './api';

export function PatientsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const page = Number(params.get('page')) || 1;
  const debouncedSearch = useDebounced(search);
  const { data, isPending, isError, error } = usePatients({
    search: debouncedSearch || undefined,
    page,
    pageSize: 20,
  });

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Patients</h1>
          <p className="text-sm text-slate-500">
            De-identified profiles. Only you can see the patients you add.
          </p>
        </div>
        <Link to="/patients/new" className="btn-primary">
          New patient
        </Link>
      </div>
      <input
        className="input mb-4"
        type="search"
        aria-label="Search patients"
        placeholder="Search by pseudonym or condition"
        value={search}
        onChange={(e) => set('search', e.target.value)}
      />
      <div className="card overflow-hidden">
        {isPending ? (
          <p className="p-6 text-sm text-slate-500">Loading patients…</p>
        ) : isError ? (
          <p role="alert" className="p-6 text-sm text-red-700">
            {errorMessage(error)}
          </p>
        ) : data.items.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No patients yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/patients/${p.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50"
                  >
                    <span className="w-24 font-medium text-brand-700">
                      {p.pseudonym}
                    </span>
                    <span className="w-28 text-sm text-slate-600">
                      {p.age} y · {p.sex}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {p.conditions.map((c) => (
                        <span
                          key={c}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                        >
                          {c}
                        </span>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={(p) => set('page', String(p))}
            />
          </>
        )}
      </div>
    </section>
  );
}
