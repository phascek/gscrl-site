// Turns the public homepage into the whole app: the left sidebar carries both
// the public nav and the auth panel, and protected content renders into the
// right-hand pane instead of navigating to another page.
//
// Nothing here is a security control. Every link and pane below is decided by
// my_keys(), but the database enforces the same rules independently -- someone
// who unhides a link still gets zero rows back.

import { client } from "./config.js";

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
const navManage = el("nav-manage");
const allMemberNav = [membersHeading, navDashboard, navApp, navManage];

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

// ---------------------------------------------------------------- rendering

function renderItems(title, rows) {
  pane.replaceChildren();

  const h = document.createElement("h2");
  h.textContent = title;
  pane.append(h);

  if (!rows || rows.length === 0) {
    const p = document.createElement("p");
    p.className = "member-note";
    p.textContent = "There is nothing here yet.";
    pane.append(p);
  } else {
    for (const row of rows) {
      const div = document.createElement("div");
      div.className = "member-item";
      const h3 = document.createElement("h3");
      h3.textContent = row.title;
      const p = document.createElement("p");
      p.textContent = row.body;
      div.append(h3, p);
      pane.append(div);
    }
  }

  const back = document.createElement("a");
  back.href = "#";
  back.textContent = "← Back to the public site";
  back.addEventListener("click", (e) => {
    e.preventDefault();
    showPublic();
  });
  pane.append(back);
}

// Landing shown in the right pane immediately after signing in, so logging in
// visibly goes somewhere instead of leaving the public page up.
function renderMembersLanding(email, held) {
  pane.replaceChildren();

  const h = document.createElement("h2");
  h.textContent = "Members Area";
  pane.append(h);

  const who = document.createElement("p");
  who.className = "member-note";
  who.textContent = `Signed in as ${email}.`;
  pane.append(who);

  const areas = [
    { key: "view-dashboard", area: "dashboard", label: "Leadership Dashboard", note: "Board and leadership material." },
    { key: "view-app", area: "app", label: "GSCRL App", note: "Open to all signed-in members." },
  ].filter((a) => held.includes(a.key));

  if (areas.length === 0) {
    const p = document.createElement("p");
    p.textContent =
      "Your account does not have access to anything yet. An admin needs to grant your role the right permissions.";
    pane.append(p);
    return;
  }

  const intro = document.createElement("p");
  intro.textContent = "Choose an area from the menu on the left, or pick one here:";
  pane.append(intro);

  for (const a of areas) {
    const div = document.createElement("div");
    div.className = "member-item";
    const h3 = document.createElement("h3");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = a.label;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openArea(a.area, a.label);
    });
    h3.append(link);
    const p = document.createElement("p");
    p.textContent = a.note;
    div.append(h3, p);
    pane.append(div);
  }

  if (held.includes("manage-users")) {
    const div = document.createElement("div");
    div.className = "member-item";
    const h3 = document.createElement("h3");
    const link = document.createElement("a");
    link.href = "app/manage-users.html";
    link.textContent = "Manage Users";
    h3.append(link);
    const p = document.createElement("p");
    p.textContent = "Invite members and change roles.";
    div.append(h3, p);
    pane.append(div);
  }
}

async function openArea(area, title) {
  const { data, error } = await supabase
    .from("content")
    .select("id, title, body")
    .eq("area", area)
    .order("id");

  showPane();

  if (error) {
    renderItems(title, []);
    return;
  }
  renderItems(title, data);
}

// ------------------------------------------------------------------- state

async function applySession(session) {
  sideError.textContent = "";

  if (!session) {
    setVisible(authLink, true);
    setVisible(loginPanel, false);
    setVisible(signedIn, false);
    for (const node of allMemberNav) setVisible(node, false);
    showPublic();
    return;
  }

  setVisible(authLink, false);
  setVisible(loginPanel, false);
  setVisible(signedIn, true);
  whoami.textContent = session.user.email;

  const { data: keys } = await supabase.rpc("my_keys");
  const held = Array.isArray(keys) ? keys : [];

  const canDashboard = held.includes("view-dashboard");
  const canApp = held.includes("view-app");
  const canManage = held.includes("manage-users");

  setVisible(navDashboard, canDashboard);
  // Manage Users lives under GSCRL App, so the parent has to be present for
  // the child to be reachable even if this member only holds manage-users.
  setVisible(navApp, canApp || canManage);
  setVisible(navManage, canManage);
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
  renderMembersLanding(data.session.user.email, held ?? []);
  showPane();
});

el("side-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("side-login-btn").click();
});

el("side-logout").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  await applySession(null);
});

// Manage Users is still its own page, so only the data-area links are wired.
for (const link of document.querySelectorAll("#sidebar nav a[data-area]")) {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    openArea(link.dataset.area, link.textContent.trim());
  });
}

// -------------------------------------------------------------------- init

const { data: { session } } = await supabase.auth.getSession();
await applySession(session);
