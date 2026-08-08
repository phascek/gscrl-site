// Turns the public homepage into the whole app: the left sidebar carries both
// the public nav and the auth panel, and protected content renders into the
// right-hand pane instead of navigating to another page.
//
// Nothing here is a security control. Every link, dropdown option and pane
// below is chosen from my_keys(), but the database enforces the same rules
// independently: content reads go through RLS, role changes through
// set_user_role(), and invites through an Edge Function that re-checks the
// manage-users key. Unhiding anything in the DOM yields no data.

import { client } from "./config.js";
import { renderManageUsers } from "./manage-users-view.js";

const supabase = client();

const el = (id) => document.getElementById(id);

const authLink = el("auth-link");
const loginPanel = el("login-panel");
const signedIn = el("signed-in");
const whoami = el("whoami");
const sideError = el("side-error");

const membersHeading = el("members-heading");
const navDashboard = el("nav-dashboard");
const navApp = el("nav-app");
const allMemberNav = [membersHeading, navDashboard, navApp];

// Capabilities for the current session, refreshed on every sign-in/out.
let heldKeys = [];

// The right-hand pane, created next to the template's public sections.
const wrapper = document.getElementById("wrapper");
const pane = document.createElement("div");
pane.id = "member-content";
if (wrapper) wrapper.prepend(pane);

function publicSections() {
  if (!wrapper) return [];
  return Array.from(wrapper.children).filter((c) => c !== pane);
}

function showPublic() {
  pane.classList.remove("visible");
  for (const s of publicSections()) s.style.display = "";
}

function showPane() {
  for (const s of publicSections()) s.style.display = "none";
  pane.classList.add("visible");
  window.scrollTo(0, 0);
}

function setVisible(node, on) {
  if (!node) return;
  node.classList.toggle("visible", on);
  if (node === authLink) node.style.display = on ? "block" : "none";
}

function backLink() {
  const a = document.createElement("a");
  a.href = "#";
  a.className = "pane-back";
  a.textContent = "← Back to the public site";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    showPublic();
  });
  return a;
}

// ---------------------------------------------------------------- rendering

async function fetchArea(area) {
  const { data, error } = await supabase
    .from("content")
    .select("id, title, body")
    .eq("area", area)
    .order("id");
  return error ? [] : (data ?? []);
}

function renderList(container, rows) {
  container.replaceChildren();

  if (!rows || rows.length === 0) {
    const p = document.createElement("p");
    p.className = "member-note";
    p.textContent = "There is nothing here yet.";
    container.append(p);
    return;
  }

  for (const row of rows) {
    const div = document.createElement("div");
    div.className = "member-item";
    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    const p = document.createElement("p");
    p.textContent = row.body;
    div.append(h3, p);
    container.append(div);
  }
}

async function openDashboard() {
  showPane();
  pane.replaceChildren();

  const header = document.createElement("div");
  header.className = "pane-header";
  const h2 = document.createElement("h2");
  h2.textContent = "Leadership Dashboard";
  header.append(h2);

  const body = document.createElement("div");
  pane.append(header, body, backLink());

  renderList(body, await fetchArea("dashboard"));
}

// The app gets its own header with a view dropdown. Manage Users is an option
// there rather than a sidebar entry, and appears only for members holding the
// manage-users key -- which the server checks again on every call it makes.
async function openApp(initialView = "home") {
  showPane();
  pane.replaceChildren();

  const canManage = heldKeys.includes("manage-users");

  const header = document.createElement("div");
  header.className = "pane-header";

  const h2 = document.createElement("h2");
  h2.textContent = "GSCRL App";

  const select = document.createElement("select");
  select.id = "app-view";
  select.className = "pane-select";
  select.append(new Option("Home", "home"));
  if (canManage) select.append(new Option("Manage Users", "manage-users"));

  header.append(h2, select);

  const body = document.createElement("div");
  body.id = "app-body";

  pane.append(header, body, backLink());

  async function show(view) {
    body.replaceChildren();

    if (view === "manage-users" && canManage) {
      const { data: { session } } = await supabase.auth.getSession();
      await renderManageUsers(supabase, body, session ? session.user.id : null);
      return;
    }

    renderList(body, await fetchArea("app"));
  }

  select.addEventListener("change", () => show(select.value));

  const start = initialView === "manage-users" && canManage ? "manage-users" : "home";
  select.value = start;
  await show(start);
}

