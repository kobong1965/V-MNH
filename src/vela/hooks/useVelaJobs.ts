import { useCallback, useEffect, useState } from 'react';

import {
  cancelVelaJob,
  listVelaJobs,
  retryVelaJob,
  type VelaJob
} from '../services/jobService';

export function useVelaJobs() {
  const [jobs, setJobs] = useState<VelaJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listVelaJobs());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取任务');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const events = new EventSource('/api/vela/events');
    const handleJobUpdate = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { job?: VelaJob };
        if (!payload.job) return;
        setJobs((current) => {
          const existing = current.findIndex((job) => job.id === payload.job!.id);
          if (existing === -1) return [payload.job!, ...current];
          return current.map((job) => job.id === payload.job!.id ? payload.job! : job);
        });
      } catch {
        void refresh();
      }
    };
    events.addEventListener('job.updated', handleJobUpdate as EventListener);
    events.onerror = () => setError('任务事件连接已断开，正在自动重连');
    return () => events.close();
  }, [refresh]);

  const retry = useCallback(async (jobId: string) => {
    await retryVelaJob(jobId);
    await refresh();
  }, [refresh]);

  const cancel = useCallback(async (jobId: string) => {
    await cancelVelaJob(jobId);
    await refresh();
  }, [refresh]);

  return { jobs, error, refresh, retry, cancel };
}
