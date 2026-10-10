/** Generate only missing local application secrets; never invent provider credentials. */
import { readFile,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

async function main() {
  let content:string;
  try {content=await readFile('.env.local','utf8');}
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    content=await readFile('.env.example','utf8');
  }
  const values=parse(content);
  const generated:string[]=[];
  for(const name of ['DEMO_ACCESS_CODE','ADMIN_API_SECRET','SESSION_HMAC_SECRET','RATE_LIMIT_HMAC_SECRET']) {
    if(values[name])continue;
    const value=randomBytes(name==='DEMO_ACCESS_CODE'?12:32).toString('base64url');
    const expression=new RegExp(`^${name}=.*$`,'m');
    content=expression.test(content)?content.replace(expression,`${name}=${value}`):`${content.trimEnd()}\n${name}=${value}\n`;
    generated.push(name);
  }
  if(!values.APP_ORIGIN) {
    content=content.replace(/^APP_ORIGIN=.*$/m,'APP_ORIGIN=http://localhost:3000');
    if(!/^APP_ORIGIN=/m.test(content))content+='\nAPP_ORIGIN=http://localhost:3000\n';
  }
  if(generated.length||!values.APP_ORIGIN)await writeFile('.env.local',content,{mode:0o600});
  console.log(JSON.stringify({generated,providerCredentialsChanged:false,message:'Local secrets remain in ignored .env.local. Read DEMO_ACCESS_CODE there to sign in; secret values are never printed.'}));
}
main().catch(()=>{console.error('Local setup failed. Check workspace file permissions. No secret details printed.');process.exitCode=1;});
