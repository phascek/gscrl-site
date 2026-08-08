-- GSCRL site schema. Safe to re-run.
--
-- Roles: admin sees the leadership dashboard and the app; volunteer sees only
-- the app. Enforcement lives here in RLS, not in the pages -- a volunteer who
-- types the dashboard URL gets zero rows back, so there is nothing to render.

-- 1. Roles ------------------------------------------------------------------
-- Role ids are assigned by the sequence and are NOT stable across rebuilds --
-- volunteer was id 2 before board-member was added, and is id 3 now. Always
-- look roles up by name.

insert into public.roles (name) values ('volunteer'), ('board-member')
  on conflict (name) do nothing;

-- 2. Non-recursive admin check ----------------------------------------------
-- The previous "admins can read all users" policy queried public.users from
-- inside a policy ON public.users, which raises 42P17 infinite recursion and
-- broke every read of the table, including a user reading their own row.
-- SECURITY DEFINER runs the lookup without RLS, so it cannot recurse.

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.roles r on r.id = u.role_id
    where u.id = auth.uid()
      and r.name = 'admin'
  );
$$;

-- anon needs EXECUTE too. Policies referencing is_admin() are evaluated for
-- every reader, so without the grant an anonymous query raises 42501 instead
-- of returning zero rows. The function only returns a boolean derived from
-- auth.uid(), which is null for anon, so this exposes nothing.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

drop policy if exists "admins can read all users" on public.users;
create policy "admins can read all users"
  on public.users for select
  using (public.is_admin());

-- 3. Test content -----------------------------------------------------------

create table if not exists public.content (
  id bigint generated always as identity primary key,
  area text not null check (area in ('app', 'dashboard')),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.content enable row level security;

-- App content requires an assigned role, not merely a session. Signup is open
-- to the public, so "authenticated" alone would let any stranger who
-- registered read member content. With this, a new signup lands on the portal
-- with no role and sees nothing until an admin grants one.

create or replace function public.has_role()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role_id is not null
  );
$$;

revoke all on function public.has_role() from public;
grant execute on function public.has_role() to authenticated, anon;

drop policy if exists "authenticated can read app content" on public.content;
drop policy if exists "members with a role can read app content" on public.content;
create policy "members with a role can read app content"
  on public.content for select
  using (area = 'app' and public.has_role());

drop policy if exists "admins can read dashboard content" on public.content;
create policy "admins can read dashboard content"
  on public.content for select
  using (area = 'dashboard' and public.is_admin());

-- 4. Capability keys --------------------------------------------------------
-- Named capabilities attached to roles. Checking a capability beats checking a
-- role name: adding a role no longer means hunting down every comparison
-- against 'admin'.

create table if not exists public.keys (
  id bigint generated always as identity primary key,
  name text not null unique,
  description text
);

create table if not exists public.role_keys (
  role_id integer not null references public.roles(id) on delete cascade,
  key_id bigint not null references public.keys(id) on delete cascade,
  primary key (role_id, key_id)
);

alter table public.keys enable row level security;
alter table public.role_keys enable row level security;

drop policy if exists "members with a role can read keys" on public.keys;
create policy "members with a role can read keys"
  on public.keys for select using (public.has_role());

drop policy if exists "members with a role can read role_keys" on public.role_keys;
create policy "members with a role can read role_keys"
  on public.role_keys for select using (public.has_role());

create or replace function public.has_key(key_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.role_keys rk on rk.role_id = u.role_id
    join public.keys k on k.id = rk.key_id
    where u.id = auth.uid()
      and k.name = key_name
  );
$$;

-- Every capability the current user holds, for rendering the UI in one call.
create or replace function public.my_keys()
returns setof text
language sql
security definer
stable
set search_path = public
as $$
  select k.name
  from public.users u
  join public.role_keys rk on rk.role_id = u.role_id
  join public.keys k on k.id = rk.key_id
  where u.id = auth.uid();
$$;

revoke all on function public.has_key(text) from public;
revoke all on function public.my_keys() from public;
grant execute on function public.has_key(text) to authenticated, anon;
grant execute on function public.my_keys() to authenticated, anon;

insert into public.keys (name, description)
values ('manage-users', 'Invite members and assign their roles')
on conflict (name) do nothing;

insert into public.role_keys (role_id, key_id)
select r.id, k.id
from public.roles r, public.keys k
where r.name = 'admin' and k.name = 'manage-users'
on conflict do nothing;

-- 5. Test content -----------------------------------------------------------

insert into public.content (area, title, body)
select * from (values
  ('app', 'Welcome to the GSCRL app', 'Test content. Visible to any signed-in member.'),
  ('dashboard', 'Leadership notes', 'Test content. Visible only to admins.')
) as v(area, title, body)
where not exists (select 1 from public.content);
