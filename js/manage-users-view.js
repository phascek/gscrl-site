// The Manage Users UI, built into whatever container it is given. Shared by
// the in-app view (right pane of index.html) and the standalone page, so the
// two cannot drift apart.
//
// None of this enforces anything. set_user_role() re-checks the manage-users
// key, refuses a blank comment and refuses self-edits; the Edge Function does
// the same for invites.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const DEFAULT_ROLE = "volunteer";

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter(Boolean));
  return node;
}

export async function renderManageUsers(supabase, root, meId) {
  root.replaceChildren();

  let roles = [];
  let users = [];

  const errorEl = h("div", { class: "mu-error" });
  const msgEl = h("div", { class: "mu-msg" });
  const rowsEl = h("tbody");
  const countEl = h("p", { class: "member-note" });

  const emailInput = h("input", { type: "email", placeholder: "them@example.com", autocomplete: "off" });
  const roleSelect = h("select");
  const commentInput = h("input", { type: "text", placeholder: "Reason (optional)" });
  const inviteBtn = h("button", { type: "button", class: "button primary small", text: "Send Invite" });

  const filterInput = h("input", { type: "text", placeholder: "Filter by email…" });
  const roleFilter = h("select", {}, h("option", { value: "", text: "All roles" }));
  const sortSelect = h("select", {},
    h("option", { value: "email", text: "Email (A–Z)" }),
    h("option", { value: "role", text: "Role" }),
    h("option", { value: "newest", text: "Newest first" }),
    h("option", { value: "oldest", text: "Oldest first" }),
  );

  const roleNameOf = (u) => (u.roles ? u.roles.name : null);

  async function loadRoles() {
    const { data } = await supabase.from("roles").select("id, name").order("id");
    roles = data ?? [];
    for (const r of roles) {
      const opt = h("option", { value: r.name, text: r.name });
      if (r.name === DEFAULT_ROLE) opt.selected = true;
      roleSelect.append(opt);
      roleFilter.append(h("option", { value: r.name, text: r.name }));
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

  function visible() {
    const needle = filterInput.value.trim().toLowerCase();
    const wantRole = roleFilter.value;

    const list = users.filter((u) => {
      const okText = !needle || (u.email ?? "").toLowerCase().includes(needle);
      const okRole = !wantRole || roleNameOf(u) === wantRole;
      return okText && okRole;
    });

    const by = sortSelect.value;
    return list.slice().sort((a, b) => {
      if (by === "email") return (a.email ?? "").localeCompare(b.email ?? "");
      if (by === "role") {
        return (roleNameOf(a) ?? "~").localeCompare(roleNameOf(b) ?? "~") ||
               (a.email ?? "").localeCompare(b.email ?? "");
      }
      const at = new Date(a.created_at ?? 0).getTime();
      const bt = new Date(b.created_at ?? 0).getTime();
      return by === "newest" ? bt - at : at - bt;
    });
  }

  function renderRows() {
    rowsEl.replaceChildren();
    const list = visible();

    for (const u of list) {
      const current = roleNameOf(u);

      const tdRole = h("td", { text: current ?? "no role" });
      if (current === "banned") tdRole.className = "mu-banned";

      const tdActions = h("td", { class: "mu-actions" });

      if (u.id === meId) {
        tdActions.append(h("span", {
          class: "member-note",
          text: "That's you — someone else must change your role.",
        }));
      } else {
        const sel = h("select");
        for (const r of roles) {
          const opt = h("option", { value: r.name, text: r.name });
          if (r.name === current) opt.selected = true;
          sel.append(opt);
        }
        const reason = h("input", { type: "text", placeholder: "Reason (required)" });
        const save = h("button", { type: "button", class: "button small", text: "Save" });
        const rowErr = h("div", { class: "mu-error" });

        save.addEventListener("click", async () => {
          rowErr.textContent = "";
          if (!reason.value.trim()) {
            rowErr.textContent = "A reason is required.";
            return;
          }
          save.disabled = true;
          const { error } = await supabase.rpc("set_user_role", {
            target_user: u.id,
            new_role: sel.value,
            change_comment: reason.value,
          });
          save.disabled = false;
          if (error) {
            rowErr.textContent = error.message;
            return;
          }
          reason.value = "";
          await loadUsers();
          renderRows();
        });

        tdActions.append(sel, reason, save, rowErr);
      }

      rowsEl.append(h("tr", {},
        h("td", { text: u.email ?? "(no email)" }),
        tdRole,
        h("td", { text: u.created_at ? new Date(u.created_at).toLocaleDateString() : "—" }),
        tdActions,
      ));
    }

    countEl.textContent =
      `${list.length} of ${users.length} member${users.length === 1 ? "" : "s"}`;
  }

  inviteBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    msgEl.textContent = "";
    inviteBtn.disabled = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: emailInput.value,
          role: roleSelect.value,
          comment: commentInput.value,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorEl.textContent = body.error || `Invite failed (${res.status})`;
        return;
      }
      msgEl.textContent = `Invite emailed to ${body.email} as ${body.role}.`;
      emailInput.value = "";
      commentInput.value = "";
      await loadUsers();
      renderRows();
    } catch (err) {
      errorEl.textContent = "Invite failed: " + err.message;
    } finally {
      inviteBtn.disabled = false;
    }
  });

  for (const el of [filterInput, roleFilter, sortSelect]) {
    el.addEventListener("input", renderRows);
  }

  root.append(
    h("p", { class: "member-note", text: "Every role change is recorded with who made it, when, and why." }),

    h("div", { class: "mu-panel" },
      h("h3", { text: "Add a member" }),
      h("div", { class: "mu-row" },
        h("div", {}, h("label", { text: "Email" }), emailInput),
        h("div", {}, h("label", { text: "Role" }), roleSelect),
        h("div", {}, h("label", { text: "Reason (optional)" }), commentInput),
        h("div", { class: "mu-btn-cell" }, inviteBtn),
      ),
      errorEl,
      msgEl,
    ),

    h("div", { class: "mu-panel" },
      h("h3", { text: "Members" }),
      h("div", { class: "mu-row" },
        h("div", {}, h("label", { text: "Filter by email" }), filterInput),
        h("div", {}, h("label", { text: "Role" }), roleFilter),
        h("div", {}, h("label", { text: "Sort by" }), sortSelect),
      ),
      h("div", { class: "mu-scroll" },
        h("table", {},
          h("thead", {}, h("tr", {},
            h("th", { text: "Email" }),
            h("th", { text: "Role" }),
            h("th", { text: "Added" }),
            h("th", { text: "Change role" }),
          )),
          rowsEl,
        ),
      ),
      countEl,
    ),
  );

  await loadRoles();
  await loadUsers();
  renderRows();
}
