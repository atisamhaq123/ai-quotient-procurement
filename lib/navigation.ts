export function safeNext(value:unknown){
 if(value==='/app'||value==='/reset-password')return value;
 if(typeof value==='string'&&/^\/invite\/[a-f0-9-]{72}$/.test(value))return value;
 return '/app';
}
