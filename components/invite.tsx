'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Layers3,ArrowRight,UsersRound} from 'lucide-react';
import {requestJSON} from '../lib/http';
export default function Invite({token}:{token:string}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),next='/invite/'+token;
 async function accept(){setBusy(true);setError('');try{const data=await requestJSON('/api/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});location.assign('/app?organization='+data.organization);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <main className="auth-page"><header className="auth-header"><Link className="brand" href="/login"><Layers3/>quotient</Link></header><div className="auth-body"><UsersRound size={34} className="accent"/><h1>Your team awaits.</h1><p className="auth-subtitle">Join using the verified email address your teammate invited. Your invitation will stay with you through sign-in or signup.</p>{error&&<div className="alert error" role="alert">{error}</div>}<button className="primary auth-submit" disabled={busy} onClick={accept}>{busy?'Joining...':'Accept invitation'}<ArrowRight size={16}/></button><div className="invite-links"><Link href={'/login?next='+encodeURIComponent(next)}>Sign in</Link><Link href={'/signup?next='+encodeURIComponent(next)}>Create account</Link></div></div></main>;
}
