'use client';

import { useEffect, useRef } from 'react';

export function ErrorSummary({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  if (!message) return null;
  return <div className="error-summary" role="alert" tabIndex={-1} ref={ref}><strong>This action could not finish</strong><p>{message}</p></div>;
}