// Landing shown in the right pane immediately after signing in, so logging in
// visibly goes somewhere instead of leaving the public page up.
function renderMembersLanding(email, held) {
  showPane();
  pane.replaceChildren();

  const header = document.createElement("div");
  header.className = "pane-header";
  const h2 = document.createElement("h2");
  h2.textContent = "Members Area";
  header.append(h2);
  pane.append(header);

  const who = document.createElement("p");
  who.className = "member-note";
  who.textContent = `Signed in as ${email}.`;
  pane.append(who);

  const cards = [];
  if (held.includes("view-dashboard")) {
    cards.push({ label: "Leadership Dashboard", note: "Board and leadership material.", open: openDashboard });
  }
  if (held.includes("view-app")) {
    cards.push({ label: "GSCRL App", note: "Open to all signed-in members.", open: () => openApp("home") });
  }
  if (held.includes("manage-users")) {
    cards.push({ label: "Manage Users", note: "Invite members and change roles, inside the app.", open: () => openApp("manage-users") });
  }

  if (cards.length === 0) {
    const p = document.createElement("p");
    p.textContent =
      "Your account does not have access to anything yet. An admin needs to grant your role the right permissions.";
    pane.append(p);
    pane.append(backLink());
    return;
  }

  for (const c of cards) {
    const div = document.createElement("div");
    div.className = "member-item";
    const h3 = document.createElement("h3");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = c.label;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      c.open();
    });
    h3.append(link);
    const p = document.createElement("p");
    p.textContent = c.note;
    div.append(h3, p);
    pane.append(div);
  }

  pane.append(backLink());
}

// ------------------------------------------------------------------- state

async function applySession(session) {
  sideError.textContent = "";

  if (!session) {
    heldKeys = [];
    setVisible(authLink, true);
    setVisible(loginPanel, false);
    setVisible(signedIn, false);
    for (const node of allMemberNav) setVisible(node, false);
    showPublic();
    return [];
  }

  setVisible(authLink, false);
  setVisible(loginPanel, false);
  setVisible(signedIn, true);
  whoami.textContent = session.user.email;

  const { data: keys } = await supabase.rpc("my_keys");
  const held = Array.isArray(keys) ? keys : [];
  heldKeys = held;

  const canDashboard = held.includes("view-dashboard");
  const canApp = held.includes("view-app");
  const canManage = held.includes("manage-users");

  setVisible(navDashboard, canDashboard);
  // Manage Users is reached from inside the app, so the app entry has to show
  // for a member holding manage-users even without view-app.
  setVisible(navApp, canApp || canManage);
  setVisible(membersHeading, canDashboard || canApp || canManage);

  return held;
}

// ------------------------------------------------------------------ events

el("show-login").addEventListener("click", (e) => {
  e.preventDefault();
  setVisible(authLink, false);
  setVisible(loginPanel, true);
  el("side-email").focus();
});

el("cancel-login").addEventListener("click", (e) => {
  e.preventDefault();
  sideError.textContent = "";
  setVisible(loginPanel, false);
  setVisible(authLink, true);
});

el("side-login-btn").addEventListener("click", async () => {
  sideError.textContent = "";
  const btn = el("side-login-btn");
  btn.disabled = true;

  const { data, error } = await supabase.auth.signInWithPassword({
    email: el("side-email").value,
    password: el("side-password").value,
  });

  btn.disabled = false;

  if (error) {
    sideError.textContent = error.message;
    return;
  }

  el("side-password").value = "";
  const held = await applySession(data.session);
  renderMembersLanding(data.session.user.email, held);
});

el("side-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("side-login-btn").click();
});

el("side-logout").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  await applySession(null);
});

for (const link of document.querySelectorAll("#sidebar nav a[data-area]")) {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    if (link.dataset.area === "dashboard") openDashboard();
    else openApp("home");
  });
}

// -------------------------------------------------------------------- init

const { data: { session } } = await supabase.auth.getSession();
await applySession(session);
