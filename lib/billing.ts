import 'server-only';
import Stripe from 'stripe';
import {admin,AppError,env} from './server';
import {planForPrice} from './plans';

export const blockingStatuses=['active','trialing','past_due','unpaid','paused','incomplete'];
export type BillingOrganization={id:string;name:string;stripe_customer_id:string|null;stripe_subscription_id:string|null;stripe_event_created:number};
export function stripe(){return new Stripe(env('STRIPE_SECRET_KEY'),{maxNetworkRetries:2,timeout:20000});}
function timestamp(value:number|null|undefined){return value?new Date(value*1000).toISOString():null;}

export async function reconcile(client:Stripe,organization:BillingOrganization,preferredSubscription?:string,event?:{id:string;created:number}){
 if(!organization.stripe_customer_id)return null;
 const subscriptions:Stripe.Subscription[]=[];
 for await(const subscription of client.subscriptions.list({customer:organization.stripe_customer_id,status:'all',limit:100}))subscriptions.push(subscription);
 const mapped=subscriptions.filter(subscription=>subscription.metadata.organization_id===organization.id);
 const blocking=mapped.filter(subscription=>blockingStatuses.includes(subscription.status));
 if(blocking.length>1&&blocking.some(subscription=>subscription.livemode))throw new AppError('Multiple active subscriptions need review in Stripe before billing can continue.',409);
 const subscription=blocking.find(candidate=>candidate.id===preferredSubscription)||blocking.find(candidate=>candidate.id===organization.stripe_subscription_id)||blocking[0]||mapped.find(candidate=>candidate.id===preferredSubscription)||mapped.find(candidate=>candidate.id===organization.stripe_subscription_id)||mapped.sort((a,b)=>b.created-a.created)[0];
 if(!subscription)return null;
 const item=subscription.items.data[0],plan=planForPrice(item?.price.id||'');
 const customer=typeof subscription.customer==='string'?subscription.customer:subscription.customer.id;
 if(subscription.items.data.length!==1||!item)throw new AppError('The Stripe subscription has an unexpected item configuration.',409);
 if(!plan)throw new AppError('The Stripe subscription uses a price that is not configured for Quotient.',409);
 if(customer!==organization.stripe_customer_id)throw new AppError('The Stripe customer does not match this organization.',409);
 const eventId=event?.id||`evt_${crypto.randomUUID().replaceAll('-','')}`;
 const eventCreated=event?.created||Math.max(Math.floor(Date.now()/1000),Number(organization.stripe_event_created||0)+1);
 const result=await admin().rpc('apply_stripe_subscription',{event_id:eventId,event_created:eventCreated,org:organization.id,customer_id:customer,subscription_id:subscription.id,new_plan:plan,new_status:subscription.status,period_end:timestamp(item.current_period_end),will_cancel:subscription.cancel_at_period_end});
 if(result.error)throw new AppError('Stripe billing could not be synchronized. Please retry.',503);
 organization.stripe_subscription_id=subscription.id;organization.stripe_event_created=eventCreated;
 return subscription;
}
