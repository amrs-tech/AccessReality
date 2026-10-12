import type { Venue,Source,EvidenceClaim,Requirements,Report,Phase } from '../contracts';
import type { NewsCheckResult } from '../news/contracts';
export interface JobState {
  venue:Venue|null; candidates:Venue[]; requirements:Requirements; sources:Source[]; claims:EvidenceClaim[]; report:Report|null;
  visitedActionKeys:string[]; extractedSourceIds:string[]; cacheHits:number; reviewsExamined:number; failedStages:string[];
  steps:number; activeMs:number; targetedActions:number; noNewEvidence:number; acceptedBeforeTarget:number;
  reviewRequests:number; webRequests:number; retryCounts:Record<string,number>;
  pendingAction:{id:string;feature:string;reason:string}|null; lastActionKey:string|null;
  extractionBatches:number; plannerMode:string|null;
  lastMessage?:string;
  validationRejections?:{reason:string;sourceId:string|null}[];
  failureStopReason?:string;
  optionalCheckLimits?:string[];
  newsResult?:NewsCheckResult|null;
  newsErrorCode?:string|null;
}
export interface JobRow {
  id:string; session_id:string;kind:'discovery'|'investigation'|'news_check';venue_id:string|null;input:any;state:JobState;
  phase:Phase|'discovery';state_version:number;serp_cap:number;serp_reserved:number;llm_cap:number;llm_reserved:number;
  serp_full_cap?:number;search_mode?:'expanded'|'conserve'|'legacy';step_cap?:number;
  next_retry_at:string|null;stop_reason:string|null;
}
export function initialState(requirements:Requirements=[],venue:Venue|null=null):JobState {
  return {venue,candidates:[],requirements,sources:[],claims:[],report:null,visitedActionKeys:[],extractedSourceIds:[],cacheHits:0,reviewsExamined:0,failedStages:[],steps:0,activeMs:0,targetedActions:0,noNewEvidence:0,acceptedBeforeTarget:0,reviewRequests:0,webRequests:0,retryCounts:{},pendingAction:null,lastActionKey:null,extractionBatches:0,plannerMode:null};
}
export const terminal=(phase:string)=>['complete','partial','cancelled'].includes(phase);
