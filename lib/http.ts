export class HttpError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export async function readJSON(request:Request,maxBytes=250000):Promise<Record<string,any>>{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new HttpError('Use application/json for this request.',415);
 const size=Number(request.headers.get('content-length')||0);if(size>maxBytes)throw new HttpError('Request exceeds the upload limit.',413);
 const reader=request.body?.getReader();if(!reader)throw new HttpError('Request body is empty.');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new HttpError('Request exceeds the upload limit.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
 try{const result=JSON.parse(new TextDecoder().decode(data));if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;}catch{throw new HttpError('Request contains invalid JSON.');}
}
export async function requestJSON(url:string,options:RequestInit={}){
 let response:Response;
 try{response=await fetch(url,{...options,cache:'no-store',signal:options.signal||AbortSignal.timeout(65000)});}catch{throw Error('Unable to reach the server. Your unsaved changes are still here. Check your connection and retry.');}
 let data;try{data=await response.json();}catch{throw Error('The server returned an unexpected response. Please retry.');}
 if(!response.ok)throw Object.assign(new Error(data.error||'Request failed. Please retry.'),{status:response.status,requestId:data.requestId});
 return data;
}
