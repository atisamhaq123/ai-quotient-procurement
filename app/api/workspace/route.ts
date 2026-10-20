import {identity,context,origin,check,failure,AppError} from '../../../lib/server';
import {uuid,validatePurchase} from '../../../lib/validation';
export async function GET(request:Request){try{
 const {client,user}=await identity();const organizations=check(await client.from('organizations').select('*').order('created_at'));
 const id=new URL(request.url).searchParams.get('organization')||organizations?.[0]?.id;
 if(!id)return Response.json({organizations:[],purchases:[],members:[],user:{email:user.email,id:user.id}});
 await context(id);
 const purchases=check(await client.from('purchases').select('*').eq('organization_id',id).order('updated_at',{ascending:false}));
 const members=check(await client.from('memberships').select('*').eq('organization_id',id));
 const since=new Date();since.setUTCHours(0,0,0,0);const usage=await client.from('ai_jobs').select('id',{count:'exact',head:true}).eq('organization_id',id).neq('state','failed').gte('created_at',since.toISOString());if(usage.error)throw new AppError('Unable to retrieve AI allowance.');
 return Response.json({organizations,organization:id,purchases,members,dailyUsed:usage.count||0,user:{email:user.email,id:user.id}},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return failure(e);}}
export async function POST(request:Request){try{
 origin(request);const {client}=await identity();const raw=await request.text();if(raw.length>250000)throw new AppError('Request is too large.',413);const body=JSON.parse(raw);
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
 if(body.action==='delete'){
  if(!uuid(body.id)||!Number.isInteger(body.version))throw new AppError('Invalid purchase.');
  check(await access.client.rpc('delete_purchase',{org:body.organization,purchase_id:body.id,expected_version:body.version}));return Response.json({ok:true});
 }
 if(body.action==='invite'){
  if(access.role!=='owner')throw new AppError('Only owners can invite team members.',403);
  if(typeof body.email!=='string'||body.email.length>254||!/^\S+@\S+\.\S+$/.test(body.email))throw new AppError('Enter a valid email address.');
  const token=crypto.randomUUID()+crypto.randomUUID();
  check(await access.client.rpc('create_invitation',{org:body.organization,invite_email:body.email.toLowerCase().trim(),invite_token:token}));return Response.json({url:new URL('/invite/'+token,process.env.NEXT_PUBLIC_APP_URL).href});
 }
 if(body.action==='remove-member'){
  if(!uuid(body.user))throw new AppError('Invalid team member.');
  check(await access.client.rpc('remove_member',{org:body.organization,member_user:body.user}));return Response.json({ok:true});
 }
 throw new AppError('Unknown action.');
 }catch(e){return failure(e);}}
