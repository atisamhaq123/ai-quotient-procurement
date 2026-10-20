import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {samples,breakdown,lineTotal} from '../lib/quotes.ts';

test('monetary calculations round line extensions and tax half-up without binary drift',()=>{
 assert.equal(lineTotal({name:'Meter',qty:0.5,price:0.01}),0.01);
 assert.deepEqual(breakdown({...samples[0],items:[{name:'Small',qty:1,price:0.1},{name:'Other',qty:1,price:0.2}],shipping:0.1,tax:5}),{subtotal:0.3,tax:0.02,total:0.42});
});
test('production migration protects approvals, preserves AI usage, and records immutable tenant history',async()=>{
 const db=new PGlite();
 const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',eve='33333333-3333-4333-8333-333333333333';
 const first='44444444-4444-4444-8444-444444444444',second='55555555-5555-4555-8555-555555555555';
 try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  await db.query('insert into auth.users values ($1,$2,now()),($3,$4,now()),($5,$6,now())',[alice,'alice@example.com',bob,'bob@example.com',eve,'eve@example.com']);
  await db.exec(await readFile(new URL('../supabase/migrations/001_setup.sql',import.meta.url),'utf8'));
  async function login(id){await db.exec('reset role;set role authenticated;');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
  const q=(sql,args=[])=>db.query(sql,args);
  await login(alice);const org=(await q("select create_organization('Operations') id")).rows[0].id;
  assert.deepEqual((await q('select plan,subscription_status from organizations where id=$1',[org])).rows[0],{plan:'starter',subscription_status:'trialing'});
  await q('select save_purchase($1,$2,0,$3,$4,$5)',[org,first,'Furniture',JSON.stringify(samples),'north']);
  const ticket=(await q('select reserve_ai($1,$2,1) id',[org,first])).rows[0].id;
  await assert.rejects(q('select reserve_ai($1,$2,1)',[org,first]),/already running/);
  await db.exec('reset role;set role service_role;');assert.equal((await q('select complete_ai($1,1,$2) done',[ticket,'Supplier review.'])).rows[0].done,true);
  await login(alice);await q('select delete_purchase($1,$2,2)',[org,first]);
  const jobs=(await q('select * from ai_jobs')).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].purchase_id,null);assert.equal(jobs[0].state,'completed','deleting a request preserves its counted AI usage');
  await q('select save_purchase($1,$2,0,$3,$4,$5)',[org,second,'Second request',JSON.stringify(samples),'north']);
  const token='a'.repeat(72);await q('select create_invitation($1,$2,$3)',[org,'bob@example.com',token]);
  await login(bob);await q('select accept_invitation($1)',[token]);
  await q('select transition_purchase($1,$2,1,$3,$4)',[org,second,'review','Please review pricing.']);
  await assert.rejects(q('select transition_purchase($1,$2,2,$3,$4)',[org,second,'approved','Approved']),/Only owners/);
  await assert.rejects(q('select save_purchase($1,$2,2,$3,$4,$5)',[org,second,'Edited',JSON.stringify(samples),'north']),/Reopen/);
  await login(alice);await assert.rejects(q('select transition_purchase($1,$2,2,$3,$4)',[org,second,'rejected','']),/reason/);
  await q('select transition_purchase($1,$2,2,$3,$4)',[org,second,'rejected','Clarify warranty coverage.']);
  await login(bob);await q('select save_purchase($1,$2,3,$3,$4,$5)',[org,second,'Revised request',JSON.stringify(samples),'north']);
  await q('select transition_purchase($1,$2,4,$3,$4)',[org,second,'review','Warranty clarified.']);
  await login(alice);await q('select transition_purchase($1,$2,5,$3,$4)',[org,second,'approved','Approved for purchase.']);
  assert.equal((await q('select approved_by from purchases where id=$1',[second])).rows[0].approved_by,alice);
  await assert.rejects(q('select save_purchase($1,$2,6,$3,$4,$5)',[org,second,'Changed after approval',JSON.stringify(samples),'north']),/Reopen/);
  await login(bob);await assert.rejects(q('select transition_purchase($1,$2,6,$3,$4)',[org,second,'draft','Reopen']),/Only owners/);
  await assert.rejects(q('select delete_purchase($1,$2,6)',[org,second]),/Only owners/);
  await assert.rejects(q("update audit_events set summary='Forged'"),/permission denied/);
  await assert.rejects(q('select save_purchase_v1($1,$2,6,$3,$4,$5)',[org,second,'Bypass',JSON.stringify(samples),'north']),/permission denied/);
  await login(eve);assert.equal((await q('select * from audit_events')).rows.length,0,'audit history is tenant-isolated');
  await login(alice);await q('select transition_purchase($1,$2,6,$3,$4)',[org,second,'draft','New revision.']);
  const malformed=structuredClone(samples);malformed[0].shipping=1.001;
  await assert.rejects(q('select save_purchase($1,$2,7,$3,$4,$5)',[org,second,'Invalid precision',JSON.stringify(malformed),'north']),/precision/);
  const revoked='b'.repeat(72);await q('select create_invitation($1,$2,$3)',[org,'eve@example.com',revoked]);const invitation=(await q('select id from invitations where email=$1',['eve@example.com'])).rows[0].id;
  await q('select revoke_invitation($1,$2)',[org,invitation]);await login(eve);await assert.rejects(q('select accept_invitation($1)',[revoked]),/expired|already accepted/);
  await login(alice);await q('select transfer_ownership($1,$2)',[org,bob]);await assert.rejects(q('select rename_organization($1,$2)',[org,'Old owner change']),/Only owners/);
  await login(bob);await q('select rename_organization($1,$2)',[org,'Updated organization']);
  await login(alice);await q('select leave_organization($1)',[org]);assert.equal((await q('select * from purchases')).rows.length,0,'leaving removes organization access');
  await db.exec('reset role;');
  await q("insert into ai_jobs(organization_id,purchase_id,requested_by,state) select $1,$2,$3,'completed' from generate_series(1,9)",[org,second,bob]);
  await login(bob);await assert.rejects(q('select reserve_ai($1,$2,7)',[org,second]),/daily AI/,'deleted requests still count against the plan allowance');
  await db.exec('reset role;set role service_role;');assert.equal((await q("select apply_stripe_subscription('evt_BillingTest',100,$1,'cus_BillingTest','sub_BillingTest','pro','active',now()+interval '1 month',false) applied",[org])).rows[0].applied,true);assert.equal((await q("select apply_stripe_subscription('evt_BillingTest',100,$1,'cus_BillingTest','sub_BillingTest','pro','active',now()+interval '1 month',false) applied",[org])).rows[0].applied,false,'Stripe events are idempotent');
  assert.deepEqual((await q('select plan,subscription_status from organizations where id=$1',[org])).rows[0],{plan:'pro',subscription_status:'active'});
  await login(bob);assert.ok((await q('select reserve_ai($1,$2,7)',[org,second])).rows[0].reserve_ai,'Pro raises the AI allowance inside the existing workflow');
  const actions=(await q('select action from audit_events')).rows.map(r=>r.action);for(const event of ['purchase.created','purchase.deleted','purchase.approved','purchase.rejected','organization.ownership_transferred','invitation.revoked'])assert.ok(actions.includes(event),event);
  await db.exec('reset role;');await q('delete from organizations where id=$1',[org]);assert.equal((await q('select * from audit_events')).rows.length,0,'organization cleanup cascades without audit trigger failures');
 }finally{await db.close();}
});
