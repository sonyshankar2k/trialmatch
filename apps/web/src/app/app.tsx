import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from '../components/Layout';
import { LoginPage } from '../features/auth/LoginPage';
import { PatientPage } from '../features/patients/PatientPage';
import { PatientsPage } from '../features/patients/PatientsPage';
import { TrialPage } from '../features/trials/TrialPage';
import { TrialsPage } from '../features/trials/TrialsPage';
import { ApiRequestError } from '../lib/api';
import { AuthProvider, RequireAuth } from '../lib/auth';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retry network blips, never 4xx (a 404 won't fix itself).
        retry: (count, err) =>
          !(err instanceof ApiRequestError && err.status < 500) && count < 2,
      },
    },
  });
}

export function App({ queryClient }: { queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/trials" replace />} />
            <Route path="trials" element={<TrialsPage />} />
            <Route path="trials/:id" element={<TrialPage />} />
            <Route path="patients" element={<PatientsPage />} />
            <Route path="patients/:id" element={<PatientPage />} />
            <Route path="*" element={<Navigate to="/trials" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
