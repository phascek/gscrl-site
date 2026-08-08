import { client } from "./config.js";

const supabase = client();

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const whoamiEl = document.getElementById("whoami");

async function readOwnRow(userId) {
  return await supabase
    .from("users")
    .select("id, email, role_id, roles(name)")
    .eq("id", userId)
    .maybeSingle();
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "error.html";
    return;
  }

  let { data: userRow, error } = await readOwnRow(session.user.id);

  if (!userRow && !error) {
    await supabase
      .from("users")
      .insert({ id: session.user.id, email: session.user.email });
    ({ data: userRow, error } = await readOwnRow(session.user.id));
  }

  loadingEl.style.display = "none";
  contentEl.style.display = "block";

  if (error) {
    whoamiEl.textContent = "Could not read your account: " + error.message;
    return;
  }

  const role = userRow && userRow.roles ? userRow.roles.name : null;
  whoamiEl.textContent = session.user.email + (role ? " — " + role : " — no role");

  // Navigation is driven entirely by capabilities. Admin is not special-cased
  // here: is_admin() inside has_key()/my_keys() already grants every key, so
  // this file never compares against a role name.
  const { data: keys } = await supabase.rpc("my_keys");
  const has = (k) => Array.isArray(keys) && keys.includes(k);

  if (has("view-dashboard")) {
    document.getElementById("link-dashboard").style.display = "block";
  }
  if (has("view-app")) {
    document.getElementById("link-app").style.display = "block";
  }
  if (!has("view-dashboard") && !has("view-app")) {
    document.getElementById("norole").style.display = "block";
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
});

init();
