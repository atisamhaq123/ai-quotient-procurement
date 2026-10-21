import type Stripe from 'stripe';
import {admin,env,failure,AppError} from '../../../../lib/server';
import {reconcile,stripe,type BillingOrganization} from '../../../../lib/billing';

export const runtime='nodejs';

export async function POST(request:Request){try{
 const client=stripe();let event:Stripe.Event;
 try{event=client.webhooks.constructEvent(await request.text(),request.headers.get('stripe-signature')||'',env('STRIPE_WEBHOOK_SECRET'));}catch{return Response.json({error:'Invalid Stripe signature.'},{status:400});}
 if(!['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed'].includes(event.type))return Response.json({received:true});
 const object=event.data.object as unknown as {customer?:string|{id:string}};
 const customer=typeof object.customer==='string'?object.customer:object.customer?.id;
 if(!customer)throw new AppError('Stripe event has no customer.',400);
 const {data,error}=await admin().from('organizations').select('id,name,stripe_customer_id,stripe_subscription_id,stripe_event_created').eq('stripe_customer_id',customer).maybeSingle();
 if(error||!data)throw new AppError('Stripe customer is not mapped to an organization.',409);
 await reconcile(client,data as BillingOrganization,undefined,{id:event.id,created:event.created});
 return Response.json({received:true});
}catch(error){return failure(error instanceof AppError?error:new AppError('Billing synchronization failed. Retry this event.',500));}}
