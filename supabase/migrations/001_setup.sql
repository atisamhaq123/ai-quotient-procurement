-- Fresh installations only. Existing databases upgraded through legacy migration 003 need no changes.
-- Complete schema, tenant isolation, approval workflows, audit history, and AI usage controls.
begin;

-- Included schema stage: 001_multitenant.sql
create table public.organizations (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 80),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.memberships (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null,
 role text not null check (role in ('owner','member')),
 created_at timestamptz not null default now(),
 primary key (organization_id,user_id)
);
create index memberships_user on public.memberships(user_id);
create table public.purchases (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 title text not null check (length(trim(title)) between 1 and 120),
 quotes jsonb not null default '[]' check (jsonb_typeof(quotes)='array' and jsonb_array_length(quotes)<=10 and octet_length(quotes::text)<=240000),
 selected text not null default '',
 review text not null default '',
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id)
);
create index purchases_organization on public.purchases(organization_id,updated_at desc);
create table public.invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 email text not null,
 token_hash text not null unique,
 expires_at timestamptz not null default now()+interval '7 days',
 accepted_at timestamptz,
 created_by uuid not null references auth.users(id)
);
create table public.ai_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 purchase_id uuid not null references public.purchases(id) on delete cascade,
 requested_by uuid not null references auth.users(id),
 state text not null default 'reserved' check (state in ('reserved','completed','failed')),
 created_at timestamptz not null default now()
);
create index ai_jobs_quota on public.ai_jobs(organization_id,created_at);

create function public.is_org_member(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=org and m.user_id=auth.uid() and u.email_confirmed_at is not null)
$$;
create function public.is_org_owner(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=org and m.user_id=auth.uid() and m.role='owner' and u.email_confirmed_at is not null)
$$;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.purchases enable row level security;
alter table public.invitations enable row level security;
alter table public.ai_jobs enable row level security;
create policy organization_read on public.organizations for select to authenticated using(public.is_org_member(id));
create policy membership_read on public.memberships for select to authenticated using(public.is_org_member(organization_id));
create policy purchase_read on public.purchases for select to authenticated using(public.is_org_member(organization_id));
create policy invitation_read on public.invitations for select to authenticated using(public.is_org_owner(organization_id));
create policy ai_job_read on public.ai_jobs for select to authenticated using(public.is_org_member(organization_id));
revoke all on public.organizations,public.memberships,public.purchases,public.invitations,public.ai_jobs from anon,authenticated;
grant select on public.organizations,public.memberships,public.purchases,public.invitations,public.ai_jobs to authenticated;
grant all on public.organizations,public.memberships,public.purchases,public.invitations,public.ai_jobs to service_role;

create function public.create_organization(org_name text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare new_id uuid; account_email text;
begin
 select email into account_email from auth.users where id=auth.uid() and email_confirmed_at is not null for update;
 if account_email is null then raise exception 'Verify your email before creating an organization.'; end if;
 if (select count(*) from public.memberships where user_id=auth.uid() and role='owner')>=5 then raise exception 'You can own up to five organizations.'; end if;
 insert into public.organizations(name,created_by) values(trim(org_name),auth.uid()) returning id into new_id;
 insert into public.memberships(organization_id,user_id,email,role) values(new_id,auth.uid(),account_email,'owner');
 return new_id;
end $$;

create function public.validate_quotes(quote_data jsonb,chosen text) returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare q jsonb; item jsonb;
begin
 if jsonb_typeof(quote_data)<>'array' or jsonb_array_length(quote_data)>10 or octet_length(quote_data::text)>240000 then return false; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(quote_data))<>jsonb_array_length(quote_data) then return false; end if;
 for q in select value from jsonb_array_elements(quote_data) loop
  if not(q ?& array['id','supplier','reference','currency','days','shipping','tax','terms','items']) then return false; end if;
  if jsonb_typeof(q->'id')<>'string' or length(q->>'id') not between 1 and 100 or jsonb_typeof(q->'supplier')<>'string' or length(trim(q->>'supplier')) not between 1 and 100 or jsonb_typeof(q->'reference')<>'string' or length(q->>'reference')>100 or jsonb_typeof(q->'currency')<>'string' or q->>'currency' not in ('USD','EUR','GBP','PKR','AED','CAD','AUD') or jsonb_typeof(q->'terms')<>'string' or length(q->>'terms')>4000 then return false; end if;
  if jsonb_typeof(q->'days')<>'number' or (q->>'days')::numeric not between 0 and 3650 or jsonb_typeof(q->'shipping')<>'number' or (q->>'shipping')::numeric not between 0 and 100000000 or jsonb_typeof(q->'tax')<>'number' or (q->>'tax')::numeric not between 0 and 100 then return false; end if;
  if jsonb_typeof(q->'items')<>'array' or jsonb_array_length(q->'items') not between 1 and 200 then return false; end if;
  if (select count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(q->'items'))<>jsonb_array_length(q->'items') then return false; end if;
  for item in select value from jsonb_array_elements(q->'items') loop
   if not(item ?& array['name','qty','price']) or jsonb_typeof(item->'name')<>'string' or length(trim(item->>'name')) not between 1 and 160 or jsonb_typeof(item->'qty')<>'number' or (item->>'qty')::numeric<=0 or (item->>'qty')::numeric>10000000 or jsonb_typeof(item->'price')<>'number' or (item->>'price')::numeric not between 0 and 100000000 then return false; end if;
  end loop;
 end loop;
 return chosen='' or exists(select 1 from jsonb_array_elements(quote_data) as entry(value) where entry.value->>'id'=chosen);
