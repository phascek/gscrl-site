// Invite endpoint, restricted to callers holding the manage-users key.
//
// Creating a user requires the service role key, which can never ship in a
// static page -- hence this function. It re-checks the caller's capability
// server-side rather than trusting the browser.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE_URL = "https://phascek.github.io/gscrl-site";
const ALLOWED_ORIGIN = "https://phascek.github.io";
const REQUIRED_KEY = "manage-users";
const DEFAULT_ROLE = "volunteer";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Identify the caller from their bearer token.
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!jwt) return json({ error: "Not signed in" }, 401);

  const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !user) return json({ error: "Not signed in" }, 401);

  // 2. Confirm the caller holds the manage-users key. Never trust the page.
  // Admin is a superuser role and carries no role_keys rows, mirroring what
  // has_key() does in SQL.
  const { data: callerRow } = await admin
    .from("users")
    .select("role_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!callerRow?.role_id) return json({ error: "Not permitted" }, 403);

  const { data: callerRole } = await admin
    .from("roles")
    .select("name")
    .eq("id", callerRow.role_id)
    .maybeSingle();

  let permitted = callerRole?.name === "admin";

  if (!permitted) {
    const { data: keyRow } = await admin
      .from("role_keys")
      .select("key_id, keys!inner(name)")
      .eq("role_id", callerRow.role_id)
      .eq("keys.name", REQUIRED_KEY)
      .maybeSingle();
    permitted = !!keyRow;
  }

  if (!permitted) return json({ error: "Not permitted" }, 403);

  // 3. Validate input. Roles are read from the table rather than hardcoded,
  // so adding a role does not require redeploying this function.
  let body: { email?: string; role?: string; comment?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const role = (body.role ?? "").trim() || DEFAULT_ROLE;
  const comment = (body.comment ?? "").trim() || `Invited as ${role}`;

  if (!email || !email.includes("@")) return json({ error: "A valid email is required" }, 400);

  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", role)
    .maybeSingle();

  if (!roleRow) return json({ error: "Unknown role" }, 400);

  // 4. Send the invite. Supabase mints a one-time, expiring token and mails it.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${SITE_URL}/set-password.html` },
  );

  if (inviteErr || !invited?.user) {
    return json({ error: inviteErr?.message ?? "Invite failed" }, 400);
  }

  // 5. Pre-assign the role so the member has access the moment they arrive.
  const { error: roleErr } = await admin
    .from("users")
    .upsert({ id: invited.user.id, email, role_id: roleRow.id }, { onConflict: "id" });

  if (roleErr) {
    return json({
      error: `Invite sent, but assigning the role failed: ${roleErr.message}`,
    }, 500);
  }

  // 6. Record the invite in the same audit trail as later role changes, so an
  // account's history starts at creation rather than at its first edit.
  await admin.from("user_role_changes").insert({
    user_id: invited.user.id,
    old_role_id: null,
    new_role_id: roleRow.id,
    changed_by: user.id,
    comment,
  });

  return json({ ok: true, email, role });
});
