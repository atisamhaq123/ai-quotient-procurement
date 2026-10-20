import {identity,origin,check,failure,AppError} from '../../../lib/server';
import {readJSON} from '../../../lib/http';
export async function POST(request:Request){try{origin(request);const {client}=await identity();const body=await readJSON(request,4000);if(typeof body.token!=='string'||!/^[a-f0-9-]{72}$/.test(body.token))throw new AppError('Invalid invitation.');const id=check(await client.rpc('accept_invitation',{invite_token:body.token}));return Response.json({organization:id});}catch(e){return failure(e);}}
