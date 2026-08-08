-- GSCRL site schema. Safe to re-run.
--
-- Authorization model: the admin role implicitly holds every capability. All
-- other roles are granted named "keys". Nothing outside is_admin() ever
-- compares against a role name, so adding a role means granting keys, not
-- editing policies or pages.
--
-- Enforcement lives here in RLS, not in the pages: someone without the right
-- key who types a gated URL gets zero rows back, so there is nothing to render.
--
-- Section order matters -- functions must exist before the policies that call
-- them.

-- 1. Roles ------------------------------------------------------------------
-- Role ids come from a sequence and are NOT stable: volunteer was id 2 before
-- board-member was added, and is id 3 now. Always look roles up by name.

insert into public.roles (name) values ('volunteer'), ('board-member')
  on conflict (name) do nothing;

-- 2. Identity helpers --------------------------------------------------------
-- An earlier "admins can read all users" policy queried public.users from
-- inside a policy ON public.users, raising 42P17 infinite recursion and
-- breaking every read of the table, own-row reads included. SECURITY DEFINER
-- runs the lookup without RLS, so it cannot recurse.

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

-- Does this session have any role at all? Signup is open, so "authenticated"
-- alone would let a stranger who registered read member content.
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

-- anon needs EXECUTE on anything a policy may reference. Policies are
-- evaluated for every reader, so without the grant an anonymous query raises
-- 42501 instead of returning zero rows. These return only a boolean derived
-- from auth.uid(), which is null for anon, so nothing is exposed.
revoke all on function public.is_admin() from public;
revoke all on function public.has_role() from public;
grant execute on function public.is_admin() to authenticated, anon;
grant execute on function public.has_role() to authenticated, anon;

drop policy if exists "admins can read all users" on public.users;
create policy "admins can read all users"
  on public.users for select
  using (public.is_admin());

-- 3. Capability keys ---------------------------------------------------------

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

-- Admin implicitly holds every capability. Folding that in here is what lets
-- every other policy, function, and page stop caring about role names.
create or replace function public.has_key(key_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.users u
    join public.role_keys rk on rk.role_id = u.role_id
    join public.keys k on k.id = rk.key_id
    where u.id = auth.uid()
      and k.name = key_name
  );
$$;

-- Every capability the current user holds, for rendering the UI in one call.
-- Admin lists all of them, so the UI needs no special case either.
create or replace function public.my_keys()
returns setof text
language sql
security definer
stable
set search_path = public
as $$
  select k.name
  from public.keys k
  where public.is_admin()
     or exists (
       select 1
       from public.users u
       join public.role_keys rk on rk.role_id = u.role_id
       where u.id = auth.uid()
         and rk.key_id = k.id
     );
$$;

revoke all on function public.has_key(text) from public;
revoke all on function public.my_keys() from public;
grant execute on function public.has_key(text) to authenticated, anon;
grant execute on function public.my_keys() to authenticated, anon;

insert into public.keys (name, description) values
  ('manage-users',   'Invite members and assign their roles'),
  ('view-dashboard', 'Read the leadership dashboard'),
  ('view-app',       'Read the GSCRL app')
on conflict (name) do nothing;

-- board-member: leadership dashboard plus the app. volunteer: app only.
-- admin deliberately gets no rows here; is_admin() covers it.
insert into public.role_keys (role_id, key_id)
select r.id, k.id from public.roles r, public.keys k
where (r.name = 'board-member' and k.name in ('view-dashboard', 'view-app'))
   or (r.name = 'volunteer'    and k.name in ('view-app'))
on conflict do nothing;

-- 4. Content -----------------------------------------------------------------

create table if not exists public.content (
  id bigint generated always as identity primary key,
  area text not null check (area in ('app', 'dashboard')),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.content enable row level security;

-- Read access is decided by capability. There are deliberately no INSERT,
-- UPDATE or DELETE policies: with RLS on, that denies all writes through the
-- API, so content is added via the Supabase table editor for now.
drop policy if exists "authenticated can read app content" on public.content;
drop policy if exists "members with a role can read app content" on public.content;
drop policy if exists "can read app content with key" on public.content;
create policy "can read app content with key"
  on public.content for select
  using (area = 'app' and public.has_key('view-app'));

drop policy if exists "admins can read dashboard content" on public.content;
drop policy if exists "can read dashboard content with key" on public.content;
create policy "can read dashboard content with key"
  on public.content for select
  using (area = 'dashboard' and public.has_key('view-dashboard'));

insert into public.content (area, title, body)
select * from (values
  ('app', 'Welcome to the GSCRL app', 'Test content. Visible to anyone holding view-app.'),
  ('dashboard', 'Leadership notes', 'Test content. Visible to anyone holding view-dashboard.')
) as v(area, title, body)
where not exists (select 1 from public.content);
