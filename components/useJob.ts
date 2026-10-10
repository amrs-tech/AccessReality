'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api-client';
import type { Job } from './ui-contracts';

export const terminal = (job: Job) => ['complete', 'partial', 'cancelled'].includes(job.phase);

export function useJob({ csrfToken, onExpired }: { csrfToken?: string | null; onExpired: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const jobRef = useRef<Job | null>(null);
  const active = useRef(false);
  const pauseRequested = useRef(false);
  const mounted = useRef(true);
  const update = useCallback((next: Job) => { jobRef.current = next; if (mounted.current) setJob(next); }, []);
  const load = useCallback(async (id: string) => {
    const next = await api<Job>(`/api/jobs/${encodeURIComponent(id)}`); update(next); return next;
  }, [update]);
  const pause = useCallback((reason = 'Paused. Resume when you are ready; completed steps are saved.') => {
    pauseRequested.current = true; setPauseReason(reason);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const visibility = () => { if (document.hidden) pause('Paused while this tab is hidden. Return and choose Resume.'); };
    const offline = () => pause('Connection lost. Saved work remains available; reconnect and choose Resume.');
    document.addEventListener('visibilitychange', visibility); window.addEventListener('offline', offline);
    return () => { mounted.current = false; pauseRequested.current = true; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('offline', offline); };
  }, [pause]);
  const run = useCallback(async (initial?: Job) => {
    if (active.current || !csrfToken) return;
    let current = initial ?? jobRef.current;
    if (!current || terminal(current)) return;
    if (document.hidden || !navigator.onLine) { setPauseReason('Open this tab with an active connection, then choose Resume.'); return; }
    active.current = true; pauseRequested.current = false; setRunning(true); setError(null); setPauseReason(null);
    let conflicts = 0;
    let steps = 0;
    try {
      while (mounted.current && !pauseRequested.current && !terminal(current)) {
        if (steps >= 20) { setPauseReason('This run reached the client step limit. Its completed steps are saved; review the current brief before resuming.'); break; }
        if (document.hidden || !navigator.onLine) { pause('Paused. Open this tab with an active connection and choose Resume.'); break; }
        if (current.nextRetryAt && Date.parse(current.nextRetryAt) > Date.now()) { setPauseReason('The provider requested a wait. The permitted retry time is shown below; choose Resume after that time.'); break; }
        try {
          const next: Job = await api<Job>(`/api/jobs/${encodeURIComponent(current.id)}/step`, { method: 'POST', csrfToken, body: { expectedVersion: current.stateVersion } });
          current = next; update(next); conflicts = 0; steps += 1;
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 409) {
            current = await load(current.id); conflicts += 1;
            if (conflicts >= 3) { setPauseReason('Another step is finishing. Saved state is refreshed; choose Resume shortly.'); break; }
            await new Promise(resolve => window.setTimeout(resolve, 1200));
          } else throw cause;
        }
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'The investigation paused before the next step. You can resume saved work.');
    } finally { active.current = false; if (mounted.current) setRunning(false); }
  }, [csrfToken, load, onExpired, pause, update]);
  const cancel = useCallback(async () => {
    pauseRequested.current = true;
    if (!jobRef.current || !csrfToken) return;
    setError(null);
    try { update(await api<Job>(`/api/jobs/${encodeURIComponent(jobRef.current.id)}/cancel`, { method: 'POST', csrfToken, body: {} })); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401) onExpired(); setError(cause instanceof Error ? cause.message : 'Cancellation could not be saved.'); }
  }, [csrfToken, onExpired, update]);
  return { job, running, error, pauseReason, load, run, pause, cancel, update, setError };
}
