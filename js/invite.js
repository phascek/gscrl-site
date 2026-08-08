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

  // Hide the form from non-admins. This is courtesy only -- the Edge Function
  // re-checks the role server-side, so hiding it is not what enforces access.
  const { data: row } = await supabase
    .from("users")
    .select("roles(name)")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!row || !row.roles || row.roles.name !== "admin") {
    window.location.href = "../error.html";
    return;
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
