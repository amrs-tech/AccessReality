import { assertConfiguration,run } from './shared';
import { preflight } from '../lib/server/preflight';
run(async()=>{assertConfiguration();const result=await preflight(process.argv.includes('--probe-llm'));console.log(JSON.stringify(result,null,2));});
