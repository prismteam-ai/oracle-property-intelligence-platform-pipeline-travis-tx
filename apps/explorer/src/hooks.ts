import { useQuery } from '@tanstack/react-query';
import { useApi } from './api.js';
import { parseManifest } from './lib/manifest.js';

export function useMeta() {
  const api = useApi();
  return useQuery({ queryKey: ['meta'], queryFn: () => api.getMeta(), staleTime: 60_000 });
}

export function useRuns() {
  const api = useApi();
  return useQuery({ queryKey: ['runs'], queryFn: () => api.listRuns(), staleTime: 60_000 });
}

export function useManifest(runId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['manifest', runId],
    enabled: Boolean(runId),
    staleTime: Infinity,
    queryFn: async () => parseManifest(await api.getRunManifest(runId as string)),
  });
}
