import {identity,context,origin,check,failure,AppError} from '../../../lib/server';
import {uuid,validatePurchase} from '../../../lib/validation';
import {readJSON} from '../../../lib/http';
import {PLANS,type PlanId} from '../../../lib/plans';

export async function GET(request:Request){try{
 const {client,user}=await identity();
 const organizations=check(await client.from('organizations').select('id,name,created_at,plan,subscription_status,trial_ends_at,billing_period_end,cancel_at_period_end,stripe_customer_id').order('created_at'))||[];
 const url=new URL(request.url),id=url.searchParams.get('organization')||organizations[0]?.id;
 if(!id)return Response.json({organizations:[],purchases:[],current:null,members:[],invitations:[],audit:[],dailyUsed:0,billing:null,user:{email:user.email,id:user.id}},{headers:{'Cache-Control':'private, no-store'}});
 if(!uuid(id)||!organizations.some(o=>o.id===id))throw new AppError('Organization unavailable. Select one of your organizations.',403);
 const access=await context(id),requested=url.searchParams.get('purchase');
 if(requested&&!uuid(requested))throw new AppError('Invalid purchase request.');
 const purchases=check(await client.from('purchases').select('id,organization_id,title,status,selected,version,updated_at').eq('organization_id',id).order('updated_at',{ascending:false}).limit(100))||[];
 const chosen=requested||purchases[0]?.id;
 const [purchaseResult,memberResult,invitationResult,auditResult,usageResult]=await Promise.all([
  chosen?client.from('purchases').select('*').eq('organization_id',id).eq('id',chosen).maybeSingle():Promise.resolve({data:null,error:null}),
  client.from('memberships').select('organization_id,user_id,email,role').eq('organization_id',id).order('created_at'),
  access.role==='owner'?client.from('invitations').select('id,email,expires_at,created_at').eq('organization_id',id).is('accepted_at',null).order('created_at',{ascending:false}).limit(30):Promise.resolve({data:[],error:null}),
  client.from('audit_events').select('id,actor_email,action,record_id,summary,created_at').eq('organization_id',id).order('created_at',{ascending:false}).limit(30),
  client.from('ai_jobs').select('id',{count:'exact',head:true}).eq('organization_id',id).neq('state','failed').gte('created_at',new Date(new Date().setUTCHours(0,0,0,0)).toISOString())
 ]);
 const current=check(purchaseResult);if(requested&&!current)throw new AppError('This purchase was removed or is no longer accessible. Refresh the request list.',404);
 check({data:null,error:usageResult.error});
 const selected=organizations.find(o=>o.id===id)!,plan=(selected.plan in PLANS?selected.plan:'starter') as PlanId,limits=PLANS[plan];
 const entitlementActive=selected.subscription_status==='active'||selected.subscription_status==='trialing'&&new Date(selected.billing_period_end||selected.trial_ends_at).getTime()>Date.now();
 const billing={plan,status:selected.subscription_status,trialEndsAt:selected.trial_ends_at,periodEnd:selected.billing_period_end,cancelAtPeriodEnd:selected.cancel_at_period_end,hasCustomer:!!selected.stripe_customer_id,active:entitlementActive,limits:{members:limits.members,purchases:limits.purchases,aiDaily:limits.aiDaily}};
 return Response.json({organizations:organizations.map(({plan:_,subscription_status:__,trial_ends_at:___,billing_period_end:____,cancel_at_period_end:_____,stripe_customer_id:______,...organization})=>organization),organization:id,purchases,current,members:check(memberResult),invitations:check(invitationResult),audit:check(auditResult),dailyUsed:usageResult.count||0,billing,user:{email:user.email,id:user.id}},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return failure(e);}}

export async function POST(request:Request){try{
 origin(request);const {client}=await identity();const body=await readJSON(request);
 if(body.action==='create-organization'){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)throw new AppError('Enter an organization name, up to 80 characters.');
  const id=check(await client.rpc('create_organization',{org_name:body.name.trim()}));return Response.json({id});
 }
 if(!uuid(body.organization))throw new AppError('Invalid organization.');
 const access=await context(body.organization);
 if(body.action==='save'){
  let data;try{data=validatePurchase(body.purchase);}catch(e){throw new AppError((e as Error).message);}
  if(!uuid(body.id)||!Number.isInteger(body.version)||body.version<0)throw new AppError('Invalid purchase version.');
  const purchase=check(await access.client.rpc('save_purchase',{org:body.organization,purchase_id:body.id,expected_version:body.version,purchase_title:data.title,quote_data:data.quotes,chosen:data.selected}).single());return Response.json({purchase});
 }
 if(body.action==='transition'){
  if(!uuid(body.id)||!Number.isInteger(body.version)||typeof body.status!=='string'||typeof body.note!=='string'||body.note.length>2000)throw new AppError('Invalid decision.');
  const purchase=check(await access.client.rpc('transition_purchase',{org:body.organization,purchase_id:body.id,expected_version:body.version,next_status:body.status,note:body.note}).single());return Response.json({purchase});
 }
 if(body.action==='delete'){
  if(!uuid(body.id)||!Number.isInteger(body.version)||body.version<1)throw new AppError('Invalid purchase.');
  check(await access.client.rpc('delete_purchase',{org:body.organization,purchase_id:body.id,expected_version:body.version}));return Response.json({ok:true});
 }
 if(body.action==='invite'){
  if(access.role!=='owner')throw new AppError('Only owners can invite team members.',403);
  if(typeof body.email!=='string'||body.email.length>254||!/^\S+@\S+\.\S+$/.test(body.email.trim()))throw new AppError('Enter a valid email address.');
  const token=crypto.randomUUID()+crypto.randomUUID();
  check(await access.client.rpc('create_invitation',{org:body.organization,invite_email:body.email.toLowerCase().trim(),invite_token:token}));return Response.json({url:new URL('/invite/'+token,process.env.NEXT_PUBLIC_APP_URL).href});
 }
 if(body.action==='revoke-invitation'){
  if(!uuid(body.invitation))throw new AppError('Invalid invitation.');
  check(await access.client.rpc('revoke_invitation',{org:body.organization,invitation_id:body.invitation}));return Response.json({ok:true});
 }
 if(body.action==='rename'){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)throw new AppError('Enter an organization name, up to 80 characters.');
  check(await access.client.rpc('rename_organization',{org:body.organization,new_name:body.name}));return Response.json({ok:true});
 }
 if(body.action==='leave'){
  check(await access.client.rpc('leave_organization',{org:body.organization}));return Response.json({ok:true});
 }
 if(body.action==='transfer-ownership'){
  if(!uuid(body.user))throw new AppError('Invalid team member.');
  check(await access.client.rpc('transfer_ownership',{org:body.organization,new_owner:body.user}));return Response.json({ok:true});
 }
 if(body.action==='remove-member'){
  if(!uuid(body.user))throw new AppError('Invalid team member.');
  check(await access.client.rpc('remove_member',{org:body.organization,member_user:body.user}));return Response.json({ok:true});
 }
 throw new AppError('Unknown action.');
 }catch(e){return failure(e);}}
