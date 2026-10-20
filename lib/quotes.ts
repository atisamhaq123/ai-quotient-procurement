import Decimal from 'decimal.js';
import Papa from 'papaparse';
export type Quote={id:string;supplier:string;reference:string;currency:string;days:number;shipping:number;tax:number;terms:string;items:{name:string;qty:number;price:number}[]};
const cents=(value:Decimal)=>value.toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
export const lineTotal=(item:Quote['items'][number])=>cents(new Decimal(item.qty||0).times(item.price||0)).toNumber();
export function breakdown(q:Quote){const subtotal=q.items.reduce((sum,item)=>sum.plus(lineTotal(item)),new Decimal(0));const tax=cents(subtotal.times(q.tax||0).div(100));return {subtotal:subtotal.toNumber(),tax:tax.toNumber(),total:cents(subtotal.plus(tax).plus(q.shipping||0)).toNumber()};}
export const total=(q:Quote)=>breakdown(q).total;
export function validScale(value:number,places:number){return Number.isFinite(value)&&new Decimal(value).decimalPlaces()<=places;}
export function parseCSV(text:string){
 if(new TextEncoder().encode(text).length>1000000)throw Error('CSV must be under 1 MB.');
 const result=Papa.parse<string[]>(text,{skipEmptyLines:'greedy'});
 if(result.errors.length)throw Error('CSV is malformed. Check quotation marks and delimiters.');
 const [rawHeader,...rows]=result.data;const header=rawHeader?.map(v=>v.trim().replace(/^\uFEFF/,'').toLowerCase())||[];
 const cols=['item','quantity','unit_price'].map(name=>header.indexOf(name));
 if(cols.includes(-1)||new Set(header).size!==header.length)throw Error('Use unique CSV columns: item, quantity, unit_price.');
 if(!rows.length||rows.length>200)throw Error('Include 1 to 200 line items.');
 const names=new Set<string>();
 return rows.map((row,index)=>{
  const name=row[cols[0]]?.trim(),qty=Number(row[cols[1]]),price=Number(row[cols[2]]);
  if(!name||name.length>160||!row[cols[1]]?.trim()||!row[cols[2]]?.trim()||!Number.isFinite(qty)||qty<=0||qty>10000000||!validScale(qty,3)||!Number.isFinite(price)||price<0||price>100000000||!validScale(price,2))throw Error(`Invalid item, quantity or price on row ${index+2}.`);
  if(names.has(name.toLowerCase()))throw Error(`Duplicate item on row ${index+2}. Combine quantities or use distinct item names.`);
  names.add(name.toLowerCase());return {name,qty,price};
 });
}
export const samples:Quote[]=[{id:'north',supplier:'Northline Supply',reference:'NS-104',currency:'USD',days:14,shipping:180,tax:0,terms:'Net 30. 12-month warranty. Valid for 30 days.',items:[{name:'Ergonomic task chair',qty:24,price:185},{name:'Height-adjustable desk',qty:12,price:320},{name:'Monitor arm',qty:24,price:48}]},{id:'forma',supplier:'Forma Commercial',reference:'FC-8821',currency:'USD',days:7,shipping:0,tax:0,terms:'50% deposit. Balance on delivery. 24-month warranty. Installation included.',items:[{name:'Ergonomic task chair',qty:24,price:205},{name:'Height-adjustable desk',qty:12,price:345},{name:'Monitor arm',qty:24,price:42}]},{id:'vertex',supplier:'Vertex Office Co.',reference:'VO-3019',currency:'USD',days:21,shipping:350,tax:0,terms:'Payment in advance. Warranty not specified. Valid for 14 days.',items:[{name:'Ergonomic task chair',qty:24,price:170},{name:'Height-adjustable desk',qty:12,price:310},{name:'Monitor arm',qty:24,price:52}]}];
