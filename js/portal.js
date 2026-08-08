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

  if (role === "admin") {
    document.getElementById("link-dashboard").style.display = "block";
    document.getElementById("link-app").style.display = "block";
    document.getElementById("link-invite").style.display = "block";
  } else if (role === "volunteer") {
    document.getElementById("link-app").style.display = "block";
  } else {
    document.getElementById("norole").style.display = "block";
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
});

init();
