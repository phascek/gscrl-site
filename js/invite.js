import { client, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = client();

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const emailEl = document.getElementById("email");
const roleEl = document.getElementById("role");
const btn = document.getElementById("invite-btn");
const errorEl = document.getElementById("error");
const msgEl = document.getElementById("msg");

async function init() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "../error.html";
    return;
  }

  // Hide the form from anyone without the capability. This is courtesy only --
  // the Edge Function re-checks the key server-side, so hiding the page is not
  // what enforces access.
  const { data: keys, error: keysErr } = await supabase.rpc("my_keys");

  if (keysErr || !Array.isArray(keys) || !keys.includes("manage-users")) {
    window.location.href = "../error.html";
    return;
  }

  // Populate roles from the table rather than hardcoding them here.
  const { data: roles } = await supabase.from("roles").select("name").order("id");
  for (const r of roles ?? []) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = r.name;
    roleEl.append(opt);
  }

  loadingEl.style.display = "none";
  contentEl.style.display = "block";
}

btn.addEventListener("click", async () => {
  errorEl.textContent = "";
  msgEl.textContent = "";
  btn.disabled = true;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "../error.html";
      return;
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email: emailEl.value, role: roleEl.value }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      errorEl.textContent = body.error || `Invite failed (${res.status})`;
      return;
    }

    msgEl.textContent = `Invite emailed to ${body.email} as ${body.role}.`;
    emailEl.value = "";
  } catch (e) {
    errorEl.textContent = "Invite failed: " + e.message;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "../";
});

init();