exception when others then return false;
end $$;

create function public.save_purchase(org uuid,purchase_id uuid,expected_version integer,purchase_title text,quote_data jsonb,chosen text) returns public.purchases language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.purchases;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 if not public.validate_quotes(quote_data,chosen) or quote_data is null or chosen is null then raise exception 'Invalid quotation data.'; end if;
 perform 1 from public.organizations where id=org for update;
 if expected_version=0 then
  if (select count(*) from public.purchases where organization_id=org)>=100 then raise exception 'This workspace has reached 100 purchase requests.'; end if;
  insert into public.purchases(id,organization_id,title,quotes,selected,created_by) values(purchase_id,org,purchase_title,quote_data,chosen,auth.uid()) returning * into result;
 else
  update public.purchases set title=purchase_title,quotes=quote_data,selected=chosen,review=case when quotes=quote_data and title=purchase_title then review else '' end,version=version+1,updated_at=now() where id=purchase_id and organization_id=org and version=expected_version returning * into result;
  if result.id is null then raise exception 'This purchase changed or is unavailable. Reload before saving.'; end if;
 end if;
 return result;
end $$;

create function public.delete_purchase(org uuid,purchase_id uuid,expected_version integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 delete from public.purchases where id=purchase_id and organization_id=org and version=expected_version;
 if not found then raise exception 'This purchase changed or is unavailable. Reload before deleting.'; end if;
end $$;

create function public.create_invitation(org uuid,invite_email text,invite_token text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_org_owner(org) then raise exception 'Only owners can invite members.'; end if;
 perform 1 from public.organizations where id=org for update;
 if length(invite_email)>254 or invite_email not like '%@%.%' or length(invite_token)<>72 then raise exception 'Invalid invitation.'; end if;
 if (select count(*) from public.memberships where organization_id=org)>=20 then raise exception 'Organization member limit reached.'; end if;
 if (select count(*) from public.invitations where organization_id=org and accepted_at is null and expires_at>now())>=30 then raise exception 'Too many pending invitations.'; end if;
 insert into public.invitations(organization_id,email,token_hash,created_by) values(org,lower(trim(invite_email)),encode(sha256(convert_to(invite_token,'UTF8')),'hex'),auth.uid());
end $$;

create function public.accept_invitation(invite_token text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation public.invitations; account_email text;
begin
 select email into account_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if account_email is null then raise exception 'Sign in with your verified invited email address.'; end if;
 select * into invitation from public.invitations where token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') and expires_at>now() and accepted_at is null for update;
 if invitation.id is null or lower(account_email)<>invitation.email then raise exception 'Invitation expired, already accepted, or belongs to a different email.'; end if;
 perform 1 from public.organizations where id=invitation.organization_id for update;
 if (select count(*) from public.memberships where organization_id=invitation.organization_id)>=20 then raise exception 'Organization member limit reached.'; end if;
 insert into public.memberships(organization_id,user_id,email,role) values(invitation.organization_id,auth.uid(),account_email,'member') on conflict do nothing;
 update public.invitations set accepted_at=now() where id=invitation.id;
 return invitation.organization_id;
end $$;

create function public.remove_member(org uuid,member_user uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_org_owner(org) then raise exception 'Only owners can remove members.'; end if;
 delete from public.memberships where organization_id=org and user_id=member_user and role='member';
 if not found then raise exception 'Member unavailable. Owners cannot be removed.'; end if;
end $$;

create function public.reserve_ai(org uuid,purchase_id uuid,expected_version integer) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare ticket uuid;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 if not exists(select 1 from public.purchases p where p.id=purchase_id and p.organization_id=org and p.version=expected_version) then raise exception 'Save or reload your purchase before reviewing.'; end if;
 if (select count(*) from public.ai_jobs where organization_id=org and state<>'failed' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=20 then raise exception 'This organization has used its 20 daily AI reviews. Resets at 00:00 UTC.'; end if;
 insert into public.ai_jobs(organization_id,purchase_id,requested_by) values(org,purchase_id,auth.uid()) returning id into ticket;
 return ticket;
end $$;

create function public.complete_ai(ticket uuid,expected_version integer,review_text text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.ai_jobs;
begin
 select * into job from public.ai_jobs where id=ticket and state='reserved' for update;
 if job.id is null then return false; end if;
 -- A removed member cannot finish a request and write into their previous tenant.
 if not exists(select 1 from public.memberships where organization_id=job.organization_id and user_id=job.requested_by) then update public.ai_jobs set state='failed' where id=ticket; return false; end if;
 update public.purchases set review=left(review_text,12000),version=version+1,updated_at=now() where id=job.purchase_id and organization_id=job.organization_id and version=expected_version;
 if not found then update public.ai_jobs set state='failed' where id=ticket; return false; end if;
 update public.ai_jobs set state='completed' where id=ticket;
 return true;
end $$;

revoke all on function public.is_org_member(uuid),public.is_org_owner(uuid),public.validate_quotes(jsonb,text),public.create_organization(text),public.save_purchase(uuid,uuid,integer,text,jsonb,text),public.delete_purchase(uuid,uuid,integer),public.create_invitation(uuid,text,text),public.accept_invitation(text),public.remove_member(uuid,uuid),public.reserve_ai(uuid,uuid,integer),public.complete_ai(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.is_org_member(uuid),public.is_org_owner(uuid),public.create_organization(text),public.save_purchase(uuid,uuid,integer,text,jsonb,text),public.delete_purchase(uuid,uuid,integer),public.create_invitation(uuid,text,text),public.accept_invitation(text),public.remove_member(uuid,uuid),public.reserve_ai(uuid,uuid,integer) to authenticated;
grant execute on function public.complete_ai(uuid,integer,text) to service_role;

-- Included schema stage: 002_production_workflows.sql
-- Preserve paid AI usage when a purchasing record is deleted.
alter table public.ai_jobs drop constraint ai_jobs_purchase_id_fkey;
alter table public.ai_jobs alter column purchase_id drop not null;
alter table public.ai_jobs add constraint ai_jobs_purchase_id_fkey foreign key(purchase_id) references public.purchases(id) on delete set null;
alter table public.ai_jobs add column purchase_version integer;
alter table public.purchases add column status text not null default 'draft' check(status in ('draft','review','approved','rejected','archived'));
alter table public.purchases add column decision_note text not null default '' check(length(decision_note)<=2000);
alter table public.purchases add column approved_at timestamptz;
alter table public.purchases add column approved_by uuid references auth.users(id) on delete set null;
alter table public.invitations add column created_at timestamptz not null default now();

create table public.audit_events(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 actor_email text not null,
 action text not null,
 record_id uuid,
 summary text not null,
 created_at timestamptz not null default now()
);
create index audit_organization_time on public.audit_events(organization_id,created_at desc);
alter table public.audit_events enable row level security;
create policy audit_read on public.audit_events for select to authenticated using(public.is_org_member(organization_id));
revoke all on public.audit_events from public,anon,authenticated;
grant select on public.audit_events to authenticated;
grant all on public.audit_events to service_role;

create function public.record_audit(org uuid,event_action text,event_record uuid,event_summary text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.audit_events(organization_id,actor_id,actor_email,action,record_id,summary)
 values(org,auth.uid(),coalesce((select email from auth.users where id=auth.uid()),'System'),event_action,event_record,left(event_summary,500));
end $$;
revoke all on function public.record_audit(uuid,text,uuid,text) from public,anon,authenticated;

create function public.audit_purchase() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then
  perform public.record_audit(old.organization_id,'purchase.deleted',old.id,old.title); return old;
 elsif tg_op='INSERT' then
  perform public.record_audit(new.organization_id,'purchase.created',new.id,new.title); return new;
 elsif old.status is distinct from new.status then
  perform public.record_audit(new.organization_id,'purchase.'||new.status,new.id,new.title||' / '||left(new.decision_note,200));
 elsif old.selected is distinct from new.selected then
  perform public.record_audit(new.organization_id,'purchase.shortlisted',new.id,new.title);
 elsif old.quotes is distinct from new.quotes or old.title is distinct from new.title then
  perform public.record_audit(new.organization_id,'purchase.updated',new.id,new.title);
 elsif old.review is distinct from new.review then
  perform public.record_audit(new.organization_id,'purchase.ai_reviewed',new.id,new.title);
 end if;
 return new;
end $$;
revoke all on function public.audit_purchase() from public,anon,authenticated;
create trigger audit_purchase_changes after insert or update or delete on public.purchases for each row execute function public.audit_purchase();

alter function public.validate_quotes(jsonb,text) rename to validate_quotes_v1;
revoke all on function public.validate_quotes_v1(jsonb,text) from public,anon,authenticated;
create function public.validate_quotes(quote_data jsonb,chosen text) returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare q jsonb; item jsonb; subtotal numeric; tax_amount numeric;
begin
 if quote_data is null or chosen is null or not public.validate_quotes_v1(quote_data,chosen) then return false; end if;
 for q in select value from jsonb_array_elements(quote_data) loop
  if (q->>'days')::numeric<>trunc((q->>'days')::numeric) or (q->>'shipping')::numeric<>round((q->>'shipping')::numeric,2) or (q->>'tax')::numeric<>round((q->>'tax')::numeric,2) then return false; end if;
  subtotal:=0;
  for item in select value from jsonb_array_elements(q->'items') loop
   if (item->>'qty')::numeric<>round((item->>'qty')::numeric,3) or (item->>'price')::numeric<>round((item->>'price')::numeric,2) then return false; end if;
   subtotal:=subtotal+round((item->>'qty')::numeric*(item->>'price')::numeric,2);
  end loop;
  tax_amount:=round(subtotal*(q->>'tax')::numeric/100,2);
  if subtotal+tax_amount+(q->>'shipping')::numeric>1000000000000 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function public.validate_quotes(jsonb,text) from public,anon,authenticated;

alter function public.save_purchase(uuid,uuid,integer,text,jsonb,text) rename to save_purchase_v1;
revoke all on function public.save_purchase_v1(uuid,uuid,integer,text,jsonb,text) from public,anon,authenticated;
create function public.save_purchase(org uuid,purchase_id uuid,expected_version integer,purchase_title text,quote_data jsonb,chosen text) returns public.purchases language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.purchases; result public.purchases;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 select * into existing from public.purchases where id=purchase_id and organization_id=org for update;
 if expected_version is null or expected_version<0 then raise exception 'Invalid purchase version.'; end if;
 if not public.validate_quotes(quote_data,chosen) then raise exception 'Invalid quotation data or monetary precision.'; end if;
 if existing.id is not null and existing.status not in ('draft','rejected') then raise exception 'Reopen this purchase as a draft before changing its quotations.'; end if;
 select * into result from public.save_purchase_v1(org,purchase_id,expected_version,purchase_title,quote_data,chosen);
 return result;
end $$;

create or replace function public.delete_purchase(org uuid,purchase_id uuid,expected_version integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.purchases;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 select * into target from public.purchases where id=purchase_id and organization_id=org and version=expected_version for update;
 if target.id is null then raise exception 'This purchase changed or is unavailable. Reload before deleting.'; end if;
 if target.status not in ('draft','rejected') and not public.is_org_owner(org) then raise exception 'Only owners can delete submitted or approved requests.'; end if;
 if exists(select 1 from public.ai_jobs where public.ai_jobs.purchase_id=target.id and state='reserved' and created_at>now()-interval '2 minutes') then raise exception 'An AI review is already running. Retry after it finishes.'; end if;
 delete from public.purchases where id=target.id;
end $$;

create function public.transition_purchase(org uuid,purchase_id uuid,expected_version integer,next_status text,note text) returns public.purchases language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.purchases; is_owner boolean;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 select * into target from public.purchases where id=purchase_id and organization_id=org and version=expected_version for update;
 if target.id is null then raise exception 'This purchase changed or is unavailable. Reload before updating its status.'; end if;
 is_owner:=public.is_org_owner(org);
 if next_status is null or next_status not in ('draft','review','approved','rejected','archived') or next_status=target.status or note is null or length(note)>2000 then raise exception 'Invalid status change.'; end if;
 if next_status in ('approved','rejected','archived') and not is_owner then raise exception 'Only owners can approve, reject, or archive requests.'; end if;
 if next_status in ('approved','rejected') and target.status<>'review' then raise exception 'Submit this request for review before recording a decision.'; end if;
 if next_status='review' and (target.status not in ('draft','rejected') or jsonb_array_length(target.quotes)<2 or target.selected='') then raise exception 'Save at least two quotes and shortlist a supplier before submitting for review.'; end if;
 if next_status='draft' and target.status in ('approved','archived') and not is_owner then raise exception 'Only owners can reopen approved or archived requests.'; end if;
 if next_status='rejected' and length(trim(note))=0 then raise exception 'Include a reason when requesting changes.'; end if;
 update public.purchases set status=next_status,decision_note=note,approved_at=case when next_status='approved' then now() else null end,approved_by=case when next_status='approved' then auth.uid() else null end,version=version+1,updated_at=now() where id=target.id returning * into target;
 return target;
end $$;

create function public.rename_organization(org uuid,new_name text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_org_owner(org) then raise exception 'Only owners can rename the organization.'; end if;
 update public.organizations set name=trim(new_name) where id=org;
 perform public.record_audit(org,'organization.renamed',org,trim(new_name));
end $$;
create function public.revoke_invitation(org uuid,invitation_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare invite_email text;
begin
 if not public.is_org_owner(org) then raise exception 'Only owners can revoke invitations.'; end if;
 delete from public.invitations where id=invitation_id and organization_id=org and accepted_at is null returning email into invite_email;
 if invite_email is null then raise exception 'Invitation is unavailable or already accepted.'; end if;
 perform public.record_audit(org,'invitation.revoked',invitation_id,invite_email);
end $$;
create function public.leave_organization(org uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 if public.is_org_owner(org) then raise exception 'Owners cannot leave their organization.'; end if;
 perform public.record_audit(org,'member.left',auth.uid(),'Member left the organization.');
 delete from public.memberships where organization_id=org and user_id=auth.uid();
end $$;

create function public.transfer_ownership(org uuid,new_owner uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.organizations where id=org for update;
 if not public.is_org_owner(org) then raise exception 'Only owners can transfer organization ownership.'; end if;
 if new_owner=auth.uid() or not exists(select 1 from public.memberships where organization_id=org and user_id=new_owner) then raise exception 'Choose an existing organization member.'; end if;
 update public.memberships set role='owner' where organization_id=org and user_id=new_owner;
 update public.memberships set role='member' where organization_id=org and user_id=auth.uid();
 perform public.record_audit(org,'organization.ownership_transferred',new_owner,'Organization ownership transferred to a team member.');
end $$;

create function public.audit_membership() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then perform public.record_audit(old.organization_id,'member.removed',old.user_id,old.email);return old; end if;
 perform public.record_audit(new.organization_id,'member.joined',new.user_id,new.email);return new;
end $$;
revoke all on function public.audit_membership() from public,anon,authenticated;
create trigger audit_memberships after insert or delete on public.memberships for each row execute function public.audit_membership();

create or replace function public.create_invitation(org uuid,invite_email text,invite_token text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare new_id uuid;
begin
 if not public.is_org_owner(org) then raise exception 'Only owners can invite members.'; end if;
 perform 1 from public.organizations where id=org for update;
 if invite_email is null or length(trim(invite_email))>254 or trim(invite_email) not like '%@%.%' or invite_token is null or invite_token !~ '^[a-f0-9-]{72}$' then raise exception 'Invalid invitation.'; end if;
 if exists(select 1 from public.memberships where organization_id=org and lower(email)=lower(trim(invite_email))) then raise exception 'This email already belongs to an organization member.'; end if;
 if (select count(*) from public.memberships where organization_id=org)>=20 then raise exception 'Organization member limit reached.'; end if;
 if (select count(*) from public.invitations where organization_id=org and accepted_at is null and expires_at>now())>=30 then raise exception 'Too many pending invitations.'; end if;
 delete from public.invitations where organization_id=org and email=lower(trim(invite_email)) and accepted_at is null;
 insert into public.invitations(organization_id,email,token_hash,created_by) values(org,lower(trim(invite_email)),encode(sha256(convert_to(invite_token,'UTF8')),'hex'),auth.uid()) returning id into new_id;
 perform public.record_audit(org,'invitation.created',new_id,lower(trim(invite_email)));
end $$;

create or replace function public.reserve_ai(org uuid,purchase_id uuid,expected_version integer) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare ticket uuid; target public.purchases;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 select * into target from public.purchases p where p.id=purchase_id and p.organization_id=org and p.version=expected_version;
 if target.id is null then raise exception 'Save or reload your purchase before reviewing.'; end if;
 if target.status not in ('draft','review','rejected') then raise exception 'Reopen this approved or archived request before generating a new AI review.'; end if;
 if jsonb_array_length(target.quotes)<2 then raise exception 'Add at least two quotes before reviewing.'; end if;
 update public.ai_jobs set state='failed' where organization_id=org and state='reserved' and created_at<now()-interval '2 minutes';
 if exists(select 1 from public.ai_jobs j where j.purchase_id=target.id and state='reserved') then raise exception 'An AI review is already running for this request.'; end if;
 if (select count(*) from public.ai_jobs where organization_id=org and state<>'failed' and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))>=20 then raise exception 'This organization has used its 20 daily AI reviews. Resets at 00:00 UTC.'; end if;
 insert into public.ai_jobs(organization_id,purchase_id,purchase_version,requested_by) values(org,target.id,expected_version,auth.uid()) returning id into ticket;
 return ticket;
end $$;

create or replace function public.complete_ai(ticket uuid,expected_version integer,review_text text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.ai_jobs;
begin
 select * into job from public.ai_jobs where id=ticket and state='reserved' and created_at>now()-interval '2 minutes' for update;
 if job.id is null then return false; end if;
 perform 1 from public.memberships where organization_id=job.organization_id and user_id=job.requested_by for share;
 if not found or job.purchase_version<>expected_version or review_text is null or length(trim(review_text))=0 then update public.ai_jobs set state='failed' where id=ticket;return false; end if;
 update public.purchases set review=left(review_text,12000),version=version+1,updated_at=now() where id=job.purchase_id and organization_id=job.organization_id and version=expected_version and status in ('draft','review','rejected');
 if not found then update public.ai_jobs set state='failed' where id=ticket;return false; end if;
 update public.ai_jobs set state='completed' where id=ticket;
 return true;
end $$;

revoke all on function public.save_purchase(uuid,uuid,integer,text,jsonb,text),public.transition_purchase(uuid,uuid,integer,text,text),public.rename_organization(uuid,text),public.revoke_invitation(uuid,uuid),public.leave_organization(uuid) from public,anon,authenticated;
grant execute on function public.save_purchase(uuid,uuid,integer,text,jsonb,text),public.transition_purchase(uuid,uuid,integer,text,text),public.rename_organization(uuid,text),public.revoke_invitation(uuid,uuid),public.leave_organization(uuid) to authenticated;
revoke all on function public.transfer_ownership(uuid,uuid) from public,anon,authenticated;
grant execute on function public.transfer_ownership(uuid,uuid) to authenticated;

-- Included schema stage: 003_audit_cascade_guard.sql
create table public.schema_versions(version integer primary key,applied_at timestamptz not null default now());
alter table public.schema_versions enable row level security;
revoke all on public.schema_versions from public,anon,authenticated;
grant select on public.schema_versions to service_role;
insert into public.schema_versions(version) values(3);
-- A parent organization deletion must not create audit rows for its cascading child deletions.
create or replace function public.record_audit(org uuid,event_action text,event_record uuid,event_summary text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.organizations where id=org) then return; end if;
 insert into public.audit_events(organization_id,actor_id,actor_email,action,record_id,summary)
 values(org,auth.uid(),coalesce((select email from auth.users where id=auth.uid()),'System'),event_action,event_record,left(event_summary,500));
end $$;
revoke all on function public.record_audit(uuid,text,uuid,text) from public,anon,authenticated;

-- Billing and plan entitlements. New organizations begin with a 14-day Starter trial.
alter table public.organizations add column plan text not null default 'starter' check(plan in ('starter','pro'));
alter table public.organizations add column subscription_status text not null default 'trialing' check(subscription_status in ('trialing','active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'));
alter table public.organizations add column trial_ends_at timestamptz not null default now()+interval '14 days';
alter table public.organizations add column billing_period_end timestamptz;
alter table public.organizations add column stripe_customer_id text unique;
alter table public.organizations add column stripe_subscription_id text unique;
alter table public.organizations add column cancel_at_period_end boolean not null default false;
alter table public.organizations add column stripe_event_created bigint not null default 0;

create table public.stripe_events(
 id text primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from public,anon,authenticated;
grant all on public.stripe_events to service_role;
grant update(plan,subscription_status,trial_ends_at,billing_period_end,stripe_customer_id,stripe_subscription_id,cancel_at_period_end,stripe_event_created) on public.organizations to service_role;

create function public.billing_active(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.organizations o where o.id=org and (o.subscription_status='active' or (o.subscription_status='trialing' and coalesce(o.billing_period_end,o.trial_ends_at)>now())))
$$;
create function public.plan_limit(org uuid,feature text) returns integer language sql stable security definer set search_path=public,pg_temp as $$
 select case feature when 'members' then case plan when 'pro' then 20 else 3 end when 'purchases' then case plan when 'pro' then 500 else 50 end when 'ai_daily' then case plan when 'pro' then 50 else 10 end else 0 end from public.organizations where id=org
$$;

create or replace function public.save_purchase(org uuid,purchase_id uuid,expected_version integer,purchase_title text,quote_data jsonb,chosen text) returns public.purchases language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.purchases; result public.purchases;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 if not public.billing_active(org) then raise exception 'An active Starter or Pro plan is required to change purchase requests.'; end if;
 select * into existing from public.purchases where id=purchase_id and organization_id=org for update;
 if expected_version is null or expected_version<0 then raise exception 'Invalid purchase version.'; end if;
 if not public.validate_quotes(quote_data,chosen) then raise exception 'Invalid quotation data or monetary precision.'; end if;
 if existing.id is not null and existing.status not in ('draft','rejected') then raise exception 'Reopen this purchase as a draft before changing its quotations.'; end if;
 if expected_version=0 then
  if existing.id is not null then raise exception 'This purchase already exists. Reload before saving.'; end if;
  if (select count(*) from public.purchases where organization_id=org)>=public.plan_limit(org,'purchases') then raise exception 'This plan has reached its purchase request limit.'; end if;
  insert into public.purchases(id,organization_id,title,quotes,selected,created_by) values(purchase_id,org,purchase_title,quote_data,chosen,auth.uid()) returning * into result;
 else
  update public.purchases set title=purchase_title,quotes=quote_data,selected=chosen,review=case when quotes=quote_data and title=purchase_title then review else '' end,version=version+1,updated_at=now() where id=purchase_id and organization_id=org and version=expected_version returning * into result;
  if result.id is null then raise exception 'This purchase changed or is unavailable. Reload before saving.'; end if;
 end if;
 return result;
end $$;

create or replace function public.delete_purchase(org uuid,purchase_id uuid,expected_version integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.purchases;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 if not public.billing_active(org) then raise exception 'An active Starter or Pro plan is required to delete purchase requests.'; end if;
 select * into target from public.purchases where id=purchase_id and organization_id=org and version=expected_version for update;
 if target.id is null then raise exception 'This purchase changed or is unavailable. Reload before deleting.'; end if;
 if target.status not in ('draft','rejected') and not public.is_org_owner(org) then raise exception 'Only owners can delete submitted or approved requests.'; end if;
 if exists(select 1 from public.ai_jobs where public.ai_jobs.purchase_id=target.id and state='reserved' and created_at>now()-interval '2 minutes') then raise exception 'An AI review is already running. Retry after it finishes.'; end if;
 delete from public.purchases where id=target.id;
end $$;

create or replace function public.transition_purchase(org uuid,purchase_id uuid,expected_version integer,next_status text,note text) returns public.purchases language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.purchases; is_owner boolean;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 if not public.billing_active(org) then raise exception 'An active Starter or Pro plan is required to update purchase requests.'; end if;
 select * into target from public.purchases where id=purchase_id and organization_id=org and version=expected_version for update;
 if target.id is null then raise exception 'This purchase changed or is unavailable. Reload before updating its status.'; end if;
 is_owner:=public.is_org_owner(org);
 if next_status is null or next_status not in ('draft','review','approved','rejected','archived') or next_status=target.status or note is null or length(note)>2000 then raise exception 'Invalid status change.'; end if;
 if next_status in ('approved','rejected','archived') and not is_owner then raise exception 'Only owners can approve, reject, or archive requests.'; end if;
 if next_status in ('approved','rejected') and target.status<>'review' then raise exception 'Submit this request for review before recording a decision.'; end if;
 if next_status='review' and (target.status not in ('draft','rejected') or jsonb_array_length(target.quotes)<2 or target.selected='') then raise exception 'Save at least two quotes and shortlist a supplier before submitting for review.'; end if;
 if next_status='draft' and target.status in ('approved','archived') and not is_owner then raise exception 'Only owners can reopen approved or archived requests.'; end if;
 if next_status='rejected' and length(trim(note))=0 then raise exception 'Include a reason when requesting changes.'; end if;
 update public.purchases set status=next_status,decision_note=note,approved_at=case when next_status='approved' then now() else null end,approved_by=case when next_status='approved' then auth.uid() else null end,version=version+1,updated_at=now() where id=target.id returning * into target;
 return target;
end $$;

create or replace function public.create_invitation(org uuid,invite_email text,invite_token text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare new_id uuid;
begin
 if not public.is_org_owner(org) then raise exception 'Only owners can invite members.'; end if;
 perform 1 from public.organizations where id=org for update;
 if not public.billing_active(org) then raise exception 'An active Starter or Pro plan is required to invite members.'; end if;
 if invite_email is null or length(trim(invite_email))>254 or trim(invite_email) not like '%@%.%' or invite_token is null or invite_token !~ '^[a-f0-9-]{72}$' then raise exception 'Invalid invitation.'; end if;
 if exists(select 1 from public.memberships where organization_id=org and lower(email)=lower(trim(invite_email))) then raise exception 'This email already belongs to an organization member.'; end if;
 if (select count(*) from public.memberships where organization_id=org)>=public.plan_limit(org,'members') then raise exception 'This plan has reached its member limit.'; end if;
 if (select count(*) from public.invitations where organization_id=org and accepted_at is null and expires_at>now())>=30 then raise exception 'Too many pending invitations.'; end if;
 delete from public.invitations where organization_id=org and email=lower(trim(invite_email)) and accepted_at is null;
 insert into public.invitations(organization_id,email,token_hash,created_by) values(org,lower(trim(invite_email)),encode(sha256(convert_to(invite_token,'UTF8')),'hex'),auth.uid()) returning id into new_id;
 perform public.record_audit(org,'invitation.created',new_id,lower(trim(invite_email)));
end $$;

create or replace function public.accept_invitation(invite_token text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation public.invitations; account_email text;
begin
 select email into account_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if account_email is null then raise exception 'Sign in with your verified invited email address.'; end if;
 select * into invitation from public.invitations where token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') and expires_at>now() and accepted_at is null for update;
 if invitation.id is null or lower(account_email)<>invitation.email then raise exception 'Invitation expired, already accepted, or belongs to a different email.'; end if;
 perform 1 from public.organizations where id=invitation.organization_id for update;
 if not public.billing_active(invitation.organization_id) then raise exception 'This organization needs an active plan before new members can join.'; end if;
 if (select count(*) from public.memberships where organization_id=invitation.organization_id)>=public.plan_limit(invitation.organization_id,'members') then raise exception 'This plan has reached its member limit.'; end if;
 insert into public.memberships(organization_id,user_id,email,role) values(invitation.organization_id,auth.uid(),account_email,'member') on conflict do nothing;
 update public.invitations set accepted_at=now() where id=invitation.id;
 return invitation.organization_id;
end $$;

create or replace function public.reserve_ai(org uuid,purchase_id uuid,expected_version integer) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare ticket uuid; target public.purchases;
begin
 if not public.is_org_member(org) then raise exception 'Organization access denied.'; end if;
 perform 1 from public.organizations where id=org for update;
 if not public.billing_active(org) then raise exception 'An active Starter or Pro plan is required for AI reviews.'; end if;
 select * into target from public.purchases p where p.id=purchase_id and p.organization_id=org and p.version=expected_version;
 if target.id is null then raise exception 'Save or reload your purchase before reviewing.'; end if;
 if target.status not in ('draft','review','rejected') then raise exception 'Reopen this approved or archived request before generating a new AI review.'; end if;
 if jsonb_array_length(target.quotes)<2 then raise exception 'Add at least two quotes before reviewing.'; end if;
 update public.ai_jobs set state='failed' where organization_id=org and state='reserved' and created_at<now()-interval '2 minutes';
 if exists(select 1 from public.ai_jobs j where j.purchase_id=target.id and state='reserved') then raise exception 'An AI review is already running for this request.'; end if;
 if (select count(*) from public.ai_jobs where organization_id=org and state<>'failed' and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))>=public.plan_limit(org,'ai_daily') then raise exception 'This organization has used its daily AI reviews for its plan. Resets at 00:00 UTC.'; end if;
 insert into public.ai_jobs(organization_id,purchase_id,purchase_version,requested_by) values(org,target.id,expected_version,auth.uid()) returning id into ticket;
 return ticket;
end $$;

create function public.set_stripe_customer(org uuid,customer_id text) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result text;
begin
 if customer_id is null or customer_id !~ '^cus_[A-Za-z0-9]+$' then raise exception 'Invalid Stripe customer.'; end if;
 update public.organizations set stripe_customer_id=coalesce(stripe_customer_id,customer_id) where id=org returning stripe_customer_id into result;
 if result is null then raise exception 'Organization unavailable.'; end if;
 return result;
end $$;
create function public.apply_stripe_subscription(event_id text,event_created bigint,org uuid,customer_id text,subscription_id text,new_plan text,new_status text,period_end timestamptz,will_cancel boolean) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if event_id is null or event_id !~ '^evt_[A-Za-z0-9]+$' or event_created is null or event_created<1 or customer_id !~ '^cus_[A-Za-z0-9]+$' or subscription_id !~ '^sub_[A-Za-z0-9]+$' or new_plan not in ('starter','pro') or new_status not in ('trialing','active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused') then raise exception 'Invalid Stripe subscription event.'; end if;
 insert into public.stripe_events(id,organization_id) values(event_id,org) on conflict do nothing;
 if not found then return false; end if;
 perform 1 from public.organizations where id=org and (stripe_customer_id is null or stripe_customer_id=customer_id);
 if not found then raise exception 'Stripe customer does not match this organization.'; end if;
 update public.organizations set stripe_customer_id=customer_id,stripe_subscription_id=subscription_id,plan=new_plan,subscription_status=new_status,billing_period_end=period_end,cancel_at_period_end=coalesce(will_cancel,false),stripe_event_created=event_created where id=org and (stripe_customer_id is null or stripe_customer_id=customer_id) and stripe_event_created<=event_created;
 if not found then return false; end if;
 perform public.record_audit(org,'billing.subscription_updated',org,new_plan||' / '||new_status);
 return true;
end $$;

revoke all on function public.billing_active(uuid),public.plan_limit(uuid,text),public.set_stripe_customer(uuid,text),public.apply_stripe_subscription(text,bigint,uuid,text,text,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.billing_active(uuid),public.plan_limit(uuid,text) to authenticated;
grant execute on function public.set_stripe_customer(uuid,text),public.apply_stripe_subscription(text,bigint,uuid,text,text,text,text,timestamptz,boolean) to service_role;
insert into public.schema_versions(version) values(4);

notify pgrst,'reload schema';
commit;
