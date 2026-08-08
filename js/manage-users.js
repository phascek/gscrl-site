// Standalone Manage Users page. Kept as a direct-URL fallback; the primary
// route is the GSCRL App view dropdown on the homepage. Both render the same
// module so they cannot drift apart.

import { client } from "./config.js";
import { renderManageUsers } from "./manage-users-view.js";

const supabase = client();

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const rootEl = document.getElementById("mu-root");

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "../";
});

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "../error.html";
    return;
  }

  // Courtesy gate only. set_user_role() and the Edge Function both re-check
  // the manage-users key server-side, so hiding this page is not the control.
  const { data: keys, error } = await supabase.rpc("my_keys");
  if (error || !Array.isArray(keys) || !keys.includes("manage-users")) {
    window.location.href = "../error.html";
    return;
  }

  await renderManageUsers(supabase, rootEl, session.user.id);

  loadingEl.style.display = "none";
  contentEl.style.display = "block";
}

init();
