import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
import {contentSecurityPolicy} from './lib/security';

export async function proxy(request:NextRequest){
 const nonce=btoa(crypto.randomUUID()),policy=contentSecurityPolicy(nonce,process.env.NEXT_PUBLIC_SUPABASE_URL||'',process.env.NODE_ENV!=='production');
 const headers=new Headers(request.headers);headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',policy);
 let response=NextResponse.next({request:{headers}});
 const refresh=['/app','/login','/signup','/reset-password'].some(path=>request.nextUrl.pathname===path||request.nextUrl.pathname.startsWith(path+'/'));
 if(refresh&&process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY){
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{
   global:{fetch:(input,options)=>fetch(input,{...options,signal:AbortSignal.timeout(15000)})},
   cookies:{getAll:()=>request.cookies.getAll(),setAll:values=>{
    for(const v of values)request.cookies.set(v.name,v.value);
    headers.set('cookie',request.headers.get('cookie')||'');response=NextResponse.next({request:{headers}});
    for(const v of values)response.cookies.set(v.name,v.value,v.options);
   }}
  });
  try{await client.auth.getUser();}catch{/* The protected page performs its own authoritative identity check. */}
 }
 response.headers.set('Content-Security-Policy',policy);response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)']};
