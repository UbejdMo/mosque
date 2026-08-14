import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AllocationPreviewDto,
  HouseholdDetailDto,
  HouseholdSummaryDto,
  RecordPaymentResultDto,
} from '@mosque/shared';
import { api } from './api';

/**
 * Data access for the ledger screens. Thin on purpose: the shapes come from
 * `@mosque/shared`, so this file cannot quietly invent a field the API does
 * not return.
 */

export interface HouseholdListFilters {
  search?: string;
  neighbourhood?: string;
  minYearsUnpaid?: number;
}

function toQueryString(filters: HouseholdListFilters): string {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.neighbourhood) params.set('neighbourhood', filters.neighbourhood);
  if (filters.minYearsUnpaid) params.set('minYearsUnpaid', String(filters.minYearsUnpaid));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useHouseholds(filters: HouseholdListFilters) {
  return useQuery({
    queryKey: ['households', filters],
    queryFn: async () =>
      (await api.get<{ households: HouseholdSummaryDto[] }>(`/households${toQueryString(filters)}`))
        .households,
    // Keeps the previous list on screen while a new search runs, so the page
    // does not flash empty on every keystroke.
    placeholderData: (previous) => previous,
  });
}

export function useHousehold(householdId: string | undefined) {
  return useQuery({
    queryKey: ['household', householdId],
    queryFn: () => api.get<HouseholdDetailDto>(`/households/${householdId!}`),
    enabled: Boolean(householdId),
  });
}

export function useAllocationPreview(householdId: string, totalCents: number | null) {
  return useQuery({
    queryKey: ['allocation-preview', householdId, totalCents],
    queryFn: () =>
      api.post<AllocationPreviewDto>('/payments/preview', {
        householdId,
        totalCents: totalCents!,
      }),
    enabled: totalCents !== null && totalCents > 0,
  });
}

export interface RecordPaymentInput {
  householdId: string;
  totalCents: number;
  paidAt: string;
  receiptNumber: string;
  clientUuid: string;
  note?: string;
  allocations?: { year: number; amountCents: number }[];
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordPaymentInput) =>
      api.post<RecordPaymentResultDto>('/payments', input),
    onSuccess: (_result, input) => {
      // The balance moved, so anything showing it is stale.
      void queryClient.invalidateQueries({ queryKey: ['household', input.householdId] });
      void queryClient.invalidateQueries({ queryKey: ['households'] });
    },
  });
}
