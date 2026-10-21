import Stripe from 'stripe';
import {createHash} from 'node:crypto';
import {admin,AppError,context,env,failure,origin} from '../../../lib/server';
import {readJSON} from '../../../lib/http';
import {isPlan,planForPrice,priceId} from '../../../lib/plans';
import {uuid} from '../../../lib/validation';

function stripe(){return new Stripe(env('STRIPE_SECRET_KEY'),{maxNetworkRetries:2,timeout:15000});}
function timestamp(value:number|null|undefined){return value?new Date(value*1000).toISOString():null;}

async function applySubscription(subscription:Stripe.Subscription,organization:{id:string},customer:string,source:string){
 const subscriptionCustomer=typeof subscription.customer==='string'?subscription.customer:subscription.customer.id;
 const item=subscription.items.data[0],plan=planForPrice(item?.price.id||'');
 if(subscriptionCustomer!==customer||subscription.metadata.organization_id!==organization.id||!item||!plan)throw new AppError('The Stripe subscription does not match this organization or plan.',409);
 const eventCreated=Math.floor(Date.now()/1000),eventId=`evt_${createHash('sha256').update(`${source}:${subscription.id}:${subscription.status}:${item.price.id}:${item.current_period_end}`).digest('hex')}`;
 const result=await admin().rpc('apply_stripe_subscription',{event_id:eventId,event_created:eventCreated,org:organization.id,customer_id:customer,subscription_id:subscription.id,new_plan:plan,new_status:subscription.status,period_end:timestamp(item.current_period_end),will_cancel:subscription.cancel_at_period_end});
 if(result.error)throw new AppError('Your payment succeeded, but the plan could not be synchronized. Please retry.',503);
}

async function portalConfiguration(client:Stripe,appUrl:string){
 const plans=(['starter','pro'] as const).map(plan=>({plan,price:priceId(plan)}));
 if(plans.some(entry=>!entry.price))throw new AppError('Starter and Pro billing must both be configured before plans can be switched.',503);
 const prices=await Promise.all(plans.map(entry=>client.prices.retrieve(entry.price!)));
 const products=prices.map((price,index)=>({product:typeof price.product==='string'?price.product:price.product.id,prices:[plans[index].price!]}));
 const configurations=await client.billingPortal.configurations.list({active:true,limit:100});
 const existing=configurations.data.find(configuration=>configuration.metadata?.quotient_plans==='v1');
 if(existing)return existing.id;
 const configuration=await client.billingPortal.configurations.create({name:'Quotient plan management',default_return_url:`${appUrl}/app?billing=portal`,metadata:{quotient_plans:'v1'},business_profile:{headline:'Manage your Quotient Procurement subscription'},features:{customer_update:{enabled:true,allowed_updates:['email','address']},invoice_history:{enabled:true},payment_method_update:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:true,default_allowed_updates:['price'],proration_behavior:'create_prorations',products,trial_update_behavior:'end_trial'}}},{idempotencyKey:`quotient-plan-portal-${plans.map(entry=>entry.price).join('-')}`});
 return configuration.id;
}

