import { supabase } from "./supabase";

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;

  if (data.user) {
    const { data: existing } = await supabase
      .from("gestor")
      .select("id")
      .eq("auth_user_id", data.user.id)
      .limit(1)
      .single();

    if (!existing) {
      const { data: empresa } = await supabase
        .from("empresa")
        .select("id")
        .order("created_at")
        .limit(1)
        .single();

      if (empresa) {
        await supabase.from("gestor").insert({
          nombre: email.split("@")[0],
          email,
          empresa_id: empresa.id,
          auth_user_id: data.user.id,
        });
      }
    }
  }

  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/ajustes`,
  });
  if (error) throw error;
}
