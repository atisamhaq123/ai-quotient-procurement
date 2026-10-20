import {redirect} from 'next/navigation';
import {identity} from '../../lib/server';
import Workspace from '../../components/workspace';
export default async function Page(){let email='';try{const {user}=await identity();email=user.email||'';}catch{redirect('/login');}return <Workspace demo={false} email={email}/>;}
