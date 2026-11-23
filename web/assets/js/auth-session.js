import { getSupabaseClient } from "./supabase-client.js";

let contextPromise;

export async function getProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("id, pharmacy_id, full_name, role, is_active")
    .eq("id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new Error(
        "Your account does not have a pharmacy profile. Contact an administrator.",
        { cause: error },
      );
    }
    throw error;
  }

  return data;
}

async function loadAuthenticatedContext() {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;

  const session = data.session;
  if (!session) {
    window.location.replace("./login.html");
    return null;
  }

  const profile = await getProfile(client, session.user.id);
  if (!profile.is_active) {
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw signOutError;
    window.location.replace("./login.html?reason=account-inactive");
    return null;
  }
  const { data: pharmacy, error: pharmacyError } = await client
    .from("pharmacies")
    .select("name, county, country_code, dataset_kind")
    .eq("id", profile.pharmacy_id)
    .single();

  if (pharmacyError) throw pharmacyError;

  return { client, session, profile, pharmacy };
}

export function getAuthenticatedContext() {
  contextPromise ??= loadAuthenticatedContext();
  return contextPromise;
}
