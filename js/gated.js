import { client } from "./config.js";

// Shared behaviour for the two gated pages. RLS decides which rows come back;
// an empty result means this session is not entitled to the area, so there is
// nothing to render and we bounce to the public error page.
//
// Returns the Supabase client on success, or null when it has redirected, so
// callers can do further authenticated work without opening a second client.
export async function renderArea(area) {
  const supabase = client();

  const loadingEl = document.getElementById("loading");
  const contentEl = document.getElementById("content");
  const itemsEl = document.getElementById("items");

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "../";
  });

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "../error.html";
    return null;
  }

  const { data, error } = await supabase
    .from("content")
    .select("id, title, body")
    .eq("area", area)
    .order("id");

  if (error || !data || data.length === 0) {
    window.location.href = "../error.html";
    return null;
  }

  loadingEl.style.display = "none";
  contentEl.style.display = "block";

  for (const row of data) {
    const div = document.createElement("div");
    div.className = "item";
    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    const p = document.createElement("p");
    p.textContent = row.body;
    div.append(h3, p);
    itemsEl.append(div);
  }

  return supabase;
}
