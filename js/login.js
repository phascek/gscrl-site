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

// Signup is temporary scaffolding: it exists only so the first admin account
// can be created. It is removed once the invite flow is in place, after which
// accounts are created by an admin and handed out as invite links.
const signupBtn = document.getElementById("signup-btn");
if (signupBtn) {
  signupBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    msgEl.textContent = "";
    // Confirmation links must land on a page that creates a Supabase client;
    // the site root has none, so a token arriving there is discarded.
    const { error } = await supabase.auth.signUp({
      email: emailEl.value,
      password: passEl.value,
      options: {
        emailRedirectTo: new URL("portal.html", window.location.href).href
      }
    });
    if (error) {
      errorEl.textContent = "Sign up failed: " + error.message;
    } else {
      msgEl.textContent = "Account created. Check your email to confirm, then log in.";
    }
  });
}

passEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("login-btn").click();
});
