import { it,expect,vi,beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { JobRow } from '../../lib/workflow/state';
import { initialState } from '../../lib/workflow/state';
import type { Venue } from '../../lib/contracts';
import { advanceJob } from '../../lib/workflow/runner';
import { ProviderError } from '../../lib/providers/errors';
import { normalizeDetails } from '../../lib/adapters/place';
import { makeSource } from '../../lib/evidence/normalize';
const mock = vi.hoisted(()=>({job:null as any,deny:false,down:false,calls:[] as string[],cacheReply:null as any,commits:[] as any[]}));
vi.mock('../../lib/server/db',()=>({db:vi.fn(),selectOne:vi.fn(async()=>mock.job),rpc:vi.fn(async(name:string,args:any)=>{
  mock.calls.push(name);if(mock.down)throw new Error('Database unavailable');
  if(name==='claim_step')return {ok:true,job:structuredClone(mock.job),lease_token:'test-lease'};
  if(name==='reserve_provider_attempt'){if(mock.deny)return {ok:false,code:'budget_exhausted'};if(mock.cacheReply)return {ok:true,kind:'cache',...mock.cacheReply};if(args.p_provider==='serpapi')mock.job.serp_reserved++;else mock.job.llm_reserved++;return {ok:true,kind:'reserved',attempt_id:randomUUID()};}
  if(name==='mark_dispatch')return {ok:true};
  if(name==='commit_step'||name==='fail_step'){mock.commits.push(args);mock.job={...mock.job,state:args.p_state,phase:args.p_uncertain?'partial':args.p_phase,state_version:mock.job.state_version+1,stop_reason:args.p_stop_reason||args.p_code||null};return {ok:true,job:structuredClone(mock.job)};}
  throw new Error(name);
})}));
const venue:Venue={id:'00000000-0000-4000-8000-000000000002',name:'Synthetic test venue',address:'Test street',googlePlaceId:'test-place-only',dataId:'test-review-only',dataCid:null,website:null,phone:null,category:null,sourceUrl:'https://example.test',latitude:null,longitude:null,rating:null,provisional:false};
beforeEach(()=>{
  Object.assign(process.env,{SERPAPI_API_KEY:'test-only',GEMINI_API_KEY:'test-only',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',DEMO_ACCESS_CODE:'test-code',ADMIN_API_SECRET:'a'.repeat(32),SESSION_HMAC_SECRET:'b'.repeat(32),RATE_LIMIT_HMAC_SECRET:'c'.repeat(32),APP_ORIGIN:'http://localhost:3000',SEARCH_ENABLED:'true'});
  mock.calls=[];mock.commits=[];mock.cacheReply=null;mock.deny=false;mock.down=false;mock.job={id:randomUUID(),session_id:'test-session',kind:'investigation',venue_id:venue.id,input:{},state:initialState([{feature:'entrance_step_free',priority:'must_have'}],venue),phase:'details',state_version:0,serp_cap:5,serp_reserved:0,llm_cap:6,llm_reserved:0,next_retry_at:null,stop_reason:null} satisfies JobRow;
});
const deps=()=>({client:{from:()=>{throw new Error('Empty corpus must not query source tables');}} as any,clock:()=>new Date('2026-10-10T10:00:00Z')});
it('budget denial causes zero actual provider dispatches',async()=>{
  mock.deny=true;const search=vi.fn();const result=await advanceJob('test-session',mock.job.id,0,{...deps(),search});expect(search).not.toHaveBeenCalled();expect(mock.calls).not.toContain('mark_dispatch');expect(result.state.failedStages).toContain('details:budget_exhausted');
});
it('DB unavailable causes zero actual provider dispatches',async()=>{
  mock.down=true;const search=vi.fn();await expect(advanceJob('test-session',mock.job.id,0,{...deps(),search})).rejects.toThrow();expect(search).not.toHaveBeenCalled();
});
it('an uncertain timeout stays consumed and terminal without automatic replay',async()=>{
  const search=vi.fn(async()=>{throw new ProviderError('timeout','synthetic timeout',false,true);});const result=await advanceJob('test-session',mock.job.id,0,{...deps(),search});expect(result.phase).toBe('partial');expect(result.serp_reserved).toBe(1);expect(search).toHaveBeenCalledTimes(1);expect(result.state.report?.overall).toBe('needs_confirmation');
});
it('full empty-evidence run makes one provider request per step and saves unknown brief',async()=>{
  const search=vi.fn(async(params:Record<string,string>)=>({payload:params.engine==='google_maps_reviews'?{reviews:[]}:{place_results:{title:venue.name,place_id:venue.googlePlaceId,data_id:venue.dataId}},providerSearchId:'test-search-id',retrievedAt:'2026-10-10T10:00:00Z',durationMs:1}));
  const plan=vi.fn(async(menu:any[])=>({action:menu.find(a=>a.id==='STOP'),reason:'Synthetic stop',plannerMode:'gemini' as const}));
  const extract=vi.fn();let result=mock.job;let steps=0;
  while(!['complete','partial'].includes(result.phase)&&steps++<20){const before=search.mock.calls.length+plan.mock.calls.length+extract.mock.calls.length;result=await advanceJob('test-session',result.id,result.state_version,{...deps(),search,plan,extract});expect(search.mock.calls.length+plan.mock.calls.length+extract.mock.calls.length-before).toBeLessThanOrEqual(1);}
  expect(result.phase).toBe('complete');expect(result.state.report?.overall).toBe('needs_confirmation');expect(result.state.report?.requirements[0].status).toBe('insufficient');expect(search).toHaveBeenCalledTimes(2);expect(extract).not.toHaveBeenCalled();expect(plan).toHaveBeenCalledTimes(1);
});
it('shared cached attribute sources preserve canonical ledger claim ids with zero dispatch',async()=>{
  const payload={place_results:{title:venue.name,place_id:venue.googlePlaceId,extensions:[{accessibility:['Wheelchair accessible entrance']}]}};
  const date='2026-10-10T10:00:00Z';const original=normalizeDetails(payload,venue,date,'synthetic-id');mock.cacheReply={payload,retrieved_at:date};
  const client={from:(table:string)=>{const result=table==='source_snapshots'?original.sources.map(s=>({id:s.id,source_group_key:s.sourceGroupKey,text_hash:s.metadata.textHash,retrieved_at:s.retrievedAt,metadata:{original:s}})):original.claims.map(c=>({extractor_version:c.extractorVersion,metadata:{original:c}}));const chain:any={select:()=>chain,eq:()=>chain,in:async()=>({data:result,error:null})};return chain;}} as any;
  const search=vi.fn();const result=await advanceJob('test-session',mock.job.id,0,{client,search});expect(search).not.toHaveBeenCalled();expect(result.serp_reserved).toBe(0);expect(result.state.cacheHits).toBe(1);expect(result.state.sources.map(s=>s.id)).toEqual(original.sources.map(s=>s.id));expect(result.state.claims.map(c=>c.id)).toEqual(original.claims.map(c=>c.id));
});
it('full provenance stays in immutable assessment revision while checkpoint remains bounded',async()=>{
  const original=normalizeDetails({place_results:{title:venue.name,place_id:venue.googlePlaceId,extensions:[{accessibility:['Wheelchair accessible entrance']}]}},venue,'2026-10-10T10:00:00Z','synthetic-id');
  mock.job.phase='assess';mock.job.state.sources=original.sources;mock.job.state.claims=original.claims;
  const result=await advanceJob('test-session',mock.job.id,0,deps());expect(result.state.report?.sources).toEqual([]);expect(mock.commits[0].p_report.report.sources).toEqual(original.sources);expect(mock.commits[0].p_report.report.claims).toEqual(original.claims);
});
it('ambiguous branch snippets stay in the ledger without model dispatch or extraction failure',async()=>{
  mock.job.phase='extract';
  const source=makeSource({venueId:venue.id,kind:'search_snippet',text:'The chain offers wheelchair accessible restrooms.',sourceUrl:'https://example.test/chain',providerReviewId:null,providerSearchId:'synthetic-search',engine:'google',retrievedAt:'2026-10-10T10:00:00Z',publishedAt:null,editedAt:null,observedAt:null,selectionMethod:'web_query',metadata:{venueMatch:'ambiguous',truncated:true}});
  mock.job.state.sources=[source];
  const extract=vi.fn();const result=await advanceJob('test-session',mock.job.id,0,{...deps(),extract});
  expect(extract).not.toHaveBeenCalled();expect(mock.calls).not.toContain('reserve_provider_attempt');
  expect(result.phase).toBe('assess');expect(result.state.sources).toEqual([source]);expect(result.state.failedStages).toEqual([]);
  const assessed=await advanceJob('test-session',mock.job.id,1,deps());
  expect(assessed.state.report?.overall).toBe('needs_confirmation');expect(assessed.state.report?.isPartial).toBe(false);expect(assessed.state.claims).toEqual([]);
});
