import { client, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = client();

const DEFAULT_ROLE = "volunteer";

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const rowsEl = document.getElementById("user-rows");
const countEl = document.getElementById("count");
const errorEl = document.getElementById("error");
const msgEl = document.getElementById("msg");
const filterEl = document.getElementById("filter");
const roleFilterEl = document.getElementById("role-filter");
const sortEl = document.getElementById("sort");
const newRoleEl = document.getElementById("new-role");

let roles = [];
let users = [];
let meId = null;

function roleName(u) {
  return u.roles ? u.roles.name : null;
}

async function loadRoles() {
  const { data } = await supabase.from("roles").select("id, name").order("id");
  roles = data ?? [];

  for (const r of roles) {
    const a = document.createElement("option");
    a.value = r.name;
    a.textContent = r.name;
    if (r.name === DEFAULT_ROLE) a.selected = true;
    newRoleEl.append(a);

    const b = document.createElement("option");
    b.value = r.name;
    b.textContent = r.name;
    roleFilterEl.append(b);
  }
}

async function loadUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, created_at, role_id, roles(name)");

  if (error) {
    errorEl.textContent = "Could not load members: " + error.message;
    users = [];
    return;
  }
  users = data ?? [];
}

function visibleUsers() {
  const needle = filterEl.value.trim().toLowerCase();
  const wantRole = roleFilterEl.value;

  let list = users.filter((u) => {
    const matchesText = !needle || (u.email ?? "").toLowerCase().includes(needle);
    const matchesRole = !wantRole || roleName(u) === wantRole;
    return matchesText && matchesRole;
  });

  const by = sortEl.value;
  list = list.slice().sort((a, b) => {
    if (by === "email") return (a.email ?? "").localeCompare(b.email ?? "");
    if (by === "role") {
      return (roleName(a) ?? "~").localeCompare(roleName(b) ?? "~") ||
             (a.email ?? "").localeCompare(b.email ?? "");
    }
    const at = new Date(a.created_at ?? 0).getTime();
    const bt = new Date(b.created_at ?? 0).getTime();
    return by === "newest" ? bt - at : at - bt;
  });

  return list;
}

function render() {
  rowsEl.replaceChildren();
  const list = visibleUsers();

  for (const u of list) {
    const tr = document.createElement("tr");

    const tdEmail = document.createElement("td");
    tdEmail.textContent = u.email ?? "(no email)";

    const tdRole = document.createElement("td");
    const current = roleName(u);
    tdRole.textContent = current ?? "no role";
    if (current === "banned") tdRole.className = "banned";

    const tdAdded = document.createElement("td");
    tdAdded.textContent = u.created_at
      ? new Date(u.created_at).toLocaleDateString()
      : "—";

    const tdActions = document.createElement("td");
    tdActions.className = "actions";

    if (u.id === meId) {
      const note = document.createElement("span");
      note.className = "muted";
      note.textContent = "That's you — someone else must change your role.";
      tdActions.append(note);
    } else {
      const sel = document.createElement("select");
      for (const r of roles) {
        const opt = document.createElement("option");
        opt.value = r.name;
        opt.textContent = r.name;
        if (r.name === current) opt.selected = true;
        sel.append(opt);
      }

      const comment = document.createElement("input");
      comment.type = "text";
      comment.placeholder = "Reason (required)";

      const save = document.createElement("button");
      save.textContent = "Save";

      const err = document.createElement("div");
      err.className = "row-error";

      save.addEventListener("click", async () => {
        err.textContent = "";
        if (!comment.value.trim()) {
          err.textContent = "A reason is required.";
          return;
        }
        save.disabled = true;
        const { error } = await supabase.rpc("set_user_role", {
          target_user: u.id,
          new_role: sel.value,
          change_comment: comment.value,
        });
        save.disabled = false;

        if (error) {
          err.textContent = error.message;
          return;
        }
        comment.value = "";
        await loadUsers();
        render();
      });

      tdActions.append(sel, comment, save, err);
    }

    tr.append(tdEmail, tdRole, tdAdded, tdActions);
    rowsEl.append(tr);
  }

  countEl.textContent = `${list.length} of ${users.length} member${users.length === 1 ? "" : "s"}`;
}

document.getElementById("invite-btn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
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
      body: JSON.stringify({
        email: document.getElementById("new-email").value,
        role: newRoleEl.value,
        comment: document.getElementById("new-comment").value,
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      errorEl.textContent = body.error || `Invite failed (${res.status})`;
      return;
    }

    msgEl.textContent = `Invite emailed to ${body.email} as ${body.role}.`;
    document.getElementById("new-email").value = "";
    document.getElementById("new-comment").value = "";
    await loadUsers();
    render();
  } catch (err) {
    errorEl.textContent = "Invite failed: " + err.message;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "../";
});

for (const el of [filterEl, roleFilterEl, sortEl]) {
  el.addEventListener("input", render);
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "../error.html";
    return;
  }
  meId = session.user.id;

  // Courtesy gate only. set_user_role() and the Edge Function both re-check
  // the manage-users key server-side, so hiding this page is not the control.
  const { data: keys, error } = await supabase.rpc("my_keys");
  if (error || !Array.isArray(keys) || !keys.includes("manage-users")) {
    window.location.href = "../error.html";
    return;
  }

  await loadRoles();
  await loadUsers();
  render();

  loadingEl.style.display = "none";
  contentEl.style.display = "block";
}

init();
