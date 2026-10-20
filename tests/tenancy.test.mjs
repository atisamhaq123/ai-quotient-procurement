import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {samples} from '../lib/quotes.ts';

test('tenant isolation, role boundaries, invitations, concurrency and AI limits',async()=>{
 const db=new PGlite();
 const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',eve='33333333-3333-4333-8333-333333333333';
 const purchase='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
 try{
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth,public to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`);
  await db.query('insert into auth.users values ($1,$2,now()),($3,$4,now()),($5,$6,null)',[alice,'alice@example.com',bob,'bob@example.com',eve,'eve@example.com']);
  await db.exec(await readFile(new URL('../supabase/migrations/001_multitenant.sql',import.meta.url),'utf8'));
  async function login(id){await db.exec('reset role; set role authenticated;');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
  const rpc=(sql,args=[])=>db.query(sql,args);
  await login(alice);const a=(await rpc("select create_organization('Alice Org') id")).rows[0].id;
  await rpc('select save_purchase($1,$2,0,$3,$4,$5)',[a,purchase,'Office furniture',JSON.stringify(samples),'']);
  await login(bob);const b=(await rpc("select create_organization('Bob Org') id")).rows[0].id;
  await rpc('select save_purchase($1,$2,0,$3,$4,$5)',[b,other,'Private request',JSON.stringify(samples),'']);
  assert.equal((await rpc('select * from purchases where id=$1',[purchase])).rows.length,0,'RLS hides another tenant purchase');
  assert.equal((await rpc('select * from organizations')).rows.length,1,'RLS hides another tenant organization');
  assert.equal((await rpc('select * from memberships where organization_id=$1',[a])).rows.length,0,'RLS hides another tenant members');
  await assert.rejects(rpc('select save_purchase($1,$2,1,$3,$4,$5)',[a,purchase,'Hacked',JSON.stringify(samples),'']),/access denied/);
  await assert.rejects(rpc('select delete_purchase($1,$2,1)',[a,purchase]),/access denied/);
  await assert.rejects(rpc('select reserve_ai($1,$2,1)',[a,purchase]),/access denied/);
  await assert.rejects(rpc("update memberships set role='owner'"),/permission denied/);
  await assert.rejects(rpc('select complete_ai($1,1,$2)',[purchase,'Forged review']),/permission denied/);
  await login(eve);await assert.rejects(rpc("select create_organization('Unverified')"),/Verify your email/);
  await login(alice);await rpc('select save_purchase($1,$2,1,$3,$4,$5)',[a,purchase,'Updated request',JSON.stringify(samples),'']);
  await assert.rejects(rpc('select save_purchase($1,$2,1,$3,$4,$5)',[a,purchase,'Stale change',JSON.stringify(samples),'']),/changed or is unavailable/);
  const token='a'.repeat(72);
  await rpc('select create_invitation($1,$2,$3)',[a,'bob@example.com',token]);
  await assert.rejects(rpc('select accept_invitation($1)',[token]),/different email/);
  await login(bob);await rpc('select accept_invitation($1)',[token]);
  assert.equal((await rpc('select * from purchases where id=$1',[purchase])).rows.length,1,'accepted member can see tenant records');
  await assert.rejects(rpc('select create_invitation($1,$2,$3)',[a,'eve@example.com','b'.repeat(72)]),/Only owners/);
  await assert.rejects(rpc('select remove_member($1,$2)',[a,alice]),/Only owners/);
  await assert.rejects(rpc('select accept_invitation($1)',[token]),/already accepted/);
  await rpc('select save_purchase($1,$2,2,$3,$4,$5)',[a,purchase,'Member edit',JSON.stringify(samples),'']);
  const ticket=(await rpc('select reserve_ai($1,$2,3) id',[a,purchase])).rows[0].id;
  await login(alice);await rpc('select remove_member($1,$2)',[a,bob]);
  await login(bob);assert.equal((await rpc('select * from purchases where id=$1',[purchase])).rows.length,0,'removed member loses read access');
  await db.exec('reset role; set role service_role;');assert.equal((await rpc('select complete_ai($1,3,$2) done',[ticket,'Review after removal'])).rows[0].done,false,'removed member cannot complete an AI write');
  await login(alice);
  for(let i=0;i<20;i++)await rpc('select reserve_ai($1,$2,3)',[a,purchase]);
  await assert.rejects(rpc('select reserve_ai($1,$2,3)',[a,purchase]),/20 daily/);
  const malformed=structuredClone(samples);malformed[0].items[0].price=-1;
  await assert.rejects(rpc('select save_purchase($1,$2,3,$3,$4,$5)',[a,purchase,'Bad quote',JSON.stringify(malformed),'']),/Invalid quotation/);
  await db.exec('reset role; set role anon;');await assert.rejects(rpc('select * from purchases'),/permission denied/);
 }finally{await db.close();}
});
