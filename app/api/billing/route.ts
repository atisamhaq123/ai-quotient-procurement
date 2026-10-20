import Stripe from 'stripe';
import {admin,AppError,context,env,failure,origin} from '../../../lib/server';
import {readJSON} from '../../../lib/http';
import {isPlan,priceId} from '../../../lib/plans';
import {uuid} from '../../../lib/validation';

function stripe(){return new Stripe(env('STRIPE_SECRET_KEY'),{maxNetworkRetries:2,timeout:15000});}

export async function POST(request:Request){try{
 origin(request);const body=await readJSON(request,1000);
 if(!uuid(body.organization))throw new AppError('Invalid organization.');
 const {user}=await context(body.organization,true),client=stripe();
 const {data:organization,error}=await admin().from('organizations').select('id,name,stripe_customer_id,stripe_subscription_id').eq('id',body.organization).single();
 if(error||!organization)throw new AppError('Organization unavailable.',404);
 let customer=organization.stripe_customer_id as string|null;
 if(!customer){
  const created=await client.customers.create({name:organization.name,email:user.email,metadata:{organization_id:organization.id}},{idempotencyKey:`organization-customer-${organization.id}`});
  const result=await admin().rpc('set_stripe_customer',{org:organization.id,customer_id:created.id});
  if(result.error)throw new AppError('Billing could not be initialized. Please retry.',503);
  customer=result.data;
 }
 const appUrl=env('NEXT_PUBLIC_APP_URL');
 if(body.action==='portal'){
  const session=await client.billingPortal.sessions.create({customer,return_url:`${appUrl}/app?billing=portal`});
  return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});
 }
 if(body.action==='checkout'){
  if(!isPlan(body.plan))throw new AppError('Choose a valid billing plan.');
  if(organization.stripe_subscription_id){const session=await client.billingPortal.sessions.create({customer,return_url:`${appUrl}/app?billing=portal`});return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});}
  const price=priceId(body.plan);if(!price)throw new AppError(`${body.plan==='pro'?'Pro':'Starter'} billing is not configured.`,503);
  const session=await client.checkout.sessions.create({mode:'subscription',customer,line_items:[{price,quantity:1}],allow_promotion_codes:true,client_reference_id:organization.id,metadata:{organization_id:organization.id,plan:body.plan},subscription_data:{metadata:{organization_id:organization.id}},success_url:`${appUrl}/app?billing=success`,cancel_url:`${appUrl}/app?billing=cancelled`});
  if(!session.url)throw new AppError('Stripe did not return a checkout link.',502);
  return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});
 }
 throw new AppError('Unknown billing action.');
 }catch(e){return failure(e);}}
