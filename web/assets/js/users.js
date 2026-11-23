import { getAuthenticatedContext } from "./auth-session.js";

const inviteForm = document.querySelector("#invite-form");
const inviteSubmit = document.querySelector("#invite-submit");
const usersStatus = document.querySelector("#users-status");
const staffRows = document.querySelector("#staff-rows");
const staffCount = document.querySelector("#staff-count");
let context;

function setStatus(message, kind = "danger") {
  usersStatus.className = `alert alert-${kind}`;
  usersStatus.textContent = message;
  usersStatus.hidden = false;
}

async function invokeAdmin(body) {
  const { data, error } = await context.client.functions.invoke("admin-users", {
    body,
  });
  if (error) {
    console.error("User administration request failed:", error);
    const response = error.context;
    if (response instanceof Response) {
      let result;
      try {
        result = await response.clone().json();
      } catch {
        result = null;
      }
      if (result && typeof result === "object" && typeof result.error === "string") {
        throw new Error(result.error);
      }
    }
    throw new Error("The user request failed. Check the Supabase Edge Function deployment.");
  }
  if (!data || typeof data !== "object" || "error" in data) {
    throw new Error(
      data && "error" in data && typeof data.error === "string"
        ? data.error
        : "The user service returned an invalid response.",
    );
  }
  return data;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(date);
}

function makeCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  return cell;
}

function makeRoleSelect(user) {
  const select = document.createElement("select");
  select.className = "form-select form-select-sm staff-role-select";
  select.setAttribute("aria-label", `Role for ${user.full_name}`);
  for (const [value, label] of [
    ["administrator", "Administrator"],
    ["pharmacist", "Pharmacist"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = user.role === value;
    select.append(option);
  }
  return select;
}

function renderUsers(users) {
  staffCount.textContent = users.length === 1 ? "1 staff member" : `${users.length} staff members`;
  if (users.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No staff profiles are available for this pharmacy.";
    row.append(cell);
    staffRows.replaceChildren(row);
    return;
  }

  const rows = users.map((user) => {
    const row = document.createElement("tr");
    const isCurrentUser = user.id === context.profile.id;
    const accountStatus = !user.is_active
      ? "Deactivated"
      : user.email_confirmed_at
        ? "Active"
        : "Invitation pending";

    row.append(
      makeCell(`${user.full_name}${isCurrentUser ? " (you)" : ""}`),
      makeCell(user.email),
    );

    const roleCell = document.createElement("td");
    roleCell.append(makeRoleSelect(user));
    row.append(roleCell, makeCell(accountStatus), makeCell(formatDate(user.created_at)));

    const actions = document.createElement("td");
    actions.className = "staff-actions";
    const saveButton = document.createElement("button");
    saveButton.className = "btn btn-sm btn-outline-success";
    saveButton.type = "button";
    saveButton.textContent = "Save role";
    saveButton.dataset.staffAction = "save-role";
    saveButton.dataset.userId = user.id;
    saveButton.disabled = isCurrentUser;
    if (isCurrentUser) saveButton.title = "You cannot change your own role.";
    actions.append(saveButton);

    const accessButton = document.createElement("button");
    accessButton.className = user.is_active
      ? "btn btn-sm btn-outline-danger"
      : "btn btn-sm btn-outline-secondary";
    accessButton.type = "button";
    accessButton.textContent = user.is_active ? "Deactivate" : "Restore";
    accessButton.dataset.staffAction = user.is_active ? "deactivate" : "restore";
    accessButton.dataset.userId = user.id;
    accessButton.disabled = isCurrentUser;
    if (isCurrentUser) accessButton.title = "You cannot deactivate your own account.";
    actions.append(accessButton);

    row.append(actions);
    return row;
  });
  staffRows.replaceChildren(...rows);
}

async function loadUsers() {
  const result = await invokeAdmin({ action: "list" });
  if (!Array.isArray(result.users)) {
    throw new Error("The user service returned an invalid staff list.");
  }
  renderUsers(result.users);
}

async function submitInvite(event) {
  event.preventDefault();
  inviteSubmit.disabled = true;
  usersStatus.hidden = true;
  try {
    const formData = new FormData(inviteForm);
    const result = await invokeAdmin({
      action: "invite",
      email: String(formData.get("email") ?? "").trim(),
      full_name: String(formData.get("full_name") ?? "").trim(),
      role: String(formData.get("role") ?? ""),
    });
    if (!result.user || typeof result.user.email !== "string") {
      throw new Error("The user service returned an invalid invitation response.");
    }
    inviteForm.reset();
    setStatus(`Invitation sent to ${result.user.email}.`, "success");
    try {
      await loadUsers();
    } catch (error) {
      console.error("Invitation sent, but staff list could not refresh:", error);
      setStatus("Invitation sent, but the staff list could not refresh. Reload the page.", "warning");
    }
  } catch (error) {
    console.error("Could not invite staff member:", error);
    setStatus(error instanceof Error ? error.message : "The invitation failed.");
  } finally {
    inviteSubmit.disabled = false;
  }
}

async function updateStaff(button) {
  const userId = button.dataset.userId;
  const row = button.closest("tr");
  const role = row.querySelector(".staff-role-select").value;
  const action = button.dataset.staffAction;
  const accessAction = row.querySelector(
    '[data-staff-action="deactivate"], [data-staff-action="restore"]',
  ).dataset.staffAction;
  const isActive = action === "deactivate"
    ? false
    : action === "restore"
      ? true
      : accessAction === "deactivate";

  if (
    action === "deactivate"
    && !window.confirm("Deactivate this account? It will lose access to pharmacy data but can be restored later.")
  ) return;

  usersStatus.hidden = true;
  button.disabled = true;
  try {
    await invokeAdmin({
      action: "update",
      user_id: userId,
      role,
      is_active: isActive,
    });
    setStatus("Staff account updated.", "success");
    try {
      await loadUsers();
    } catch (error) {
      console.error("Staff account updated, but list could not refresh:", error);
      setStatus("Staff account updated, but the list could not refresh. Reload the page.", "warning");
    }
  } catch (error) {
    console.error("Could not update staff account:", error);
    setStatus(error instanceof Error ? error.message : "The staff change failed.");
    button.disabled = false;
  }
}

async function prepareUsers() {
  try {
    context = await getAuthenticatedContext();
    if (!context) return;
    if (context.profile.role !== "administrator") {
      inviteForm.hidden = true;
      setStatus("Only administrators can manage staff accounts.");
      staffRows.replaceChildren();
      staffCount.textContent = "Unavailable";
      return;
    }

    inviteForm.addEventListener("submit", (event) => void submitInvite(event));
    staffRows.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("[data-staff-action]");
      if (!button || button.disabled) return;
      void updateStaff(button);
    });
    await loadUsers();
  } catch (error) {
    console.error("Could not load users:", error);
    staffCount.textContent = "Unavailable";
    setStatus(error instanceof Error ? error.message : "Could not load staff accounts.");
  }
}

void prepareUsers();
