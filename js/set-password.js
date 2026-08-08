import { client } from "./config.js";

const supabase = client();

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const passEl = document.getElementById("password");
const confirmEl = document.getElementById("confirm");
const btn = document.getElementById("save-btn");
const errorEl = document.getElementById("error");

// The invite link hands us a session. Depending on the auth flow that arrives
// either as a hash fragment (handled automatically by detectSessionInUrl) or
// as a ?code= query param that has to be exchanged explicitly, so handle both.
async function sessionFromInvite() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("code")) {
    await supabase.auth.exchangeCodeForSession(window.location.href);
  }
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

async function init() {
  const session = await sessionFromInvite();

  if (!session) {
    // No valid invite token: expired, already used, or opened directly.
    window.location.href = "error.html";
    return;
  }

  loadingEl.style.display = "none";
  contentEl.style.display = "block";
}

btn.addEventListener("click", async () => {
  errorEl.textContent = "";

  if (passEl.value.length < 8) {
    errorEl.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (passEl.value !== confirmEl.value) {
    errorEl.textContent = "The two passwords do not match.";
    return;
  }

  btn.disabled = true;
  const { error } = await supabase.auth.updateUser({ password: passEl.value });
  btn.disabled = false;

  if (error) {
    errorEl.textContent = "Could not set password: " + error.message;
    return;
  }

  window.location.href = "portal.html";
});

confirmEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btn.click();
});

init();
