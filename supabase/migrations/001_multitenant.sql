begin;

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
notify pgrst,'reload schema';
commit;
