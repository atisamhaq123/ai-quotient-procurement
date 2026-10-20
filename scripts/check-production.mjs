import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
const failures=[],warnings=[];
const requireValue=name=>{const value=process.env[name]?.trim();if(!value||/YOUR_|YOUR-|^<|^placeholder/i.test(value)){failures.push(name+' is missing or still a placeholder.');return '';}return value;};
const app=requireValue('NEXT_PUBLIC_APP_URL'),url=requireValue('NEXT_PUBLIC_SUPABASE_URL'),anon=requireValue('NEXT_PUBLIC_SUPABASE_ANON_KEY'),service=requireValue('SUPABASE_SERVICE_ROLE_KEY');
requireValue('OPENAI_API_KEY');requireValue('OPENAI_CHAT_MODEL');requireValue('STRIPE_SECRET_KEY');requireValue('STRIPE_WEBHOOK_SECRET');requireValue('STRIPE_STARTER_PRICE_ID');requireValue('STRIPE_PRO_PRICE_ID');
try{const parsed=new URL(app);if(parsed.protocol!=='https:')warnings.push('The app URL uses HTTP. Public production deployment must use HTTPS.');if(parsed.pathname!=='/'||parsed.search||parsed.hash)failures.push('The app URL must be an origin without a path, query, or fragment.');}catch{failures.push('The app URL is invalid.');}
if(anon&&anon===service)failures.push('Public and privileged Supabase keys must be different.');
if(url&&anon&&service){
 async function get(path,key){return fetch(url+path,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});}
 try{
  const response=await get('/auth/v1/settings',anon),settings=await response.json();
  if(!response.ok)failures.push('Supabase authentication is not reachable with the public key.');
  if(!settings.external?.email)failures.push('Email/password authentication is disabled.');
  if(settings.mailer_autoconfirm)failures.push('Email confirmation is disabled.');
  const schema=await get('/rest/v1/purchases?select=id,status,decision_note,approved_at&limit=0',service);if(!schema.ok)failures.push('Purchase workflow schema is unavailable. Fresh projects: run supabase/migrations/001_setup.sql. Existing projects: apply missing upgrades from supabase/legacy-migrations/.');
  const audit=await get('/rest/v1/audit_events?select=id&limit=0',service);if(!audit.ok)failures.push('Audit history is unavailable. Fresh projects: run supabase/migrations/001_setup.sql. Existing projects: apply missing upgrades from supabase/legacy-migrations/.');
  const version=await get('/rest/v1/schema_versions?select=version&version=eq.4',service);if(!version.ok||(await version.json()).length!==1)failures.push('Schema version 4 is unavailable. Fresh projects: run 001_setup.sql once. Existing projects: apply only missing legacy upgrades.');
  const billing=await get('/rest/v1/organizations?select=id,plan,subscription_status&limit=0',service);if(!billing.ok)failures.push('Billing entitlements are unavailable. Apply the Stripe billing schema upgrade.');
  const anonymous=await get('/rest/v1/purchases?select=id&limit=1',anon);if(![401,403].includes(anonymous.status))failures.push('Anonymous database access did not return the expected permission denial. Inspect grants and RLS.');
  const spec=await get('/rest/v1/',service);if(spec.ok){const definition=await spec.json();for(const name of ['transition_purchase','revoke_invitation','transfer_ownership','save_purchase','reserve_ai'])if(!definition.paths?.['/rpc/'+name])failures.push('Required database function is unavailable: '+name);}
 }catch{failures.push('A Supabase network request failed or timed out. Retry the readiness check.');}
}
warnings.push('Verify confirmation/recovery email delivery, production redirect URLs, SMTP delivery limits, backups with a restore test, hosting logs/alerts, and privacy/support documentation before public launch.');
async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())await scan(path);else if(/\.(js|map)$/.test(entry.name)){const content=await readFile(path,'utf8');for(const name of ['OPENAI_API_KEY','SUPABASE_SERVICE_ROLE_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']){const secret=process.env[name];if(secret&&secret.length>12&&content.includes(secret))failures.push('A privileged credential was found in the browser bundle: '+name);}}}}
try{await scan('.next/static');}catch{warnings.push('Build the app before checking browser bundles for leaked credentials.');}
const report={status:failures.length?'blocked':warnings.length?'configuration-verified-with-launch-checks':'passed',failures,warnings,paidBillingEnabled:true};await mkdir('artifacts',{recursive:true});await writeFile('artifacts/production-readiness.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
process.exitCode=failures.length?1:0;
