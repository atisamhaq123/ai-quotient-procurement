'use client';
import {Check,CreditCard,Sparkles} from 'lucide-react';

type Billing={plan:'starter'|'pro';status:string;trialEndsAt:string;periodEnd:string|null;cancelAtPeriodEnd:boolean;hasCustomer:boolean;active:boolean;limits:{members:number;purchases:number;aiDaily:number}};
const offers={starter:{name:'Starter',summary:'For focused purchasing teams.',features:['3 members','50 purchase requests','10 AI reviews each day']},pro:{name:'Pro',summary:'For procurement operations at scale.',features:['20 members','500 purchase requests','50 AI reviews each day']}} as const;

export default function BillingPanel({billing,owner,busy,demo,onCheckout,onPortal}:{billing:Billing|null;owner:boolean;busy:boolean;demo:boolean;onCheckout:(plan:'starter'|'pro')=>void;onPortal:()=>void}){
 if(!billing)return null;
 const renewal=billing.periodEnd||billing.trialEndsAt;
 return <section className="billing-panel" aria-labelledby="billing-title"><div className="billing-heading"><div><p className="eyebrow">BILLING & ENTITLEMENTS</p><h2 id="billing-title">Choose the capacity your team needs.</h2></div><span className={`badge ${billing.active?'positive':'warning'}`}>{billing.active?<Check size={12}/>:<CreditCard size={12}/>} {billing.status.replace('_',' ')}</span></div>
 <div className="plan-grid">{(['starter','pro'] as const).map(id=>{const offer=offers[id],current=billing.plan===id;return <article className={`plan-card ${current?'current-plan':''}`} key={id}><div className="plan-title"><span className="plan-icon">{id==='pro'?<Sparkles size={18}/>:<CreditCard size={18}/>}</span><div><h3>{offer.name}</h3><p>{offer.summary}</p></div></div><ul>{offer.features.map(feature=><li key={feature}><Check size={14}/>{feature}</li>)}</ul>{current?<button className="secondary" disabled={!owner||busy||demo||!billing.hasCustomer} onClick={onPortal}>{billing.hasCustomer?'Manage billing':'Current trial'}</button>:<button className="primary" disabled={!owner||busy||demo} onClick={billing.hasCustomer?onPortal:()=>onCheckout(id)}>{billing.hasCustomer?'Change in portal':`Choose ${offer.name}`}</button>}</article>})}</div>
 <div className="billing-meta"><span>{billing.status==='trialing'?`Trial ends ${new Date(renewal).toLocaleDateString()}`:billing.cancelAtPeriodEnd?`Access ends ${new Date(renewal).toLocaleDateString()}`:billing.periodEnd?`Current period ends ${new Date(renewal).toLocaleDateString()}`:'Billing status is synchronized by Stripe.'}</span>{!owner&&<span>Only the organization owner can manage billing.</span>}</div></section>;
}
