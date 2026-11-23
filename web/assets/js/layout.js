import { getAuthenticatedContext } from "./auth-session.js";
import { applyTheme, loadTheme } from "./theme.js";

const app = document.querySelector("#app");

if (app) {
  const pageContent = app.innerHTML;

  app.innerHTML = `
    <header class="app-topbar">
      <div class="topbar-start">
        <button
          class="menu-toggle"
          id="menu-toggle"
          type="button"
          aria-label="Open navigation"
          aria-controls="app-sidebar"
          aria-expanded="false"
        >☰</button>
        <a class="brand-lockup" href="./dashboard.html">
          <span class="brand-mark" aria-hidden="true">+</span>
          <span>DawaSmart</span>
        </a>
      </div>
      <div class="topbar-end">
        <span class="pharmacy-label" id="pharmacy-label">Loading pharmacy…</span>
        <span
          class="status-chip status-chip-neutral"
          id="dataset-kind"
          hidden
        ></span>
        <span class="user-chip">
          <span class="user-avatar" id="user-avatar" aria-hidden="true">DS</span>
          <span class="user-details">
            <span id="staff-name">Loading profile…</span>
            <span class="user-role" id="staff-role"></span>
          </span>
        </span>
        <button
          class="btn btn-outline-secondary btn-sm"
          id="sign-out"
          type="button"
          disabled
        >
          Sign out
        </button>
      </div>
    </header>
    <div class="app-body">
      <aside class="app-sidebar" id="app-sidebar" aria-label="Main navigation">
        <p class="sidebar-section-label">Workspace</p>
        <nav class="sidebar-nav">
          <a class="sidebar-link" href="./dashboard.html" data-nav="overview">
            <span class="sidebar-link-marker" aria-hidden="true">O</span>
            <span>Overview</span>
          </a>
          <a class="sidebar-link" href="./medicines.html" data-nav="medicines">
            <span class="sidebar-link-marker" aria-hidden="true">M</span>
            <span>Medicines</span>
          </a>
          <a class="sidebar-link" href="./batches.html" data-nav="batches">
            <span class="sidebar-link-marker" aria-hidden="true">B</span>
            <span>Batches</span>
          </a>
          <a class="sidebar-link" href="./sales.html" data-nav="sales">
            <span class="sidebar-link-marker" aria-hidden="true">S</span>
            <span>Sales and receipts</span>
          </a>
          <a class="sidebar-link" href="./purchases.html" data-nav="purchases">
            <span class="sidebar-link-marker" aria-hidden="true">P</span>
            <span>Purchases</span>
          </a>
          <a class="sidebar-link" href="./forecast.html" data-nav="forecast">
            <span class="sidebar-link-marker" aria-hidden="true">F</span>
            <span>Forecast</span>
          </a>
          <a class="sidebar-link" href="./adjustments.html" data-nav="adjustments">
            <span class="sidebar-link-marker" aria-hidden="true">A</span>
            <span>Stock adjustments</span>
          </a>
          <a class="sidebar-link" href="./recommendations.html" data-nav="recommendations">
            <span class="sidebar-link-marker" aria-hidden="true">R</span>
            <span>Recommendations</span>
          </a>
          <a class="sidebar-link" href="./alerts.html" data-nav="alerts">
            <span class="sidebar-link-marker" aria-hidden="true">!</span>
            <span>Alerts</span>
          </a>
          <a class="sidebar-link" href="./reports.html" data-nav="reports">
            <span class="sidebar-link-marker" aria-hidden="true">D</span>
            <span>Reports</span>
          </a>
          <a class="sidebar-link" href="./assistant.html" data-nav="assistant">
            <span class="sidebar-link-marker" aria-hidden="true">AI</span>
            <span>Assistant</span>
          </a>
        </nav>
        <p class="sidebar-section-label mt-4" data-admin-only hidden>Administration</p>
        <nav class="sidebar-nav" aria-label="Administration" data-admin-only hidden>
          <a class="sidebar-link" href="./users.html" data-nav="users" data-admin-only hidden>
            <span class="sidebar-link-marker" aria-hidden="true">U</span>
            <span>Users</span>
          </a>
          <a class="sidebar-link" href="./audit-log.html" data-nav="audit-log" data-admin-only hidden>
            <span class="sidebar-link-marker" aria-hidden="true">L</span>
            <span>Audit log</span>
          </a>
        </nav>
        <p class="sidebar-section-label mt-4">Preferences</p>
        <nav class="sidebar-nav" aria-label="Preferences">
          <a class="sidebar-link" href="./settings.html" data-nav="settings">
            <span class="sidebar-link-marker" aria-hidden="true">⚙</span>
            <span>Settings</span>
          </a>
        </nav>
      </aside>
      <button
        class="sidebar-backdrop"
        id="sidebar-backdrop"
        type="button"
        aria-label="Close navigation"
        hidden
      ></button>
      <main class="app-main" id="main-content">
        <div
          class="alert alert-warning app-status"
          id="app-status"
          role="status"
          aria-live="polite"
          hidden
        ></div>
        ${pageContent}
      </main>
    </div>
  `;

  const sidebar = document.querySelector("#app-sidebar");
  const menuToggle = document.querySelector("#menu-toggle");
  const backdrop = document.querySelector("#sidebar-backdrop");
  const appStatus = document.querySelector("#app-status");
  const signOutButton = document.querySelector("#sign-out");
  const activePage = document.body.dataset.activePage ?? "overview";

  document.querySelectorAll(".sidebar-link[data-nav]").forEach((link) => {
    if (link.dataset.nav === activePage) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
  });

  const setNavigationOpen = (isOpen) => {
    sidebar.classList.toggle("is-open", isOpen);
    backdrop.hidden = !isOpen;
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute(
      "aria-label",
      isOpen ? "Close navigation" : "Open navigation",
    );
  };

  menuToggle.addEventListener("click", () => {
    setNavigationOpen(menuToggle.getAttribute("aria-expanded") !== "true");
  });
  backdrop.addEventListener("click", () => setNavigationOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNavigationOpen(false);
  });

  try {
    applyTheme(loadTheme());
  } catch (error) {
    console.error("Could not load the saved theme:", error);
    appStatus.hidden = false;
    appStatus.textContent = "Could not load the saved appearance preference.";
  }

  try {
    const context = await getAuthenticatedContext();
    if (context) {
      const isAdministrator = context.profile.role === "administrator";
      document.querySelectorAll("[data-admin-only]").forEach((element) => {
        element.hidden = !isAdministrator;
      });
      document.querySelector("#pharmacy-label").textContent = context.pharmacy.name;
      document.querySelector("#staff-name").textContent = context.profile.full_name;
      document.querySelector("#staff-name").title = context.profile.full_name;
      document.querySelector("#staff-role").textContent =
        context.profile.role === "administrator" ? "Administrator" : "Pharmacist";
      document.querySelector("#user-avatar").textContent = context.profile.full_name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("");
      const datasetKind = document.querySelector("#dataset-kind");
      datasetKind.textContent =
        context.pharmacy.dataset_kind === "synthetic"
          ? "Online"
          : "Real data";
      datasetKind.hidden = false;
      signOutButton.disabled = false;

      signOutButton.addEventListener("click", async () => {
        signOutButton.disabled = true;
        try {
          const { error } = await context.client.auth.signOut();
          if (error) throw error;
          window.location.replace("./login.html");
        } catch (error) {
          console.error("Sign-out failed:", error);
          appStatus.hidden = false;
          appStatus.textContent = "Sign-out failed. Please try again.";
          signOutButton.disabled = false;
        }
      });
    }
  } catch (error) {
    console.error("Could not load the signed-in pharmacy context:", error);
    appStatus.hidden = false;
    const errorMessage =
      error instanceof Error ? error.message : "Unexpected session error.";
    appStatus.textContent = errorMessage.startsWith("Supabase is not configured.")
      ? errorMessage
      : "Could not load your pharmacy profile. Check your access and try again.";
  }
}
