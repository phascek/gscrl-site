import { client } from "./config.js";

const supabase = client();

const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const errorEl = document.getElementById("error");
const msgEl = document.getElementById("msg");

document.getElementById("login-btn").addEventListener("click", async () => {
  errorEl.textContent = "";
  msgEl.textContent = "";
  const { error } = await supabase.auth.signInWithPassword({
    email: emailEl.value,
    password: passEl.value
  });
  if (error) {
    errorEl.textContent = "Login failed: " + error.message;
  } else {
    window.location.href = "portal.html";
  }
});

// Self-service signup is deliberately gone. Accounts are created by an admin
// through app/invite.html, which sends a one-time Supabase invite link; the
// member sets their password on set-password.html.

passEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("login-btn").click();
});
