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

-- Keep the sequence ahead of rows inserted with explicit ids (the dashboard
-- does this), or the next insert collides on the primary key.
select setval(pg_get_serial_sequence('public.roles','id'),
              (select max(id) from public.roles));

-- 'banned' carries no keys: the member can still sign in, but every
-- capability check fails and they see nothing.
insert into public.roles (name) values ('volunteer'), ('board-member'), ('banned')
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

-- Note: this policy is replaced in section 5 once has_key() exists. Reading
-- the member list is a capability (manage-users), not an admin-only act.
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

-- 5. User administration -----------------------------------------------------

drop policy if exists "admins can read all users" on public.users;
drop policy if exists "user managers can read all users" on public.users;
create policy "user managers can read all users"
  on public.users for select
  using (public.has_key('manage-users'));

create table if not exists public.user_role_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  old_role_id integer references public.roles(id),
  new_role_id integer references public.roles(id),
  changed_by uuid references public.users(id),
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists user_role_changes_user_id_idx
  on public.user_role_changes (user_id, created_at desc);

alter table public.user_role_changes enable row level security;

drop policy if exists "user managers can read role history" on public.user_role_changes;
create policy "user managers can read role history"
  on public.user_role_changes for select
  using (public.has_key('manage-users'));

-- No INSERT/UPDATE/DELETE policies on the audit table. The only way to write
-- it is set_user_role(), which refuses to run without a comment -- that is
-- what makes the comment requirement real rather than a check the browser
-- could skip. There is likewise no UPDATE policy on public.users, so role
-- changes cannot bypass this function.

create or replace function public.set_user_role(
  target_user uuid,
  new_role text,
  change_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_new_role_id integer;
  v_old_role_id integer;
  v_exists      boolean;
begin
  if not public.has_key('manage-users') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  if change_comment is null or btrim(change_comment) = '' then
    raise exception 'A comment is required to change a role' using errcode = '22023';
  end if;

  -- Guard against lockout: with a single admin, self-banning would strand
  -- everyone. Someone else has to demote you.
  if target_user = v_actor then
    raise exception 'You cannot change your own role' using errcode = '22023';
  end if;

  select id into v_new_role_id from public.roles where name = new_role;
  if v_new_role_id is null then
    raise exception 'Unknown role: %', new_role using errcode = '22023';
  end if;

  select true, role_id into v_exists, v_old_role_id
  from public.users where id = target_user;

  if v_exists is not true then
    raise exception 'Unknown user' using errcode = '22023';
  end if;

  update public.users set role_id = v_new_role_id where id = target_user;

  insert into public.user_role_changes
    (user_id, old_role_id, new_role_id, changed_by, comment)
  values
    (target_user, v_old_role_id, v_new_role_id, v_actor, btrim(change_comment));
end;
$$;

revoke all on function public.set_user_role(uuid, text, text) from public;
grant execute on function public.set_user_role(uuid, text, text) to authenticated;
