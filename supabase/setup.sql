-- GSCRL site schema. Safe to re-run.
--
-- Roles: admin sees the leadership dashboard and the app; volunteer sees only
-- the app. Enforcement lives here in RLS, not in the pages -- a volunteer who
-- types the dashboard URL gets zero rows back, so there is nothing to render.

-- 1. Roles ------------------------------------------------------------------

insert into public.roles (name) values ('volunteer')
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

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

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

drop policy if exists "authenticated can read app content" on public.content;
create policy "authenticated can read app content"
  on public.content for select
  using (area = 'app' and auth.uid() is not null);

drop policy if exists "admins can read dashboard content" on public.content;
create policy "admins can read dashboard content"
  on public.content for select
  using (area = 'dashboard' and public.is_admin());

insert into public.content (area, title, body)
select * from (values
  ('app', 'Welcome to the GSCRL app', 'Test content. Visible to any signed-in member.'),
  ('dashboard', 'Leadership notes', 'Test content. Visible only to admins.')
) as v(area, title, body)
where not exists (select 1 from public.content);
