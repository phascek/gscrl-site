import { renderArea } from "./gated.js";

const supabase = await renderArea("app");

// Capability-driven navigation: ask the database what this member can do
// rather than checking their role name here. A new role that carries
// manage-users picks the link up with no change to this file.
if (supabase) {
  const { data: keys, error } = await supabase.rpc("my_keys");

  if (!error && Array.isArray(keys) && keys.includes("manage-users")) {
    document.getElementById("link-manage-users").style.display = "inline-block";
  }
}
