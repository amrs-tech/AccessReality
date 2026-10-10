import { json } from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(){return json({app:'AccessReality',status:'ok',commit:process.env.APP_COMMIT_SHA||null});}
