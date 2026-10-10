import { assertConfiguration,run } from './shared';
import { rpc } from '../lib/server/db';
import { requireRpc } from '../lib/server/jobs';
run(async()=>{assertConfiguration();const result=requireRpc(await rpc('retention_cleanup',{p_dry_run:!process.argv.includes('--delete')}));console.log(JSON.stringify(result,null,2));});
