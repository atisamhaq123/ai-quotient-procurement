export const PLANS={
 starter:{name:'Starter',priceEnv:'STRIPE_STARTER_PRICE_ID',members:3,purchases:50,aiDaily:10,features:['3 workspace members','50 active purchase requests','10 AI reviews per day','Approvals and audit history']},
 pro:{name:'Pro',priceEnv:'STRIPE_PRO_PRICE_ID',members:20,purchases:500,aiDaily:50,features:['20 workspace members','500 active purchase requests','50 AI reviews per day','Priority procurement workflows']}
} as const;
export type PlanId=keyof typeof PLANS;
export function isPlan(value:unknown):value is PlanId{return value==='starter'||value==='pro';}
export function priceId(plan:PlanId){return process.env[PLANS[plan].priceEnv]||'';}
export function planForPrice(price:string){return (Object.keys(PLANS) as PlanId[]).find(plan=>priceId(plan)===price);}
