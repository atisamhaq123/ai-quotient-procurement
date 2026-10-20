import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readJSON} from '../lib/http.ts';
import {safeNext} from '../lib/navigation.ts';
import {csvCell} from '../lib/csv.ts';
import {contentSecurityPolicy} from '../lib/security.ts';
const request=(body,headers={})=>new Request('https://example.test/api',{method:'POST',body,headers:{'content-type':'application/json',...headers}});
test('request parsing rejects malformed, non-object and oversized UTF-8 payloads',async()=>{
 assert.deepEqual(await readJSON(request('{"name":"ok"}')),{name:'ok'});
 for(const body of ['{','null','[]','true'])await assert.rejects(readJSON(request(body)),e=>e.status===400);
 await assert.rejects(readJSON(request('{}',{'content-type':'text/plain'})),e=>e.status===415);
 await assert.rejects(readJSON(request(JSON.stringify({text:'\u20ac'.repeat(100)})),100),e=>e.status===413);
 await assert.rejects(readJSON(request('{}',{'content-length':'999999999'})),e=>e.status===413);
});
test('auth return paths reject open redirects while keeping invitations',()=>{
 const invite='/invite/'+'a'.repeat(72);assert.equal(safeNext(invite),invite);
 for(const value of ['//evil.test','https://evil.test','/\\evil.test','/app?next=https://evil.test',null])assert.equal(safeNext(value),'/app');
});
test('CSV output escapes quotes and neutralizes spreadsheet formulas',()=>{
 assert.equal(csvCell(' =HYPERLINK("x")'),'"\' =HYPERLINK(""x"")"');
 assert.equal(csvCell('North, Inc.'),'"North, Inc."');
});
test('production CSP uses a fresh nonce without unsafe inline scripts or eval',()=>{const policy=contentSecurityPolicy('abc123==','https://example.supabase.co');assert.match(policy,/script-src 'self' 'nonce-abc123==' 'strict-dynamic'/);assert.doesNotMatch(policy,/script-src[^;]*'unsafe-inline'|'unsafe-eval'/);assert.match(policy,/frame-ancestors 'none'/);assert.throws(()=>contentSecurityPolicy('<script>',''));});
