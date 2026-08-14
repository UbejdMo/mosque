import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, authApi, type SessionUser } from './api';

/**
 * Session state comes from `/auth/me`, never from anything the client stored.
 * The server re-reads role and household on every request, so a revoked
 * account stops working immediately.
 */

interface AuthState {
  user: SessionUser | null;
  isLoading: boolean;
  login: (phone: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return (await authApi.me()).user;
      } catch (error) {
        // Not signed in is a normal state, not a failure to retry.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: ({ phone, pin }: { phone: string; pin: string }) => authApi.login(phone, pin),
    onSuccess: (result) => {
      queryClient.setQueryData(['session'], result.user);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      queryClient.setQueryData(['session'], null);
      // Nothing cached should outlive the session — another user may be next
      // at this phone, and household data must not leak between them.
      void queryClient.clear();
    },
  });

  const value = useMemo<AuthState>(
    () => ({
      user: session.data ?? null,
      isLoading: session.isLoading,
      login: async (phone, pin) => {
        await loginMutation.mutateAsync({ phone, pin });
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
    }),
    [session.data, session.isLoading, loginMutation, logoutMutation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
