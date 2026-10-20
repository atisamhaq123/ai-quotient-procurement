import type {Quote} from './quotes';
import {total,validScale} from './quotes.ts';
export type PurchaseStatus='draft'|'review'|'approved'|'rejected'|'archived';
export type Purchase={id:string;organization_id:string;title:string;quotes:Quote[];selected:string;review:string;version:number;updated_at:string;status?:PurchaseStatus;decision_note?:string;approved_at?:string|null;approved_by?:string|null};
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function validatePurchase(data:unknown):{title:string;quotes:Quote[];selected:string}{
 const d=data as {title:string;quotes:Quote[];selected:string};
 const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
 const num=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
 if(!d||!text(d.title,120)||!d.title.trim()||!Array.isArray(d.quotes)||d.quotes.length>10||!text(d.selected,100))throw Error('Invalid purchase request.');
 for(const q of d.quotes){
  if(!q||!text(q.id,100)||!q.id||!text(q.supplier,100)||!q.supplier.trim()||!text(q.reference,100)||!['USD','EUR','GBP','PKR','AED','CAD','AUD'].includes(q.currency)||!num(q.days,3650)||!Number.isInteger(q.days)||!num(q.shipping,100000000)||!validScale(q.shipping,2)||!num(q.tax,100)||!validScale(q.tax,2)||!text(q.terms,4000)||!Array.isArray(q.items)||!q.items.length||q.items.length>200)throw Error('Invalid quotation. Use whole delivery days and monetary values with at most two decimal places.');
  if(q.items.some(i=>!i||!text(i.name,160)||!i.name.trim()||!num(i.qty,10000000)||i.qty===0||!validScale(i.qty,3)||!num(i.price,100000000)||!validScale(i.price,2))||new Set(q.items.map(i=>i.name.trim().toLowerCase())).size!==q.items.length)throw Error('Invalid or duplicate line items. Use up to three quantity decimals and two price decimals.');
  if(total(q)>1000000000000)throw Error('Quotation total exceeds the supported limit of 1 trillion.');
 }
 if(new Set(d.quotes.map(q=>q.id)).size!==d.quotes.length||d.selected&&!d.quotes.some(q=>q.id===d.selected))throw Error('Invalid supplier selection.');
 return {title:d.title.trim(),quotes:d.quotes,selected:d.selected};
}
