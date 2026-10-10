import 'server-only';
import { z } from 'zod';
export const envSchema = z.object({
  SERPAPI_API_KEY:z.string().min(1), GEMINI_API_KEY:z.string().min(1), GEMINI_MODEL:z.string().default('gemini-3.1-flash-lite'),
  SUPABASE_URL:z.url(), SUPABASE_SERVICE_ROLE_KEY:z.string().min(1), DEMO_ACCESS_CODE:z.string().min(8), ADMIN_API_SECRET:z.string().min(32),
  SESSION_HMAC_SECRET:z.string().min(32), RATE_LIMIT_HMAC_SECRET:z.string().min(32), APP_ORIGIN:z.url(),
  SEARCH_ENABLED:z.enum(['true','false']).default('false'),
  SERPAPI_PROTECTED_RESERVE:z.coerce.number().int().nonnegative().default(30),
  SERPAPI_OPERATIONAL_CAP:z.coerce.number().int().nonnegative().default(220),
  SERPAPI_DAILY_ATTEMPT_CAP:z.coerce.number().int().min(0).max(30).default(30),
  INVESTIGATION_SEARCH_CAP:z.coerce.number().int().min(0).max(5).default(5),
  INVESTIGATION_LLM_CAP:z.coerce.number().int().min(0).max(6).default(6),
  MAX_WORKFLOW_STEPS:z.coerce.number().int().min(1).max(20).default(20),
});
export type Env = z.infer<typeof envSchema>;
export function env(): Env {
  const parsed=envSchema.safeParse(process.env);
  if(!parsed.success) throw new Error('configuration_missing');
  const origin=new URL(parsed.data.APP_ORIGIN);
  if(origin.origin!==parsed.data.APP_ORIGIN || (process.env.NODE_ENV==='production' && origin.protocol!=='https:' && !['localhost','127.0.0.1'].includes(origin.hostname))) throw new Error('configuration_missing');
  return parsed.data;
}
export function configured(): boolean { return envSchema.safeParse(process.env).success; }
