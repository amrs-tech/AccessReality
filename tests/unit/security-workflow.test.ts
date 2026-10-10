import { describe,it,expect,vi,beforeEach } from 'vitest';
import { checkCsrf,csrfToken,sameOrigin } from '../../lib/server/csrf';
import { body } from '../../lib/server/http';
import { discoveryInputSchema,requirementsSchema } from '../../lib/contracts';
import { hash,stable } from '../../lib/server/crypto';
import { initialState } from '../../lib/workflow/state';
import { cacheKey } from '../../lib/workflow/cache';
const fakeSelect=vi.hoisted(()=>vi.fn());
vi.mock('../../lib/server/db',()=>({selectOne:fakeSelect,db:vi.fn(),rpc:vi.fn()}));
import { ownedJob } from '../../lib/server/jobs';
beforeEach(()=>{
  Object.assign(process.env,{SERPAPI_API_KEY:'unit-not-real',GEMINI_API_KEY:'unit-not-real',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'unit-not-real',DEMO_ACCESS_CODE:'unit-test-access-code',ADMIN_API_SECRET:'a'.repeat(32),SESSION_HMAC_SECRET:'b'.repeat(32),RATE_LIMIT_HMAC_SECRET:'c'.repeat(32),APP_ORIGIN:'http://localhost:3000'});fakeSelect.mockReset();
});
describe('server privacy and request boundaries',()=>{
  it('CSRF requires the exact configured origin and token bound to session',()=>{
    const request=new Request('http://localhost:3000/api/x',{method:'POST',headers:{origin:'http://localhost:3000','x-csrf-token':csrfToken('session-a')}});
    expect(()=>checkCsrf(request,'session-a')).not.toThrow();expect(()=>checkCsrf(request,'session-b')).toThrow('forbidden');
  });
  it('cross-origin and missing-origin mutations fail closed',()=>{
    for(const origin of ['https://evil.example','http://localhost:3001',''])expect(()=>sameOrigin(new Request('http://localhost:3000/api/x',{headers:{origin}}))).toThrow('forbidden');
  });
  it('client engines, keys, URLs and budget overrides are rejected',()=>{
    const input={query:'cafe',city:'Bengaluru',country:'India',idempotencyKey:'a'.repeat(20)};
    for(const name of ['engine','api_key','budget','url','_allocation'])expect(discoveryInputSchema.safeParse({...input,[name]:'bad'}).success).toBe(false);
  });
  it('streams enforce the 16KB body limit without relying on content-length',async()=>{
    const request=new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'x'.repeat(17000)})});
    await expect(body(request,discoveryInputSchema)).rejects.toMatchObject({status:413});
  });
  it('ownership query includes session id and returns 404 for another session',async()=>{
    fakeSelect.mockResolvedValue(null);const id='00000000-0000-4000-8000-000000000001';await expect(ownedJob('other-session',id)).rejects.toMatchObject({code:'not_found',status:404});expect(fakeSelect).toHaveBeenCalledWith('jobs',{id,session_id:'other-session'});
  });
  it('malformed ids fail before touching the database',async()=>{await expect(ownedJob('session','x')).rejects.toMatchObject({status:404});expect(fakeSelect).not.toHaveBeenCalled();});
  it('opaque session material is hashed; stable request hashes preserve idempotency',()=>{expect(hash('token')).not.toContain('token');expect(stable({b:2,a:1})).toBe(stable({a:1,b:2}));});
  it('same discovery and case-sensitive query/cache filters preserve stable distinct identities',()=>{
    expect(cacheKey({engine:'google',q:'A  B',hl:'en'})).toBe(cacheKey({hl:'en',q:'A B',engine:'google'}));expect(cacheKey({engine:'google',q:'AB'})).not.toBe(cacheKey({engine:'google',q:'ab'}));expect(cacheKey({engine:'google_maps_reviews',query:'wheelchair'})).not.toBe(cacheKey({engine:'google_maps_reviews',query:'restroom'}));
  });
  it('requirements have explicit known features and no duplicate lift shortcuts',()=>{expect(requirementsSchema.safeParse([{feature:'lift_access',priority:'must_have'}]).success).toBe(false);expect(requirementsSchema.safeParse([{feature:'lift_present',priority:'must_have'},{feature:'lift_operational',priority:'must_have'}]).success).toBe(true);});
  it('fresh jobs contain zero evidence and attempts',()=>{const state=initialState();expect(state.sources).toEqual([]);expect(state.claims).toEqual([]);expect(state.report).toBeNull();expect(state.cacheHits).toBe(0);});
});
