export function contentSecurityPolicy(nonce:string,supabaseURL:string,development=false){
 if(!/^[A-Za-z0-9+/=]+$/.test(nonce))throw Error('Invalid CSP nonce.');
 const origin=supabaseURL?new URL(supabaseURL).origin:'';
 return ["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}`,"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com","font-src 'self' https://fonts.gstatic.com","img-src 'self' data:",`connect-src 'self' ${origin} ${origin.replace('https:','wss:')}${development?' ws: http://localhost:* http://127.0.0.1:*':''}`,"frame-ancestors 'none'","base-uri 'self'","object-src 'none'","form-action 'self'"].join('; ');
}
