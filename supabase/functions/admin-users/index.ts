// @ts-ignore: Deno resolves this URL import at runtime.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StaffProfile = {
  id: string;
  pharmacy_id: string;
  full_name: string;
  role: "administrator" | "pharmacist";
  is_active: boolean;
  created_at: string;
};

type RequestBody = Record<string, unknown> & { action?: string };

function respond(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isStaffRole(value: unknown): value is StaffProfile["role"] {
  return value === "administrator" || value === "pharmacist";
}

function profileErrorMessage(message: string): string {
  switch (message) {
    case "ROLE_NOT_ALLOWED":
      return "Only an active administrator can manage staff.";
    case "STAFF_PROFILE_UNAVAILABLE":
      return "That staff account is unavailable in this pharmacy.";
    case "CANNOT_MANAGE_SELF":
      return "You cannot change or deactivate your own account.";
    case "LAST_ADMIN_REQUIRED":
      return "The pharmacy must have at least one active administrator.";
    case "INVALID_STAFF_PROFILE":
      return "Check the staff name and role, then try again.";
    case "PROFILE_REQUIRED":
      return "Your active pharmacy profile could not be verified.";
    case "INVALID_ACTION":
      return "That staff action is not supported.";
    default:
      return "The staff change could not be completed.";
  }
}

async function listAuthUsers(
  adminClient: SupabaseClient,
): Promise<Map<string, { email: string | null; confirmedAt: string | null }>> {
  const users = new Map<
    string,
    { email: string | null; confirmedAt: string | null }
  >();

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;

    for (const user of data.users) {
      users.set(user.id, {
        email: user.email ?? null,
        confirmedAt: user.email_confirmed_at ?? null,
      });
    }

    if (data.users.length < 1000) return users;
  }

  throw new Error("Auth user listing exceeded the supported page limit.");
}

async function listStaff(
  adminClient: SupabaseClient,
  pharmacyId: string,
): Promise<StaffProfile[]> {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, pharmacy_id, full_name, role, is_active, created_at")
    .eq("pharmacy_id", pharmacyId)
    .order("full_name", { ascending: true });

  if (error) throw error;
  return data as StaffProfile[];
}

function actionErrorStatus(message: string): number {
  if (message === "STAFF_PROFILE_UNAVAILABLE") return 404;
  if (
    message === "ROLE_NOT_ALLOWED"
    || message === "CANNOT_MANAGE_SELF"
    || message === "LAST_ADMIN_REQUIRED"
  ) return 403;
  return 400;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("User administration function is missing Supabase configuration.");
    return respond({ error: "User administration is not configured." }, 503);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return respond({ error: "Sign in as an administrator to continue." }, 401);
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return respond({ error: "Request body must be valid JSON." }, 400);
  }
  if (!isRecord(value) || typeof value.action !== "string") {
    return respond({ error: "A staff action is required." }, 400);
  }
  const body = value as RequestBody;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return respond({ error: "Your session could not be verified. Sign in again." }, 401);
    }

    const { data: actor, error: actorError } = await userClient
      .from("profiles")
      .select("id, pharmacy_id, role, is_active")
      .eq("id", authData.user.id)
      .single();
    if (actorError || !actor) {
      console.error("Could not verify staff administrator profile:", actorError);
      return respond({ error: "Your pharmacy profile could not be verified." }, 403);
    }
    if (actor.role !== "administrator" || !actor.is_active) {
      return respond({ error: "Only an active administrator can manage staff." }, 403);
    }

    if (body.action === "list") {
      const [profiles, authUsers] = await Promise.all([
        listStaff(adminClient, actor.pharmacy_id),
        listAuthUsers(adminClient),
      ]);
      return respond({
        users: profiles.map((profile) => {
          const authUser = authUsers.get(profile.id);
          return {
            ...profile,
            email: authUser?.email ?? null,
            email_confirmed_at: authUser?.confirmedAt ?? null,
          };
        }),
      });
    }

    if (body.action === "invite") {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const fullName = typeof body.full_name === "string"
        ? body.full_name.trim()
        : "";
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || email.length > 254
        || !fullName
        || fullName.length > 120
        || !isStaffRole(body.role)
      ) {
        return respond({ error: "Enter a valid email, name, and staff role." }, 400);
      }

      const appSiteUrl = Deno.env.get("APP_SITE_URL")?.trim();
      if (!appSiteUrl) {
        return respond({ error: "Invitation setup is incomplete. Configure APP_SITE_URL first." }, 503);
      }

      let inviteRedirect: string;
      try {
        inviteRedirect = new URL("./login.html?invite=1", appSiteUrl).toString();
      } catch {
        return respond({ error: "The configured invitation URL is invalid." }, 503);
      }

      const { data: invited, error: inviteError } = await adminClient.auth.admin
        .inviteUserByEmail(email, {
          data: { full_name: fullName },
          redirectTo: inviteRedirect,
        });
      if (inviteError || !invited.user) {
        if (inviteError) {
          console.error("Could not invite staff member:", inviteError);
          const detail = inviteError.message.toLowerCase();
          if (detail.includes("already") || detail.includes("registered")) {
            return respond(
              { error: "That email already has an account or a pending invitation." },
              409,
            );
          }
        }
        return respond({ error: "The invitation could not be sent." }, 502);
      }

      const { error: profileError } = await userClient.rpc(
        "admin_manage_staff_profile",
        {
          p_action: "invite",
          p_user_id: invited.user.id,
          p_full_name: fullName,
          p_role: body.role,
          p_is_active: true,
        },
      );
      if (profileError) {
        console.error("Could not create invited staff profile:", profileError);
        const { error: cleanupError } = await adminClient.auth.admin
          .deleteUser(invited.user.id);
        if (cleanupError) {
          console.error("Could not clean up an invited user without a profile:", cleanupError);
          return respond({
            error: "The invite was sent, but profile setup failed. Contact an administrator before retrying.",
          }, 500);
        }
        return respond({ error: profileErrorMessage(profileError.message) }, 400);
      }

      return respond({
        user: {
          id: invited.user.id,
          email: invited.user.email ?? email,
          full_name: fullName,
          role: body.role,
          is_active: true,
          email_confirmed_at: invited.user.email_confirmed_at ?? null,
          created_at: invited.user.created_at,
        },
      }, 201);
    }

    if (body.action === "update") {
      if (!isUuid(body.user_id) || !isStaffRole(body.role) || typeof body.is_active !== "boolean") {
        return respond({ error: "Select a valid staff account, role, and status." }, 400);
      }

      const { data, error } = await userClient.rpc("admin_manage_staff_profile", {
        p_action: "update",
        p_user_id: body.user_id,
        p_role: body.role,
        p_is_active: body.is_active,
      });
      if (error) {
        console.error("Could not update staff profile:", error);
        return respond({ error: profileErrorMessage(error.message) }, actionErrorStatus(error.message));
      }
      return respond({ user: data });
    }

    return respond({ error: "That staff action is not supported." }, 400);
  } catch (error) {
    console.error("Staff administration request failed:", error);
    return respond({ error: "The staff request failed. Check the function logs." }, 500);
  }
});
