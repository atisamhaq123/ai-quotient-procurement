import Invite from '../../../components/invite';
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <Invite token={token}/>;}