async function switchSession(client:Stripe,organization:{id:string;stripe_subscription_id:string|null},customer:string,plan:'starter'|'pro',appUrl:string){
 if(!organization.stripe_subscription_id)throw new AppError('This organization does not have a paid subscription to switch.',409);
 const subscription=await client.subscriptions.retrieve(organization.stripe_subscription_id);
 const subscriptionCustomer=typeof subscription.customer==='string'?subscription.customer:subscription.customer.id;
 if(subscriptionCustomer!==customer||subscription.metadata.organization_id!==organization.id)throw new AppError('The Stripe subscription does not match this organization.',409);
 const item=subscription.items.data[0];
 if(!item||subscription.items.data.length!==1)throw new AppError('This subscription cannot be switched automatically. Open billing management for assistance.',409);
 const targetPrice=priceId(plan);
 if(!targetPrice)throw new AppError(`${plan==='pro'?'Pro':'Starter'} billing is not configured.`,503);
 if(item.price.id===targetPrice){await applySubscription(subscription,organization,customer,'switch-reconciliation');return {url:`${appUrl}/app?billing=synced&organization=${organization.id}`};}
 const configuration=await portalConfiguration(client,appUrl);
 return client.billingPortal.sessions.create({customer,configuration,return_url:`${appUrl}/app?billing=portal`,flow_data:{type:'subscription_update_confirm',subscription_update_confirm:{subscription:subscription.id,items:[{id:item.id,price:targetPrice,quantity:1}]},after_completion:{type:'redirect',redirect:{return_url:`${appUrl}/app?billing=switched`}}}});
}

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
 if(body.action==='sync'){
  let subscription:Stripe.Subscription,source='portal-return';
  if(typeof body.session==='string'&&/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(body.session)){
   const checkout=await client.checkout.sessions.retrieve(body.session,{expand:['subscription']});
   const checkoutCustomer=typeof checkout.customer==='string'?checkout.customer:checkout.customer?.id;
   if(checkout.mode!=='subscription'||checkoutCustomer!==customer||(checkout.client_reference_id!==organization.id&&checkout.metadata?.organization_id!==organization.id))throw new AppError('The completed checkout does not match this organization.',409);
   if(!checkout.subscription)throw new AppError('Stripe is still preparing the subscription. Refresh in a moment.',409);
   subscription=typeof checkout.subscription==='string'?await client.subscriptions.retrieve(checkout.subscription):checkout.subscription;
   source=checkout.id;
  }else if(organization.stripe_subscription_id){
   subscription=await client.subscriptions.retrieve(organization.stripe_subscription_id);
  }else{
   const subscriptions=await client.subscriptions.list({customer,status:'all',limit:20});
   const match=subscriptions.data.find(candidate=>candidate.metadata.organization_id===organization.id&&!['canceled','incomplete_expired'].includes(candidate.status));
   if(!match)throw new AppError('No subscription is available to synchronize.',409);
   subscription=match;
  }
  await applySubscription(subscription,organization,customer,source);
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }
 if(body.action==='portal'){
  const configuration=await portalConfiguration(client,appUrl);
  const session=await client.billingPortal.sessions.create({customer,configuration,return_url:`${appUrl}/app?billing=portal`});
  return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});
 }
 if(body.action==='switch'){
  if(!isPlan(body.plan))throw new AppError('Choose a valid billing plan.');
  const session=await switchSession(client,organization,customer,body.plan,appUrl);
  return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});
 }
 if(body.action==='checkout'){
  if(!isPlan(body.plan))throw new AppError('Choose a valid billing plan.');
  if(organization.stripe_subscription_id){const session=await switchSession(client,organization,customer,body.plan,appUrl);return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});}
  const price=priceId(body.plan);if(!price)throw new AppError(`${body.plan==='pro'?'Pro':'Starter'} billing is not configured.`,503);
  const subscriptions=await client.subscriptions.list({customer,status:'all',limit:20});
  const existing=subscriptions.data.find(candidate=>candidate.metadata.organization_id===organization.id&&!['canceled','incomplete_expired'].includes(candidate.status));
  if(existing){
   await applySubscription(existing,organization,customer,'checkout-recovery');
   if(existing.items.data[0]?.price.id===price)return Response.json({url:`${appUrl}/app?billing=synced&organization=${organization.id}`},{headers:{'Cache-Control':'no-store'}});
   const switchToRequested=await switchSession(client,{...organization,stripe_subscription_id:existing.id},customer,body.plan,appUrl);
   return Response.json({url:switchToRequested.url},{headers:{'Cache-Control':'no-store'}});
  }
  const session=await client.checkout.sessions.create({mode:'subscription',customer,line_items:[{price,quantity:1}],allow_promotion_codes:true,client_reference_id:organization.id,metadata:{organization_id:organization.id,plan:body.plan},subscription_data:{metadata:{organization_id:organization.id}},success_url:`${appUrl}/app?billing=success&organization=${organization.id}&session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${appUrl}/app?billing=cancelled&organization=${organization.id}`});
  if(!session.url)throw new AppError('Stripe did not return a checkout link.',502);
  return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});
 }
 throw new AppError('Unknown billing action.');
 }catch(e){return failure(e);}}
