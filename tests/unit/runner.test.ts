import { it,expect,vi,beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { JobRow } from '../../lib/workflow/state';
import { initialState } from '../../lib/workflow/state';
import { FEATURES,type Venue,type EvidenceImage } from '../../lib/contracts';
import { advanceJob,buildReport,eligibleMenu } from '../../lib/workflow/runner';
import { ProviderError } from '../../lib/providers/errors';
import { normalizeDetails } from '../../lib/adapters/place';
import { makeSource } from '../../lib/evidence/normalize';
const mock = vi.hoisted(()=>({job:null as any,deny:false,markDenial:null as string|null,down:false,calls:[] as string[],cacheReply:null as any,savedCache:null as any,commits:[] as any[]}));
vi.mock('../../lib/server/db',()=>({db:vi.fn(),selectOne:vi.fn(async(table:string)=>table==='provider_cache'?mock.savedCache:mock.job),rpc:vi.fn(async(name:string,args:any)=>{
  mock.calls.push(name);if(mock.down)throw new Error('Database unavailable');
  if(name==='claim_step')return {ok:true,job:structuredClone(mock.job),lease_token:'test-lease'};
  if(name==='reserve_provider_attempt'){if(mock.deny)return {ok:false,code:'budget_exhausted'};if(mock.cacheReply)return {ok:true,kind:'cache',...mock.cacheReply};if(args.p_provider==='serpapi')mock.job.serp_reserved++;else mock.job.llm_reserved++;return {ok:true,kind:'reserved',attempt_id:randomUUID()};}
  if(name==='mark_dispatch')return mock.markDenial?{ok:false,code:mock.markDenial}:{ok:true};
  if(name==='commit_step'||name==='fail_step'){mock.commits.push(args);mock.job={...mock.job,state:args.p_state,phase:args.p_uncertain?'partial':args.p_phase,state_version:mock.job.state_version+1,stop_reason:args.p_stop_reason||args.p_code||null};return {ok:true,job:structuredClone(mock.job)};}
  throw new Error(name);
})}));
const venue:Venue={id:'00000000-0000-4000-8000-000000000002',name:'Synthetic test venue',address:'Test street',googlePlaceId:'test-place-only',dataId:'test-review-only',dataCid:null,website:null,phone:null,category:null,sourceUrl:'https://example.test',latitude:null,longitude:null,rating:null,provisional:false};
beforeEach(()=>{
  Object.assign(process.env,{SERPAPI_API_KEY:'test-only',GEMINI_API_KEY:'test-only',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',DEMO_ACCESS_CODE:'test-code',ADMIN_API_SECRET:'a'.repeat(32),SESSION_HMAC_SECRET:'b'.repeat(32),RATE_LIMIT_HMAC_SECRET:'c'.repeat(32),APP_ORIGIN:'http://localhost:3000',SEARCH_ENABLED:'true'});
  mock.calls=[];mock.commits=[];mock.cacheReply=null;mock.savedCache=null;mock.deny=false;mock.markDenial=null;mock.down=false;mock.job={id:randomUUID(),session_id:'test-session',kind:'investigation',venue_id:venue.id,input:{},state:initialState([{feature:'entrance_step_free',priority:'must_have'}],venue),phase:'details',state_version:0,serp_cap:5,serp_reserved:0,llm_cap:6,llm_reserved:0,next_retry_at:null,stop_reason:null} satisfies JobRow;
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
it('a normal search cap saves a complete unknown brief without more provider calls',async()=>{
  mock.job.phase='assess';mock.job.serp_reserved=5;
  const search=vi.fn(),extract=vi.fn(),plan=vi.fn();
  const assessed=await advanceJob('test-session',mock.job.id,0,{...deps(),search,extract,plan});
  expect(assessed.phase).toBe('finalize');expect(assessed.stop_reason).toBe('search_budget_exhausted');
  const finished=await advanceJob('test-session',mock.job.id,1,{...deps(),search,extract,plan});
  expect(finished.phase).toBe('complete');expect(finished.state.report?.overall).toBe('needs_confirmation');expect(finished.state.report?.isPartial).toBe(false);
  expect(search).not.toHaveBeenCalled();expect(extract).not.toHaveBeenCalled();expect(plan).not.toHaveBeenCalled();expect(finished.serp_reserved).toBe(5);
});
it('a search cap preserves an independently incomplete extraction as partial',async()=>{
  mock.job.phase='assess';mock.job.serp_reserved=5;mock.job.state.failedStages=['extraction_validation_rejected'];
  await advanceJob('test-session',mock.job.id,0,deps());
  const finished=await advanceJob('test-session',mock.job.id,1,deps());
  expect(finished.phase).toBe('partial');expect(finished.state.report?.overall).toBe('needs_confirmation');expect(finished.state.failedStages).toContain('extraction_validation_rejected');
  expect(mock.calls).not.toContain('reserve_provider_attempt');
});
it('expanded evidence checks cover every must-have despite empty results and an early planner STOP',async()=>{
  Object.assign(mock.job,{serp_cap:26,serp_full_cap:26,llm_cap:56,step_cap:128,search_mode:'expanded'});
  mock.job.state.requirements=[{feature:'entrance_step_free',priority:'must_have'},{feature:'interior_movement',priority:'must_have'},{feature:'accessible_restroom',priority:'must_have'}];
  const search=vi.fn(async(params:Record<string,string>)=>({payload:params.engine==='google_maps_reviews'?{reviews:[]}:params.engine==='google'?{organic_results:[]}:{place_results:{title:venue.name,place_id:venue.googlePlaceId,data_id:venue.dataId}},providerSearchId:'synthetic-only',retrievedAt:'2026-10-10T10:00:00Z',durationMs:1}));
  const plan=vi.fn(async(menu:any[])=>({action:menu.find(a=>a.id==='STOP'),reason:'Synthetic early stop',plannerMode:'gemini' as const}));
  let result=mock.job;let steps=0;
  while(!['complete','partial'].includes(result.phase)&&steps++<128){const before=search.mock.calls.length+plan.mock.calls.length;result=await advanceJob('test-session',result.id,result.state_version,{...deps(),search,plan});expect(search.mock.calls.length+plan.mock.calls.length-before).toBeLessThanOrEqual(1);}
  expect(result.phase).toBe('complete');expect(result.serp_reserved).toBe(8);expect(result.state.noNewEvidence).toBeGreaterThanOrEqual(2);
  for(const feature of ['entrance_step_free','interior_movement','accessible_restroom']){
    expect(result.state.visitedActionKeys).toContain(`SEARCH_REVIEWS_FEATURE:${feature}`);
    expect(result.state.visitedActionKeys).toContain(`SEARCH_WEB_FEATURE:${feature}:general`);
  }
  expect(result.state.report?.overall).toBe('needs_confirmation');expect(result.state.report?.isPartial).toBe(false);
});
it('expanded actions give untouched requirements a turn before repeating another feature',()=>{
  Object.assign(mock.job,{search_mode:'expanded',serp_cap:26,llm_cap:56});
  mock.job.state.requirements=[{feature:'entrance_step_free',priority:'must_have'},{feature:'accessible_restroom',priority:'must_have'}];
  mock.job.state.report=buildReport(mock.job,new Date('2026-10-10T10:00:00Z'));
  mock.job.state.visitedActionKeys=['SEARCH_REVIEWS_FEATURE:entrance_step_free'];
  const menu=eligibleMenu(mock.job);expect(menu.length).toBeGreaterThan(0);expect(menu.every(a=>a.feature==='accessible_restroom')).toBe(true);
  expect(menu.some(a=>a.id.endsWith(':venue_domain'))).toBe(false);
  const cacheCandidates=eligibleMenu(mock.job,true);expect(cacheCandidates.some(a=>a.feature==='entrance_step_free')).toBe(true);
  mock.job.search_mode='conserve';mock.job.serp_full_cap=26;mock.job.state.reviewRequests=8;mock.job.state.webRequests=8;
  expect(eligibleMenu(mock.job,true).some(a=>a.feature==='entrance_step_free')).toBe(true);
});
it('all eight unresolved features have a finite 26-search run within the enlarged step budget',async()=>{
  Object.assign(mock.job,{serp_cap:26,serp_full_cap:26,llm_cap:56,step_cap:128,search_mode:'expanded'});
  mock.job.state.requirements=FEATURES.map(feature=>({feature,priority:'must_have'}));
  const search=vi.fn(async(params:Record<string,string>)=>({payload:params.engine==='google_maps_reviews'?{reviews:[]}:params.engine==='google'?{organic_results:[]}:{place_results:{title:venue.name,place_id:venue.googlePlaceId,data_id:venue.dataId,website:'https://synthetic.example'}},providerSearchId:'synthetic-only',retrievedAt:'2026-10-10T10:00:00Z',durationMs:1}));
  const plan=vi.fn(async(menu:any[])=>({action:menu[0],reason:'Synthetic permitted action',plannerMode:'gemini' as const}));
  let result=mock.job;let steps=0;
  while(!['complete','partial'].includes(result.phase)&&steps++<128)result=await advanceJob('test-session',result.id,result.state_version,{...deps(),search,plan});
  expect(result.phase).toBe('complete');expect(search).toHaveBeenCalledTimes(26);expect(result.state.steps).toBeLessThan(128);
  expect(result.state.visitedActionKeys.filter((id:string)=>id.startsWith('SEARCH_'))).toHaveLength(24);
  expect(result.state.report?.overall).toBe('needs_confirmation');expect(result.state.report?.isPartial).toBe(false);
});
it('an unexpired cache at the search cap runs without a search or planner dispatch',async()=>{
  mock.job.phase='assess';mock.job.serp_reserved=5;mock.job.state.reviewRequests=2;
  mock.savedCache={sanitized_payload:{organic_results:[]},expires_at:'2026-10-11T10:00:00Z'};
  mock.cacheReply={payload:{organic_results:[]},retrieved_at:'2026-10-10T10:00:00Z'};
  const search=vi.fn(),plan=vi.fn();
  let result=await advanceJob('test-session',mock.job.id,0,{...deps(),search,plan});expect(result.phase).toBe('plan');
  result=await advanceJob('test-session',result.id,result.state_version,{...deps(),search,plan});expect(result.phase).toBe('targeted_search');
  result=await advanceJob('test-session',result.id,result.state_version,{...deps(),search,plan});
  expect(result.phase).toBe('extract');expect(result.state.cacheHits).toBe(1);expect(result.serp_reserved).toBe(5);
  expect(search).not.toHaveBeenCalled();expect(plan).not.toHaveBeenCalled();
});
it('a denied optional search saves complete unknown evidence without fabricating a failed stage',async()=>{
  mock.job.phase='targeted_search';mock.job.state.pendingAction={id:'SEARCH_REVIEWS_FEATURE:entrance_step_free',feature:'entrance_step_free',reason:'Synthetic follow-up'};mock.deny=true;
  const search=vi.fn();let result=await advanceJob('test-session',mock.job.id,0,{...deps(),search});
  expect(result.phase).toBe('finalize');expect(result.state.failedStages).toEqual([]);expect(result.state.report?.isPartial).toBe(false);
  result=await advanceJob('test-session',result.id,result.state_version,{...deps(),search});
  expect(result.phase).toBe('complete');expect(result.stop_reason).toBe('search_budget_exhausted');expect(search).not.toHaveBeenCalled();
});
it('an optional reservation released at the dispatch credit check preserves a complete evidence report',async()=>{
  mock.job.phase='targeted_search';mock.job.state.pendingAction={id:'SEARCH_REVIEWS_FEATURE:entrance_step_free',feature:'entrance_step_free',reason:'Synthetic follow-up'};mock.markDenial='budget_exhausted';
  const search=vi.fn();let result=await advanceJob('test-session',mock.job.id,0,{...deps(),search});
  expect(mock.calls).toContain('reserve_provider_attempt');expect(mock.calls).toContain('mark_dispatch');
  expect(mock.commits[0].p_attempt_id).toBeTruthy();expect(mock.commits[0].p_uncertain).toBe(false);
  expect(result.state.pendingAction).toBeNull();expect(result.state.failedStages).toEqual([]);expect(result.state.report?.isPartial).toBe(false);expect(search).not.toHaveBeenCalled();
  result=await advanceJob('test-session',result.id,result.state_version,{...deps(),search});
  expect(result.phase).toBe('complete');expect(result.stop_reason).toBe('search_budget_exhausted');expect(result.state.report?.overall).toBe('needs_confirmation');
});
it('a released optional reservation from the search kill switch stays an incomplete run',async()=>{
  mock.job.phase='targeted_search';mock.job.state.pendingAction={id:'SEARCH_REVIEWS_FEATURE:entrance_step_free',feature:'entrance_step_free',reason:'Synthetic follow-up'};mock.markDenial='search_disabled';
  const search=vi.fn();const result=await advanceJob('test-session',mock.job.id,0,{...deps(),search});
  expect(mock.commits[0].p_uncertain).toBe(false);expect(result.state.failedStages).toContain('targeted_search:search_disabled');expect(result.state.report?.isPartial).toBe(true);expect(search).not.toHaveBeenCalled();
});
it('a baseline dispatch budget denial remains incomplete because a required check was not performed',async()=>{
  mock.markDenial='budget_exhausted';const search=vi.fn();const result=await advanceJob('test-session',mock.job.id,0,{...deps(),search});
  expect(mock.commits[0].p_uncertain).toBe(false);expect(result.state.failedStages).toContain('details:budget_exhausted');expect(result.state.report?.isPartial).toBe(true);expect(search).not.toHaveBeenCalled();
});
it('an actually dispatched optional timeout remains consumed, ambiguous and partial',async()=>{
  mock.job.phase='targeted_search';mock.job.state.pendingAction={id:'SEARCH_REVIEWS_FEATURE:entrance_step_free',feature:'entrance_step_free',reason:'Synthetic follow-up'};
  const search=vi.fn(async()=>{throw new ProviderError('timeout','Synthetic dispatched timeout',false,true);});
  const result=await advanceJob('test-session',mock.job.id,0,{...deps(),search});
  expect(search).toHaveBeenCalledTimes(1);expect(result.phase).toBe('partial');expect(result.serp_reserved).toBe(1);expect(mock.commits[0].p_uncertain).toBe(true);expect(result.state.report?.isPartial).toBe(true);
});
it('the last permitted step commits the report directly without requiring another lease',async()=>{
  Object.assign(mock.job,{phase:'assess',step_cap:128,serp_full_cap:26,search_mode:'expanded'});mock.job.state.steps=127;
  const result=await advanceJob('test-session',mock.job.id,0,deps());
  expect(result.phase).toBe('complete');expect(result.stop_reason).toBe('time_limit');expect(mock.commits[0].p_report.report.overall).toBe('needs_confirmation');
  expect(mock.calls).not.toContain('reserve_provider_attempt');
});
it('a workflow limit with unprocessed exact sources commits a truthful partial report',async()=>{
  mock.job.phase='extract';mock.job.state.steps=19;
  mock.job.state.sources=[makeSource({venueId:venue.id,kind:'maps_review',text:'The entrance has stairs.',sourceUrl:null,providerReviewId:'synthetic-review',providerSearchId:'synthetic-only',engine:'google_maps_reviews',retrievedAt:'2026-10-10T10:00:00Z',publishedAt:null,editedAt:null,observedAt:null,selectionMethod:'newest',metadata:{venueMatch:'exact'}})];
  const extract=vi.fn();const result=await advanceJob('test-session',mock.job.id,0,{...deps(),extract});
  expect(result.phase).toBe('partial');expect(result.state.failedStages).toContain('unprocessed_sources_workflow_limit');expect(mock.commits[0].p_report.report.isPartial).toBe(true);expect(extract).not.toHaveBeenCalled();
});
it('credit refresh finishes before the transactional step lease is claimed',async()=>{
  mock.job.phase='finalize';const refreshCredits=vi.fn(async()=>{expect(mock.calls).toEqual([]);});
  await advanceJob('test-session',mock.job.id,0,{...deps(),refreshCredits});expect(refreshCredits).toHaveBeenCalledTimes(1);expect(mock.calls[0]).toBe('claim_step');
});
it('a delayed credit refresh never marks an undispatched search as an ambiguous provider request',async()=>{
  let elapsed=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>elapsed);const search=vi.fn();
  try {
    await advanceJob('test-session',mock.job.id,0,{...deps(),search,refreshCredits:async()=>{elapsed=19000;}});
    expect(mock.calls).not.toContain('mark_dispatch');expect(search).not.toHaveBeenCalled();expect(mock.commits[0].p_uncertain).toBe(false);
  } finally {clock.mockRestore();}
});
it('an expanded corpus keeps its larger bound after credit conservation activates',async()=>{
  Object.assign(mock.job,{search_mode:'conserve',serp_cap:5,serp_full_cap:26,llm_cap:56,step_cap:128});
  mock.job.state.sources=Array.from({length:64},(_,n)=>makeSource({venueId:venue.id,kind:'maps_review',text:`Synthetic source ${n}.`,sourceUrl:null,providerReviewId:`synthetic-${n}`,providerSearchId:'synthetic-only',engine:'google_maps_reviews',retrievedAt:'2026-10-10T10:00:00Z',publishedAt:null,editedAt:null,observedAt:null,selectionMethod:'newest',metadata:{venueMatch:'exact'}}));
  const client={from:()=>{const chain:any={select:()=>chain,eq:()=>chain,in:async()=>({data:[],error:null})};return chain;}} as any;
  const search=vi.fn(async()=>({payload:{place_results:{title:venue.name,place_id:venue.googlePlaceId,extensions:[{accessibility:['Wheelchair accessible entrance']}]}},providerSearchId:'synthetic-only',retrievedAt:'2026-10-10T10:00:00Z',durationMs:1}));
  const result=await advanceJob('test-session',mock.job.id,0,{client,search});
  expect(result.state.sources).toHaveLength(65);expect(result.state.failedStages).not.toContain('corpus_limit');expect(result.state.claims).toHaveLength(1);
});

const testPhoto=(n:number):EvidenceImage=>({id:`synthetic-photo-${n}`,url:`https://lh3.googleusercontent.com/p/synthetic-${n}=w300`,sourceUrl:'https://www.google.com/maps',providerSearchId:'synthetic-search',retrievedAt:'2026-10-10T10:00:00Z',capturedAt:null,jsonPointer:`/reviews/${n}/images/0`,attribution:'Google Maps review photo'});
it('photo-only reviews remain supplementary and consume no Gemini extraction request',async()=>{
  mock.job.phase='extract';mock.job.state.sources=[makeSource({venueId:venue.id,kind:'maps_review',text:'',images:[testPhoto(1)],sourceUrl:'https://www.google.com/maps',providerReviewId:'synthetic-photo-review',providerSearchId:'synthetic-search',engine:'google_maps_reviews',retrievedAt:'2026-10-10T10:00:00Z',publishedAt:null,editedAt:null,observedAt:null,selectionMethod:'newest',metadata:{venueMatch:'exact'}})];
  const extract=vi.fn();const result=await advanceJob('test-session',mock.job.id,0,{...deps(),extract});
  expect(extract).not.toHaveBeenCalled();expect(mock.calls).not.toContain('reserve_provider_attempt');expect(result.phase).toBe('assess');
  expect(result.state.sources[0].images).toHaveLength(1);expect(result.state.claims).toEqual([]);expect(buildReport(result,new Date('2026-10-10T10:00:00Z')).overall).toBe('needs_confirmation');
});
it('supplementary photo bounds preserve text evidence and never change assessment eligibility',async()=>{
  mock.job.phase='finalize';mock.job.state.venue={...venue,images:Array.from({length:4},(_,n)=>({...testPhoto(n),attribution:'Google Maps listing' as const}))};
  mock.job.state.sources=Array.from({length:20},(_,n)=>makeSource({venueId:venue.id,kind:'maps_review',text:`Synthetic irrelevant public text ${n}.`,images:[testPhoto(n*2+4),testPhoto(n*2+5)],sourceUrl:null,providerReviewId:`synthetic-${n}`,providerSearchId:'synthetic-search',engine:'google_maps_reviews',retrievedAt:'2026-10-10T10:00:00Z',publishedAt:null,editedAt:null,observedAt:null,selectionMethod:'newest',metadata:{venueMatch:'exact'}}));
  const before=mock.job.state.sources.map((source:any)=>source.text);const result=await advanceJob('test-session',mock.job.id,0,deps());
  expect((result.state.venue?.images?.length||0)+result.state.sources.reduce((n:number,source:any)=>n+(source.images?.length||0),0)).toBe(24);
  const savedReport=mock.commits[0].p_report.report;
  expect(savedReport.venue.images.length+savedReport.sources.reduce((n:number,source:any)=>n+(source.images?.length||0),0)).toBe(24);
  expect(result.state.sources.map((source:any)=>source.text)).toEqual(before);expect(result.state.claims).toEqual([]);expect(result.state.failedStages).toEqual([]);expect(result.state.report?.overall).toBe('needs_confirmation');
});
it('checkpoint pressure drops supplementary photos before removing text sources',async()=>{
  mock.job.phase='finalize';mock.job.state.syntheticCheckpointPadding='x'.repeat(440000);
  mock.job.state.sources=Array.from({length:12},(_,n)=>makeSource({venueId:venue.id,kind:'maps_review',text:`Synthetic preserved review ${n}.`,images:[{...testPhoto(n*2),url:`https://lh3.googleusercontent.com/p/${'x'.repeat(1800)}${n*2}=w300`},{...testPhoto(n*2+1),url:`https://lh3.googleusercontent.com/p/${'x'.repeat(1800)}${n*2+1}=w300`}],sourceUrl:null,providerReviewId:`synthetic-${n}`,providerSearchId:'synthetic-search',engine:'google_maps_reviews',retrievedAt:'2026-10-10T10:00:00Z',publishedAt:null,editedAt:null,observedAt:null,selectionMethod:'newest',metadata:{venueMatch:'exact'}}));
  const before=mock.job.state.sources.map((source:any)=>({id:source.id,text:source.text}));
  const result=await advanceJob('test-session',mock.job.id,0,deps());
  expect(Buffer.byteLength(JSON.stringify(result.state),'utf8')).toBeLessThanOrEqual(500000);
  expect(result.state.sources.map((source:any)=>({id:source.id,text:source.text}))).toEqual(before);
  expect(result.state.sources.reduce((n:number,source:any)=>n+(source.images?.length||0),0)).toBeLessThan(24);
  expect(result.state.failedStages).toEqual([]);expect(result.phase).toBe('complete');
});
