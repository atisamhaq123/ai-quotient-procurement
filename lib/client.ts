import {createBrowserClient} from '@supabase/ssr';
export const configured=Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export function browserDb(){
 if(!configured)throw new Error('Connect the new Supabase project to enable email accounts. You can explore the demo in the meantime.');
 return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
