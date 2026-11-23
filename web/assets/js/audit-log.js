import { getAuthenticatedContext } from "./auth-session.js";

const filterForm = document.querySelector("#audit-filters");
const auditRows = document.querySelector("#audit-rows");
const auditStatus = document.querySelector("#audit-status");
const auditCount = document.querySelector("#audit-count");
let context;

function setStatus(message) {
  auditStatus.textContent = message;
  auditStatus.hidden = false;
}

function cell(value) {
  const element = document.createElement("td");
  element.textContent = value || "—";
  return element;
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    }).format(date);
}

function localMidnight(dateString) {
  return new Date(`${dateString}T00:00:00+03:00`).toISOString();
}

function nextDay(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

async function loadAuditEvents() {
  auditStatus.hidden = true;
  auditCount.textContent = "Loading…";
  const from = document.querySelector("#audit-from").value;
  const to = document.querySelector("#audit-to").value;
  if (from && to && from > to) {
    throw new Error("The start date must be on or before the end date.");
  }

  let query = context.client
    .from("audit_log")
    .select("id, pharmacy_id, entity_table, entity_id, operation, actor_id, created_at")
    .eq("pharmacy_id", context.profile.pharmacy_id)
    .order("created_at", { ascending: false })
    .limit(200);
  const entityTable = document.querySelector("#audit-table").value;
  const operation = document.querySelector("#audit-operation").value;
  if (from) query = query.gte("created_at", localMidnight(from));
  if (to) query = query.lt("created_at", localMidnight(nextDay(to)));
  if (entityTable) query = query.eq("entity_table", entityTable);
  if (operation) query = query.eq("operation", operation);

  const { data: events, error } = await query;
  if (error) throw error;

  const actorIds = [...new Set(
    events.map((event) => event.actor_id).filter(Boolean),
  )];
  const { data: actors, error: actorsError } = actorIds.length
    ? await context.client
      .from("profiles")
      .select("id, full_name")
      .eq("pharmacy_id", context.profile.pharmacy_id)
      .in("id", actorIds)
    : { data: [], error: null };
  if (actorsError) throw actorsError;

  const actorNames = new Map(actors.map((actor) => [actor.id, actor.full_name]));
  if (events.length === 0) {
    const row = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 5;
    emptyCell.textContent = "No audit events match these filters.";
    row.append(emptyCell);
    auditRows.replaceChildren(row);
  } else {
    const rows = events.map((event) => {
      const row = document.createElement("tr");
      const recordId = event.entity_id ?? "—";
      const operationName = {
        INSERT: "Created",
        UPDATE: "Updated",
        DELETE: "Deleted",
      }[event.operation] ?? event.operation;
      row.append(
        cell(formatTimestamp(event.created_at)),
        cell(event.actor_id ? actorNames.get(event.actor_id) ?? "Former staff" : "System / unknown"),
        cell(operationName),
        cell(event.entity_table.replaceAll("_", " ")),
      );
      const idCell = cell(recordId);
      if (event.entity_id) idCell.title = event.entity_id;
      row.append(idCell);
      return row;
    });
    auditRows.replaceChildren(...rows);
  }

  auditCount.textContent = events.length === 200 ? "200+ events" : `${events.length} events`;
}

async function prepareAuditLog() {
  try {
    context = await getAuthenticatedContext();
    if (!context) return;
    if (context.profile.role !== "administrator") {
      setStatus("Only administrators can view the audit log.");
      auditCount.textContent = "Unavailable";
      auditRows.replaceChildren();
      return;
    }
    filterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void loadAuditEvents().catch((error) => {
        console.error("Could not load audit events:", error);
        setStatus("Could not load audit events. Check your administrator access.");
        auditCount.textContent = "Unavailable";
      });
    });
    await loadAuditEvents();
  } catch (error) {
    console.error("Could not prepare audit log:", error);
    setStatus("Could not load the audit log. Check your administrator access.");
    auditCount.textContent = "Unavailable";
  }
}

void prepareAuditLog();
