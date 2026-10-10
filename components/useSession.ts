'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Session } from './api-client';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { const next = await api<Session>('/api/session'); setSession(next); setError(null); return next; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Session access is unavailable.'); return null; }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const login = useCallback(async (accessCode: string) => {
    if (!session?.csrfToken) return false;
    setBusy(true); setError(null);
    try { const next = await api<Session>('/api/session', { method: 'POST', csrfToken: session.csrfToken, body: { accessCode } }); setSession(next); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Access could not be confirmed.'); return false; }
    finally { setBusy(false); }
  }, [session]);
  const expire = useCallback(() => {
    setSession(previous => previous ? { ...previous, authenticated: false } : previous);
    void refresh().then(() => setError('Your private session has expired. Enter the access code again to continue.'));
  }, [refresh]);
  const logout = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try { await api('/api/session', { method: 'DELETE', csrfToken: session.csrfToken }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign out failed.'); }
    finally { setBusy(false); }
  }, [session, refresh]);
  return { session, error, busy, login, expire, logout };
}
