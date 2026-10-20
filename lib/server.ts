import {createServerClient} from '@supabase/ssr';
import {createClient} from '@supabase/supabase-js';
import {cookies} from 'next/headers';
import {HttpError} from './http';
export class AppError extends HttpError{}
export function env(name:string){const value=process.env[name];if(!value)throw new AppError('A required service is not configured. Contact the workspace administrator.',503);return value;}
const boundedFetch:typeof fetch=(input,options:RequestInit={})=>fetch(input,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
export async function db(){
 const jar=await cookies();return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'),env('NEXT_PUBLIC_SUPABASE_ANON_KEY'),{global:{fetch:boundedFetch},cookies:{getAll:()=>jar.getAll(),setAll:values=>{try{for(const {name,value,options} of values)jar.set(name,value,options);}catch{/* Server components rely on the proxy for refreshed cookies. */}}}});
}
export async function identity(){const client=await db();const {data:{user},error}=await client.auth.getUser();if(error&&error.status&&error.status>=500)throw new AppError('Authentication is temporarily unavailable. Please retry.',503);if(error||!user||!user.email_confirmed_at)throw new AppError('Your session expired. Sign in with a verified email address.',401);return {client,user};}
export function admin(){return createClient(env('NEXT_PUBLIC_SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{global:{fetch:boundedFetch},auth:{persistSession:false,autoRefreshToken:false}});}
export async function context(id:string,owner=false){const {client,user}=await identity();const {data:membership,error}=await client.from('memberships').select('role').eq('organization_id',id).eq('user_id',user.id).maybeSingle();if(error)check({data:null,error});if(!membership||owner&&membership.role!=='owner')throw new AppError(owner?'Only the organization owner can do this.':'You no longer have access to this organization.',403);return {client,user,role:membership.role};}
export function origin(request:Request){if(request.headers.get('origin')!==new URL(env('NEXT_PUBLIC_APP_URL')).origin)throw new AppError('Request origin rejected.',403);}
export function check<T>(result:{data:T;error:{message:string;code?:string}|null}):T{
 const error=result.error;if(!error)return result.data;
 if(error.code==='P0001'){const status=/daily AI|already running|too many/i.test(error.message)?429:/only owners|access denied|verify your email|sign in/i.test(error.message)?403:/changed|reload|reopen|archived|approved|limit|version/i.test(error.message)?409:/access|owner|verify|sign in|member/i.test(error.message)?403:400;throw new AppError(error.message,status);}
 if(error.code==='42501')throw new AppError('You do not have permission for this action.',403);
 if(error.code==='23505')throw new AppError('This record already exists. Refresh before trying again.',409);
 if(['PGRST116','22P02'].includes(error.code||''))throw new AppError('This record is unavailable. Reload the workspace.',404);
 console.error(JSON.stringify({event:'database.error',code:error.code||'unknown'}));
 throw new AppError(['PGRST202','PGRST205','42703','42P01'].includes(error.code||'')?'The database needs the latest migration. Ask the administrator to check database setup. Fresh projects use supabase/migrations/001_setup.sql; existing installations use only missing legacy upgrades.':'The database is temporarily unavailable. Please retry.',503);
}
export function failure(e:unknown){const requestId=crypto.randomUUID(),status=e instanceof HttpError?e.status:500;console.error(JSON.stringify({event:'request.failed',requestId,status}));return Response.json({error:e instanceof HttpError?e.message:'The request could not be completed. Please retry.',requestId},{status,headers:{'Cache-Control':'private, no-store','X-Request-Id':requestId,...(status===429?{'Retry-After':'60'}:{})}});}
