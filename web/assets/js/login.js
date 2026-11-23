import { getProfile } from "./auth-session.js";
import { getSupabaseClient } from "./supabase-client.js";

const loginForm = document.querySelector("#login-form");
const inviteForm = document.querySelector("#invite-form");
const loginHelp = document.querySelector("#login-help");
const loginIntro = document.querySelector("#login-intro");
const loginStatus = document.querySelector("#login-status");
const submitButton = loginForm?.querySelector('button[type="submit"]');
const invitationMode = new URLSearchParams(window.location.search).get("invite") === "1";
const hashParameters = new URLSearchParams(window.location.hash.slice(1));
const hasAuthCallback =
  hashParameters.get("type") === "invite"
  || hashParameters.has("access_token")
  || new URLSearchParams(window.location.search).has("code");
let invitationClient;

if (new URLSearchParams(window.location.search).get("reason") === "account-inactive") {
  loginStatus.hidden = false;
  loginStatus.className = "alert alert-warning";
  loginStatus.textContent =
    "This staff account is inactive. Contact your pharmacy administrator.";
}

loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void signIn();
});

inviteForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void acceptInvitation();
});

if (invitationMode) void prepareInvitation();

async function prepareInvitation() {
  loginForm.hidden = true;
  loginHelp.hidden = true;
  loginIntro.hidden = true;
  loginStatus.hidden = false;
  loginStatus.className = "alert alert-info";
  loginStatus.textContent = "Verifying your invitation…";

  try {
    if (!hasAuthCallback) {
      throw new Error("Open this page using the invitation link sent to your email.");
    }
    invitationClient = await getSupabaseClient();
    const { data, error } = await invitationClient.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      throw new Error(
        "This invitation link is invalid or expired. Ask an administrator to send another.",
      );
    }

    const profile = await getProfile(invitationClient, data.session.user.id);
    if (!profile.is_active) {
      throw new Error("This staff account is inactive. Contact your pharmacy administrator.");
    }
    inviteForm.hidden = false;
    loginStatus.className = "alert alert-info";
    loginStatus.textContent =
      "Invitation verified. Create a password to finish setting up your account.";
  } catch (error) {
    console.error("Could not verify staff invitation:", error);
    loginStatus.className = "alert alert-danger";
    loginStatus.textContent =
      error instanceof Error ? error.message : "Could not verify this invitation.";
  }
}

async function acceptInvitation() {
  const password = inviteForm.elements.password.value;
  const passwordConfirm = inviteForm.elements.password_confirm.value;
  const button = inviteForm.querySelector('button[type="submit"]');
  if (password.length < 12) {
    loginStatus.className = "alert alert-danger";
    loginStatus.hidden = false;
    loginStatus.textContent = "Use a password with at least 12 characters.";
    return;
  }
  if (password !== passwordConfirm) {
    loginStatus.className = "alert alert-danger";
    loginStatus.hidden = false;
    loginStatus.textContent = "The passwords do not match.";
    return;
  }

  button.disabled = true;
  loginStatus.className = "alert alert-info";
  loginStatus.hidden = false;
  loginStatus.textContent = "Setting your password…";
  try {
    const { data, error } = await invitationClient.auth.updateUser({ password });
    if (error) throw error;
    if (!data.user) throw new Error("Supabase returned no invitation user.");
    window.location.replace("./dashboard.html");
  } catch (error) {
    console.error("Could not accept staff invitation:", error);
    loginStatus.className = "alert alert-danger";
    loginStatus.textContent =
      error instanceof Error
        ? error.message
        : "Could not set your password. Check the invitation and try again.";
    button.disabled = false;
  }
}

async function signIn() {
  loginStatus.hidden = false;
  loginStatus.className = "alert alert-info";
  loginStatus.textContent = "Signing in…";
  submitButton.disabled = true;

  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: loginForm.elements.email.value.trim(),
      password: loginForm.elements.password.value,
    });

    if (error) throw error;
    if (!data.user) throw new Error("Supabase returned no signed-in user.");

    try {
      const profile = await getProfile(client, data.user.id);
      if (!profile.is_active) {
        throw new Error("This staff account is inactive. Contact your pharmacy administrator.");
      }
    } catch (profileError) {
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) throw signOutError;
      throw profileError;
    }

    window.location.assign("./dashboard.html");
  } catch (error) {
    console.error("Sign-in failed:", error);
    loginStatus.className = "alert alert-danger";
    const errorMessage =
      error instanceof Error ? error.message : "Unexpected sign-in error.";
    loginStatus.textContent =
      errorMessage.startsWith("Supabase is not configured.")
        ? errorMessage
        : errorMessage.startsWith("Your account does not have a pharmacy profile.")
          ? errorMessage
          : errorMessage.startsWith("This staff account is inactive.")
            ? errorMessage
          : "Sign-in failed. Check your credentials and try again.";
  } finally {
    submitButton.disabled = false;
  }
}
