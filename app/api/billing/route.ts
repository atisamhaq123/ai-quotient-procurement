import Stripe from 'stripe';
import {admin,AppError,context,env,failure,origin} from '../../../lib/server';
import {readJSON} from '../../../lib/http';
import {isPlan,priceId} from '../../../lib/plans';
import {blockingStatuses,reconcile,stripe,type BillingOrganization} from '../../../lib/billing';
import {uuid} from '../../../lib/validation';

async function portalConfiguration(client:Stripe,appUrl:string){
 const prices=[priceId('starter'),priceId('pro')];
 if(prices.some(price=>!price)||prices[0]===prices[1])throw new AppError('Starter and Pro must use different configured Stripe prices.',503);
 const stripePrices=await Promise.all(prices.map(price=>client.prices.retrieve(price)));
 const products=stripePrices.map((price,index)=>({product:typeof price.product==='string'?price.product:price.product.id,prices:[prices[index]]}));
 const fingerprint=prices.join(':');
 const configurations=await client.billingPortal.configurations.list({active:true,limit:100});
 const existing=configurations.data.find(configuration=>configuration.metadata?.quotient_prices===fingerprint);
 if(existing)return existing.id;
 const configuration=await client.billingPortal.configurations.create({name:'Quotient plan management',default_return_url:`${appUrl}/app`,metadata:{quotient_prices:fingerprint},business_profile:{headline:'Manage your Quotient Procurement subscription'},features:{customer_update:{enabled:true,allowed_updates:['email','address']},invoice_history:{enabled:true},payment_method_update:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:true,default_allowed_updates:['price'],proration_behavior:'create_prorations',products,trial_update_behavior:'end_trial'}}},{idempotencyKey:`quotient-portal-${prices.join('-')}`});
 return configuration.id;
}

async function planSession(client:Stripe,organization:BillingOrganization,subscription:Stripe.Subscription,plan:'starter'|'pro',appUrl:string){
 const item=subscription.items.data[0],targetPrice=priceId(plan);
 if(!item||subscription.items.data.length!==1)throw new AppError('The Stripe subscription has an unexpected item configuration.',409);
 if(!targetPrice)throw new AppError(`${plan==='pro'?'Pro':'Starter'} billing is not configured.`,503);
 if(item.price.id===targetPrice)return {url:`${appUrl}/app?billing=synced&organization=${organization.id}`};
 const configuration=await portalConfiguration(client,appUrl),returnUrl=`${appUrl}/app?billing=switched&organization=${organization.id}`;
 return client.billingPortal.sessions.create({customer:organization.stripe_customer_id!,configuration,return_url:returnUrl,flow_data:{type:'subscription_update_confirm',subscription_update_confirm:{subscription:subscription.id,items:[{id:item.id,price:targetPrice,quantity:1}]},after_completion:{type:'redirect',redirect:{return_url:returnUrl}}}});
}

export async function POST(request:Request){try{
 origin(request);const body=await readJSON(request,1000);
 if(!uuid(body.organization))throw new AppError('Invalid organization.');
 const {user}=await context(body.organization,true),client=stripe();
 const {data,error}=await admin().from('organizations').select('id,name,stripe_customer_id,stripe_subscription_id,stripe_event_created').eq('id',body.organization).single();
 if(error||!data)throw new AppError('Organization unavailable.',404);
 const organization=data as BillingOrganization;
 if(!organization.stripe_customer_id){
  const customer=await client.customers.create({name:organization.name,email:user.email,metadata:{organization_id:organization.id}},{idempotencyKey:`quotient-customer-${organization.id}`});
  const result=await admin().rpc('set_stripe_customer',{org:organization.id,customer_id:customer.id});
  if(result.error)throw new AppError('Billing could not be initialized. Please retry.',503);
  organization.stripe_customer_id=result.data;
 }
 const appUrl=env('NEXT_PUBLIC_APP_URL');let preferred:string|undefined;
 if(body.action==='sync'&&typeof body.session==='string'){
  if(!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(body.session))throw new AppError('Invalid Checkout session.',400);
  const checkout=await client.checkout.sessions.retrieve(body.session);
  const checkoutCustomer=typeof checkout.customer==='string'?checkout.customer:checkout.customer?.id;
  if(checkout.mode!=='subscription'||checkoutCustomer!==organization.stripe_customer_id||(checkout.client_reference_id!==organization.id&&checkout.metadata?.organization_id!==organization.id))throw new AppError('The completed checkout does not match this organization.',409);
  preferred=typeof checkout.subscription==='string'?checkout.subscription:checkout.subscription?.id;
 }
 const subscription=await reconcile(client,organization,preferred);
 if(body.action==='sync')return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 if(body.action==='portal'){
  const configuration=await portalConfiguration(client,appUrl),returnUrl=`${appUrl}/app?billing=portal&organization=${organization.id}`;
  const session=await client.billingPortal.sessions.create({customer:organization.stripe_customer_id!,configuration,return_url:returnUrl});
  return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});
 }
 if(body.action!=='checkout'&&body.action!=='switch')throw new AppError('Unknown billing action.');
 if(!isPlan(body.plan))throw new AppError('Choose a valid billing plan.');
 if(subscription&&blockingStatuses.includes(subscription.status)){
  const session=await planSession(client,organization,subscription,body.plan,appUrl);
  return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});
 }
 if(subscription&&subscription.status!=='canceled'&&subscription.status!=='incomplete_expired')throw new AppError('Manage the existing Stripe subscription before starting another.',409);
 const price=priceId(body.plan);if(!price)throw new AppError(`${body.plan==='pro'?'Pro':'Starter'} billing is not configured.`,503);
 const open=await client.checkout.sessions.list({customer:organization.stripe_customer_id!,status:'open',limit:100});
 for(const old of open.data){if(old.metadata?.organization_id===organization.id){if(old.metadata.plan===body.plan&&old.url)return Response.json({url:old.url},{headers:{'Cache-Control':'no-store'}});await client.checkout.sessions.expire(old.id);}}
 const returnUrl=`${appUrl}/app?billing=success&organization=${organization.id}&session_id={CHECKOUT_SESSION_ID}`;
 const session=await client.checkout.sessions.create({mode:'subscription',customer:organization.stripe_customer_id!,line_items:[{price,quantity:1}],allow_promotion_codes:true,client_reference_id:organization.id,metadata:{organization_id:organization.id,plan:body.plan},subscription_data:{metadata:{organization_id:organization.id}},success_url:returnUrl,cancel_url:`${appUrl}/app?billing=cancelled&organization=${organization.id}`},{idempotencyKey:`quotient-checkout-${organization.id}-${crypto.randomUUID()}`});
 if(!session.url)throw new AppError('Stripe did not return a checkout link.',502);
 return Response.json({url:session.url},{headers:{'Cache-Control':'no-store'}});
}catch(error){return failure(error);}}
