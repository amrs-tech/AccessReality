// Shared with the browser. Only public photo URLs observed in Maps responses
// belong here; this module deliberately has no server or credential imports.
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (!authority || /[:@\\]/.test(authority)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || !/^lh[1-6]\.googleusercontent\.com$/.test(url.hostname)
      || !/^\/(?:p|gps-cs-s|grass-cs)\/[A-Za-z0-9_=-]+$/.test(url.pathname)) return null;
    for (const key of url.searchParams.keys()) if (/key|token|secret|password|authorization|credential/i.test(key)) return null;
    return url.toString();
  } catch { return null; }
}
