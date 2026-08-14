import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface ImportPerson {
  firstName: string;
  fatherName: string;
  lastName: string;
  joinedYear: number;
  leftYear?: number | null;
  isHead?: boolean;
  livesAbroad?: boolean;
}

export interface ImportHousehold {
  neighbourhood?: string | null;
  phone?: string | null;
  notes?: string | null;
  needsReview?: boolean;
  persons: ImportPerson[];
  settledYears: number[];
}

interface ImportResult {
  householdIds: string[];
  personCount: number;
  settlementCount: number;
}

export function useImportHouseholds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (households: ImportHousehold[]) =>
      api.post<ImportResult>('/import/households', { households }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['households'] });
    },
  });
}

/** Existing neighbourhood spellings, so 500 entries stay consistent. */
export function useNeighbourhoods() {
  return useQuery({
    queryKey: ['neighbourhoods'],
    queryFn: async () =>
      (await api.get<{ neighbourhoods: string[] }>('/import/neighbourhoods')).neighbourhoods,
    staleTime: 60_000,
  });
}
