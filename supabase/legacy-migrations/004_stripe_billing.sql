begin;
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
