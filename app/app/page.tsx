import {redirect} from 'next/navigation';
import {identity,AppError} from '../../lib/server';
import Workspace from '../../components/workspace';
export default async function Page(){if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)redirect('/login?setup=required');let email='';try{const {user}=await identity();email=user.email||'';}catch(e){if(e instanceof AppError&&e.status===401)redirect('/login');throw e;}return <Workspace demo={false} email={email}/>;}
