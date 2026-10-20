'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Save} from 'lucide-react';
import {browserDb} from '../lib/client';
export default function AccountControls({demo}:{demo:boolean}){
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(demo){setName('Jamie Davis');return;}let active=true;browserDb().auth.getUser().then(({data})=>{if(active)setName(typeof data.user?.user_metadata?.full_name==='string'?data.user.user_metadata.full_name:'');}).catch(()=>{if(active)setError('Unable to load your profile.');});return()=>{active=false;};},[demo]);
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');try{if(!demo){const {error}=await browserDb().auth.updateUser({data:{full_name:name.trim()}});if(error)throw error;}setMessage(demo?'Demo profile updated for this screen.':'Your display name has been updated.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="account-settings"><div className="section-heading"><div><p className="eyebrow">PERSONAL ACCOUNT</p><h2>Your profile</h2></div></div><form onSubmit={save}><label>Display name<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><button className="secondary" disabled={busy||!name.trim()}><Save size={15}/>{busy?'Saving...':'Save profile'}</button>{!demo&&<Link className="text-link" href="/reset-password">Change password</Link>}</form>{message&&<p className="alert success" role="status">{message}</p>}{error&&<p className="alert error" role="alert">{error}</p>}</section>;
}
