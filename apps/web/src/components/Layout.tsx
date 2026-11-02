import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900'}`;

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <span className="text-base font-semibold text-brand-700">
            TrialMatch
          </span>
          <nav className="flex gap-1" aria-label="Main">
            <NavLink to="/trials" className={navClass}>
              Trials
            </NavLink>
            <NavLink to="/patients" className={navClass}>
              Patients
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">
              {user?.displayName}
            </span>
            <button type="button" className="btn-secondary" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
