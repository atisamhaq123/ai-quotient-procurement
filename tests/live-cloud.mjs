import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {samples} from '../lib/quotes.ts';

const base=process.env.TEST_URL||'http://localhost:3200',url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anon||!key)throw Error('Load the configured Supabase environment before running live QA.');
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,options)=>fetch(input,{...options,signal:AbortSignal.timeout(20000)})}});
const users=[],contexts=[],runId=randomUUID(),password='QA!'+randomUUID()+randomUUID().slice(0,20),cleanupErrors=[],checks=[];
let browser;
const requireOK=(result,label)=>{if(result.error)throw Error(label+': '+result.error.message);return result.data;};
async function createUser(label){const email=`quotient-qa-${runId}-${label}@example.com`;const data=requireOK(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Temporary Quotient QA'}}),'Create temporary QA account');users.push(data.user.id);return {email,id:data.user.id};}
async function post(page,body){const res=await page.request.post(base+'/api/workspace',{headers:{Origin:base},data:body});const data=await res.json();assert.equal(res.status(),200,data.error||'Workspace API request failed.');return data;}
async function session(user){const context=await browser.newContext();contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(25000);await page.goto(base+'/login');await page.getByLabel('Email address',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/\/app(?:\?|$)/);await page.getByRole('button',{name:'Create organization',exact:true}).waitFor();return page;}
try{
 const alice=await createUser('a'),bob=await createUser('b');
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const a=await session(alice),b=await session(bob);checks.push('real email/password login and cookie sessions');
 await a.getByRole('button',{name:'Create organization',exact:true}).click();await a.getByLabel('Organization name',{exact:true}).fill('QA workspace '+runId.slice(0,8));await a.getByRole('button',{name:'Create',exact:true}).click();await a.getByRole('dialog').waitFor({state:'hidden'});await a.getByRole('button',{name:'New request',exact:true}).waitFor();
 let state=await (await a.request.get(base+'/api/workspace')).json();const org=state.organization;assert.ok(org);checks.push('organization onboarding');
 const otherOrg=(await post(b,{action:'create-organization',name:'QA isolated '+runId.slice(0,8)})).id;
 const forbidden=await b.request.get(base+'/api/workspace?organization='+org);assert.equal(forbidden.status(),403,'other organization is forbidden');checks.push('cross-tenant API denial');
 const purchaseId=randomUUID();await post(a,{action:'save',organization:org,id:purchaseId,version:0,purchase:{title:'QA supplier comparison',quotes:samples,selected:'north'}});
 const direct=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});requireOK(await direct.auth.signInWithPassword({email:bob.email,password}),'Sign in isolated RLS QA account');const hidden=requireOK(await direct.from('purchases').select('id').eq('id',purchaseId),'Read RLS boundary');assert.deepEqual(hidden,[],'RLS hides another tenant record');checks.push('live database RLS isolation');
 const invite=await post(a,{action:'invite',organization:org,email:bob.email});const token=new URL(invite.url).pathname.split('/').pop();const acceptance=await b.request.post(base+'/api/invitations',{headers:{Origin:base},data:{token}});assert.equal(acceptance.status(),200);checks.push('email-bound invitation acceptance');
 const member=await b.request.get(base+'/api/workspace?organization='+org+'&purchase='+purchaseId);assert.equal(member.status(),200);state=await member.json();assert.equal(state.current.quotes.length,3,'saved quotes are returned by the current-purchase API');checks.push('saved request retrieval and real RPC response shape');
 await post(b,{action:'transition',organization:org,id:purchaseId,version:1,status:'review',note:'Please approve.'});
 const denied=await b.request.post(base+'/api/workspace',{headers:{Origin:base},data:{action:'transition',organization:org,id:purchaseId,version:2,status:'approved',note:'Attempted member approval'}});assert.equal(denied.status(),403);
 await post(a,{action:'transition',organization:org,id:purchaseId,version:2,status:'approved',note:'Approved in temporary QA.'});
 const locked=await a.request.post(base+'/api/workspace',{headers:{Origin:base},data:{action:'save',organization:org,id:purchaseId,version:3,purchase:{title:'Should not overwrite approval',quotes:samples,selected:'north'}}});assert.equal(locked.status(),409);checks.push('owner-only approval and approved-record lock');
 await post(a,{action:'transition',organization:org,id:purchaseId,version:3,status:'draft',note:'Reopen for QA.'});
 await a.goto(base+'/app?organization='+org+'&purchase='+purchaseId);await a.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('button',{name:'Quote comparison',exact:true}).click();await a.getByRole('button',{name:'Northline Supply',exact:true}).waitFor();
 await a.screenshot({path:'artifacts/live-workspace.png',fullPage:true});
 if(process.env.QUOTIENT_LIVE_AI_CHECK==='1'){
  const review=await a.request.post(base+'/api/review',{headers:{Origin:base},data:{organization:org,purchase:purchaseId,version:4},timeout:65000});const body=await review.json();assert.equal(review.status(),200,body.error||'Live AI review failed');assert.ok(body.review.length>40);checks.push('live OpenAI review and tenant-scoped persistence');
 }
 await post(a,{action:'remove-member',organization:org,user:bob.id});assert.equal((await b.request.get(base+'/api/workspace?organization='+org)).status(),403);checks.push('immediate membership revocation');
 state=await (await a.request.get(base+'/api/workspace?organization='+org)).json();assert.ok(state.audit.some(e=>e.action==='purchase.approved'));assert.ok(state.audit.some(e=>e.action==='member.removed'));checks.push('live tenant audit trail');
 checks.push('independent second organization: '+Boolean(otherOrg));
}finally{
 for(const context of contexts)await context.close().catch(()=>{});
 if(browser)await browser.close();
 // Restrict all cleanup to accounts generated by this run; no existing account is queried or modified.
 for(const id of users){for(let attempt=0;attempt<3;attempt++){try{
  const organizations=requireOK(await admin.from('organizations').select('id').eq('created_by',id),'Find temporary organizations');
  for(const org of organizations){requireOK(await admin.from('purchases').delete().eq('organization_id',org.id),'Remove QA purchases');requireOK(await admin.from('memberships').delete().eq('organization_id',org.id),'Remove QA memberships');requireOK(await admin.from('organizations').delete().eq('id',org.id),'Remove QA organization');}
  requireOK(await admin.auth.admin.deleteUser(id),'Delete temporary QA account');break;
 }catch{if(attempt===2)cleanupErrors.push(id);}}}
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/live-cloud-results.json',JSON.stringify({runId,checks,temporaryAccountsRemoved:cleanupErrors.length===0,cleanupRequiredForUserIds:cleanupErrors,emailDeliveryTested:false},null,2));
 if(cleanupErrors.length)console.error('Temporary QA cleanup needs attention. See artifacts/live-cloud-results.json.');
}
assert.deepEqual(cleanupErrors,[],'temporary QA accounts must be removed');
console.log(JSON.stringify({status:'passed',checks,temporaryAccountsRemoved:true,emailDeliveryTested:false},null,2));
