// Supabase connection details. The publishable key is safe to ship in client
// source -- every table is protected by row level security, not by hiding this.
export const SUPABASE_URL = "https://jcqnsgbnsmwoncjehvqq.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_99kP3nKCaLhcwShKLs8zZA_K1nxz4xf";

// window.supabase comes from vendor/supabase-js-*.js, loaded by a plain script
// tag before this module. Referenced via window so it is unambiguous against
// the module-scoped client below.
export function client() {
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
