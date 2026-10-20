import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
export async function proxy(request:NextRequest){
 let response=NextResponse.next({request});
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return response;
 const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>request.cookies.getAll(),setAll:values=>{for(const v of values)request.cookies.set(v.name,v.value);response=NextResponse.next({request});for(const v of values)response.cookies.set(v.name,v.value,v.options);}}});
 await client.auth.getUser();return response;
}
export const config={matcher:['/app/:path*','/login','/signup','/reset-password','/api/:path*']};
