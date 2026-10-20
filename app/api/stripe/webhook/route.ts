import Stripe from 'stripe';
import {admin,env,failure,AppError} from '../../../../lib/server';
import {planForPrice} from '../../../../lib/plans';

export const runtime='nodejs';

function timestamp(value:number|null|undefined){return value?new Date(value*1000).toISOString():null;}

export async function POST(request:Request){try{
 const signature=request.headers.get('stripe-signature');if(!signature)throw new AppError('Missing Stripe signature.',400);
 const stripe=new Stripe(env('STRIPE_SECRET_KEY'),{maxNetworkRetries:2,timeout:15000});
 let event:Stripe.Event;try{event=stripe.webhooks.constructEvent(await request.text(),signature,env('STRIPE_WEBHOOK_SECRET'));}catch{throw new AppError('Invalid Stripe signature.',400);}
 if(!['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type))return Response.json({received:true});
 const subscription=event.data.object as Stripe.Subscription;
 const organization=subscription.metadata.organization_id;
 const customer=typeof subscription.customer==='string'?subscription.customer:subscription.customer.id;
 const item=subscription.items.data[0],price=item?.price.id||'';
 const plan=planForPrice(price);
 if(!organization||!plan)throw new AppError('Subscription metadata or price is not recognized.',400);
 const periodEnd='current_period_end' in subscription?timestamp((subscription as Stripe.Subscription&{current_period_end?:number}).current_period_end):timestamp(item?.current_period_end);
 const result=await admin().rpc('apply_stripe_subscription',{event_id:event.id,event_created:event.created,org:organization,customer_id:customer,subscription_id:subscription.id,new_plan:plan,new_status:subscription.status,period_end:periodEnd,will_cancel:subscription.cancel_at_period_end});
 if(result.error)throw new AppError('Subscription update could not be stored.',503);
 return Response.json({received:true});
 }catch(e){return failure(e);}}
