import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@kroegentocht/shared';
import { ApiError, api } from './api.js';

interface AuthState {
  user: MeDto | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, inviteCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<MeDto>('/api/auth/me');
      } catch (err) {
        // Niet ingelogd is een geldige uitkomst, geen fout om te tonen.
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: (input: { username: string; password: string }) =>
      api.post<MeDto>('/api/auth/login', input),
    onSuccess: (user) => queryClient.setQueryData(['me'], user),
  });

  const registerMutation = useMutation({
    mutationFn: (input: { username: string; password: string; inviteCode: string }) =>
      api.post<MeDto>('/api/auth/register', input),
    onSuccess: (user) => queryClient.setQueryData(['me'], user),
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post<void>('/api/auth/logout'),
    onSuccess: async () => {
      queryClient.setQueryData(['me'], null);
      // Alles wat aan deze gebruiker hing uit de cache: anders zou de volgende
      // gebruiker op dit toestel de bezoeken van de vorige nog even zien.
      await queryClient.invalidateQueries();
      queryClient.clear();
      queryClient.setQueryData(['me'], null);
    },
  });

  const value = useMemo<AuthState>(
    () => ({
      user: meQuery.data ?? null,
      loading: meQuery.isLoading,
      login: async (username, password) => {
        await loginMutation.mutateAsync({ username, password });
      },
      register: async (username, password, inviteCode) => {
        await registerMutation.mutateAsync({ username, password, inviteCode });
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
    }),
    [meQuery.data, meQuery.isLoading, loginMutation, registerMutation, logoutMutation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth moet binnen AuthProvider gebruikt worden.');
  return context;
}
