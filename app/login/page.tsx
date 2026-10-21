import AuthForm from '../../components/auth-form';
import {redirect} from 'next/navigation';
import {identity,AppError} from '../../lib/server';
import {safeNext} from '../../lib/navigation';

export default async function Page({searchParams}:{searchParams:Promise<{next?:string}>}){
 const query=await searchParams;let authenticated=false;
 try{await identity();authenticated=true;}catch(error){if(!(error instanceof AppError)||error.status!==401)throw error;}
 if(authenticated)redirect(safeNext(query.next));
 return <AuthForm mode="login"/>;
}
