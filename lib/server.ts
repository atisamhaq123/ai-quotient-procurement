import {createServerClient} from '@supabase/ssr';
import {createClient} from '@supabase/supabase-js';
import {cookies} from 'next/headers';
export class AppError extends Error{constructor(message:string,public status=400){super(message);}}
export function env(name:string){const value=process.env[name];if(!value)throw new AppError('The new Supabase project is not connected yet. Configure the environment and apply the database migration.',503);return value;}
export async function db(){const jar=await cookies();return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'),env('NEXT_PUBLIC_SUPABASE_ANON_KEY'),{cookies:{getAll:()=>jar.getAll(),setAll:values=>{try{for(const {name,value,options} of values)jar.set(name,value,options);}catch{/* The proxy refreshes cookies for server-rendered pages. */}}}});}
export async function identity(){const client=await db();const {data:{user},error}=await client.auth.getUser();if(error||!user||!user.email_confirmed_at)throw new AppError('Sign in with a verified email address to continue.',401);return {client,user};}
export function admin(){return createClient(env('NEXT_PUBLIC_SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});}
export async function context(id:string,owner=false){const {client,user}=await identity();const {data:membership}=await client.from('memberships').select('role').eq('organization_id',id).eq('user_id',user.id).maybeSingle();if(!membership||(owner&&membership.role!=='owner'))throw new AppError('You do not have access to this organization.',403);return {client,user,role:membership.role};}
export function origin(request:Request){if(request.headers.get('origin')!==new URL(env('NEXT_PUBLIC_APP_URL')).origin)throw new AppError('Request origin rejected.',403);}
export function check<T>(result:{data:T;error:{message:string}|null}):T{if(result.error)throw new AppError(result.error.message);return result.data;}
export function failure(e:unknown){return Response.json({error:e instanceof AppError?e.message:'The request could not be completed. Please retry.'},{status:e instanceof AppError?e.status:500,headers:{'Cache-Control':'no-store'}});}
