<<<<<<< HEAD
# DawaSmart

DawaSmart is a pharmacy inventory and demand-forecasting project for Kenyan
pharmacies. Its forecasts and recommendations are decision support only;
pharmacists retain responsibility for purchasing and other professional
decisions.

## Project layout

```text
web/                    Static HTML, CSS, and vanilla JavaScript frontend
supabase/
  migrations/           PostgreSQL schema, constraints, policies, and triggers
  seed.sql              Clearly labelled synthetic demo records
forecasting/            Python forecasting service and evaluation (Phase 4)
```

The database foundation is in place. The frontend includes Supabase Auth,
pharmacy-scoped medicines, batch receiving, FEFO sales, printable receipts,
dashboard metrics, and reports. The Python forecasting service is being
developed in Phase 4.

## Phase 1 assumptions

- Every business record belongs to a pharmacy. This supports pharmacy-scoped
  access and one forecast series per medicine per pharmacy.
- The seed pharmacy and its sample inventory are synthetic. Do not treat them
  as real supplier, medicine, or sales records.
- `profiles` are linked to Supabase Auth users. A trusted operator must
  provision the initial administrator profile; never let a browser choose its
  own role.
-   Direct browser writes are limited to medicine and supplier catalogue
  maintenance. Batch receipt and sale stock changes use transactional database
  functions; forecast data will be written by the server-side forecasting
  service.

## Run the database locally

Install the current Supabase CLI and Docker using their official
documentation, then run from the project root:

```sh
supabase start
supabase db reset
```

`supabase db reset` applies the migrations and loads `supabase/seed.sql`.
`supabase status` displays local service URLs and development keys. Use only
the anon key in browser code, together with the signed-in user's session.
Never put a service-role key in the frontend or commit secrets; keep local
secrets in an ignored `.env` file or the appropriate server-side secret store.

To create the first local administrator:

1. Create a user in the local Supabase Auth dashboard.
2. Copy that user's Auth UUID and the seeded pharmacy UUID
   (`11111111-1111-4111-8111-111111111111`).
3. As a trusted database operator, insert a row into `public.profiles` with that
   user ID, pharmacy ID, full name, and `administrator` role.

The profile table intentionally has no direct browser write policy, so a
client cannot grant itself administrator access. The administrator user
workflow uses a role-checked database function for staff profiles.

For the hosted demo only, `supabase/bootstrap_profiles.sql` creates the
administrator and pharmacist profiles for the Auth users provisioned for this
project. Run `supabase/seed.sql` first, then paste the bootstrap file into the
hosted project's SQL Editor. The bootstrap file is git-ignored because it
contains project-specific Auth user IDs; do not use it for local resets.

## View the frontend preview

From the project root, serve the static frontend:

```sh
python3 -m http.server 8000 --directory web
```

Open `http://localhost:8000/login.html`,
`http://localhost:8000/dashboard.html`, or
`http://localhost:8000/medicines.html`. Bootstrap 5 and Supabase JS are loaded
from CDNs, so the app requires internet access. The pages currently pin
Bootstrap 5.3.3 and import Supabase JS 2.x; verify current versions against
their official documentation before deployment. Login and medicine operations
work only after the database is running and the Supabase client has the project
URL and anon/publishable key in
`web/assets/js/supabase-config.js`. This is public browser configuration, not
a place for a service-role key. Apply the migration and seed data first; use
the local values reported by `supabase status`. The service-role key must never
be added to frontend files.

The medicine catalogue queries are restricted by database RLS. Only an
administrator can add or archive a medicine; archiving sets `is_active` to
false and preserves historical references. Browser role checks are a
convenience, not an authorization boundary. Database policies remain
authoritative.

## Phase 2: receive stock and record sales

The initial schema was already applied to the hosted project. Apply only the
new migration in `supabase/migrations/20261120180645_phase2_batch_sales.sql`
using the Supabase SQL Editor. Run that migration once; do not rerun the
initial schema or drop existing tables. The migration adds the
`receive_batch()` and `record_sale()` RPC functions. Each batch receipt creates
a completed purchase record and batch in one transaction. Each sale deducts
unexpired batches in earliest-expiry-first order and rolls back all sale rows
and stock changes if there is not enough stock.

The **Batches** page needs an active medicine. Administrators can add a
supplier by name directly from the batch form; the name is saved in the
pharmacy's supplier catalogue and selected for the batch. Pharmacists can
select existing suppliers. The **Sales and receipts** page accepts the selling
price per dispensing unit in KES. It does not collect payment method, tax, or
customer details. A successful sale opens a saved receipt that can be printed
or reopened from the recent receipts list. These workflows accept both
administrator and pharmacist profiles; the database functions enforce the
signed-in pharmacy and role.

The Purchases and suppliers page lists the latest 100 pharmacy-scoped purchase
records, their received item lines and the supplier directory. Purchases are
created atomically when a batch is received; administrators can add suppliers
from the batch receipt form.

## Stock adjustments

The Stock adjustments page uses the `adjust_stock()` RPC to add or remove
units from a batch. Every change requires a reason and is written with the
batch update in one database transaction. The function checks the signed-in
pharmacy and role, locks the batch, and prevents negative stock. It also permits
a positive physical-count correction that exceeds the original received
quantity.

The initial schema does not include that RPC. Apply only
`supabase/migrations/20261120204000_stock_adjustments.sql` to the hosted
project; it is safe to rerun and does not recreate or drop tables. Do not rerun
the initial schema.

The Alerts page calculates expiry risk from the pharmacy's current batch dates
on each page load. It separates expired stock from batches expiring within 30,
31–60, and 61–90 days. These are live informational alerts; they do not
quarantine stock, persist resolution state, or send email.

## Administration

Apply only
`supabase/migrations/20261120213200_admin_user_lifecycle.sql` after the existing
schema and feature migrations. It adds reversible staff deactivation and makes
inactive profiles fail the database role and pharmacy checks. Do not rerun the
initial schema.

Deploy `supabase/functions/admin-users` with the Supabase CLI:

```sh
supabase functions deploy admin-users
```

The function uses Supabase's server-side `SUPABASE_SERVICE_ROLE_KEY`; never
copy that key into browser code or send it in chat. The function verifies the
signed-in caller is an active administrator and derives the pharmacy from that
profile. Administrators can list staff, invite a staff member by email, change
another member's role, and deactivate or restore another member. The database
function blocks self-changes and prevents deactivating or downgrading the last
active administrator. Invitees set their own password through the invitation
link; the application does not send or handle staff passwords. Set the Edge
Function secret `APP_SITE_URL` to the deployed frontend origin and add
`<APP_SITE_URL>/login.html` to the Supabase Auth redirect allowlist before
sending invitations. Invitees verify the link and create a password of at
least 12 characters on the login page.

The Audit log page reads pharmacy-scoped events through the existing
administrator-only RLS policy, with date, record-type, and action filters. It
shows event metadata only; it does not display the stored before/after row
snapshots. The Settings page lets administrators update the pharmacy name and
county, which are recorded by the existing audit trigger. Kenya and the
synthetic/real dataset classification remain read-only. Light/dark appearance
is a browser-local preference and is not shared with other staff.

## Reorder recommendations

Apply only `supabase/migrations/20261120205200_reorder_recommendations.sql`
after the initial schema and stock-adjustment migration. Administrators can
configure a supplier lead time of 1–365 days on the Purchases and suppliers
page. A forecast run uses the supplier attached to the medicine's most recently
created batch; medicines without an active supplier or configured lead time
are skipped and reported by the forecasting service.

The Python service generates a suggestion only when usable, unexpired stock is
below the target. The target covers forecast demand over the supplier lead
time and the next 28-day review period. For lead times longer than the forecast
horizon, demand beyond day 28 is estimated using the 28-day average. Safety
stock is `ceil(1.65 × daily RMSE × sqrt(lead time))`, an assumed 95% service
level; weekly-series RMSE is converted to daily units. The stored rationale
records the input stock, forecast, lead time, RMSE, formula, and any horizon
extension. The recommendation date estimates when forecast depletion reaches
the lead-time demand plus safety-stock reorder point; it is not an order date.

The Python service calls the `recommendation-explanation` Supabase Edge
Function, which sends medicine identity, stock, supplier lead time, and
forecast-derived recommendation facts to an OpenAI-compatible provider. It
sends no supplier names, patient data, or patient identifiers. The provider
call is isolated in one function; configure `LLM_API_KEY` and, if needed,
`LLM_API_URL` and `LLM_MODEL` as Supabase Edge Function secrets, then deploy
`recommendation-explanation` from
`supabase/functions/recommendation-explanation`. The function accepts calls
only from the service-role forecasting backend and never writes to the
database. The Python service stores its
one-sentence explanation with the numerical rationale and falls back to the
raw stored figures if the wording includes an unsupported number.

The Reorder recommendations page reads only the latest forecast run.
Administrators and pharmacists can accept, modify, or dismiss a pending
suggestion through the pharmacy- and role-checked
`decide_reorder_recommendation()` RPC. These decisions are audited and never
create a purchase order; staff remain responsible for ordering and pharmacists
for final decisions.

## Phase 3: dashboard and reports

The dashboard reads pharmacy-scoped active medicine, unexpired batch, and
completed sale data. The sales chart shows the last seven Nairobi calendar
days. Low-stock counts and predicted demand are not displayed because there is
no configured stock threshold or connected forecasting service yet.

The Reports page provides daily, rolling seven-day, and current-month sales
reports, an inventory snapshot, and an expired/upcoming-expiry report.
Administrators and pharmacists can download the displayed report as CSV or use
the browser's print dialog to save it as PDF. Reports show only recorded sales
and stock data; they do not include payment method, tax, or customer details.
The dashboard chart uses Chart.js 4.4.7 from the jsDelivr CDN.

## Phase 4: forecasting service

The forecasting service reads completed sales and medicine metadata from
Supabase, fills missing daily dates with zero demand, caps high outliers by
the IQR rule, and aggregates a series to weeks when over 30% of its daily
observations in the training period are zero. IQR thresholds are estimated
from each training window only; if the training IQR is zero, values are left
uncapped rather than collapsing all positive intermittent demand to zero.
It evaluates a seasonal-naive baseline, Random Forest,
XGBoost, and Prophet with the fixed train/validation/test dates in the project
methodology and 28-day rolling-origin validation. It records MAE, RMSE, sMAPE,
baseline improvement, and a documented stock-out/expiry simulation in
`forecast_runs.metrics`, then writes 28 daily predictions per medicine to
`forecast_results`.

The Forecast page reads the latest pharmacy-scoped run and results from
Supabase using the signed-in user's session and publishable key. It is
read-only: the Python service remains responsible for model execution and
server-side writes. A pharmacy gets one forecast run containing each
medicine's selected model and results.

The historical stock simulation is explicitly hypothetical: opening stock is
assumed to equal 14 days of training-mean demand, the forecasted order covers
the evaluation horizon, and stock remaining at day 90 is counted as expired.
It is a comparison metric, not a reconstruction of actual pharmacy stock.

The synthetic demo pharmacy uses deterministic generated demand from
2022-01-01 through yesterday; it does not insert generated rows into sales.
Runs are labelled `synthetic` in `forecast_runs`. Real-pharmacy series without
enough history to cover the required evaluation periods are reported as
skipped; synthetic demand is never silently mixed into real-pharmacy sales.
Forecasts are decision support only, not clinical advice or automatic orders.

To run locally from the project root:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r forecasting/requirements.txt
cp forecasting/.env.example forecasting/.env
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong
`FORECAST_API_TOKEN` in `forecasting/.env`. The service-role key and forecast
token are server-only secrets: do not put them in `web/`, commit them, or send
them to the browser. The ignored `.env` file is loaded by the Python service.
The example also sets `FORECAST_PHARMACY_ID` to the seeded synthetic demo
pharmacy, so an initial run is scoped to that pharmacy. Confirm the ID matches
the target project before running; an unknown ID fails rather than falling
back to processing every pharmacy. Clear this setting only when the service
should process all pharmacies.

Run one forecast job:

```sh
python -m forecasting.service
```

Or start the protected API:

```sh
uvicorn forecasting.app:app --host 0.0.0.0 --port 8000
```

`GET /health` checks service availability. `POST /forecast/run` requires
`Authorization: Bearer <FORECAST_API_TOKEN>`. A production scheduler should
call that endpoint monthly, or execute the CLI as a scheduled job. The
evaluation notebook is `forecasting/evaluation.ipynb`; run it after installing
the requirements and selecting the project's Python environment in Jupyter.
Verify current package versions and the target host's scheduling and storage
features before deployment.

## Privacy and region

The application is intended to avoid patient names and identifiers; no patient
tables or patient data are included in this phase. Before using real pharmacy
data, document a data-protection impact assessment and the applicable
safeguards under Kenya's Data Protection Act 2019. The initial deployment
region to investigate is Singapore, subject to confirming that Supabase
currently offers it for the selected plan and project. Hosting outside Kenya
is a cross-border transfer: assess the data categories, transfer basis and
safeguards with the data controller/privacy adviser before loading personal or
sensitive data. This region and compliance assessment are not yet approved or
completed.

## Report status

No report claims are made here about real-data access, approvals, model
performance, deployment, or testing. Chapter 5 and Chapter 6, along with the
architecture and requirements updates, should describe only work completed
and evidence collected in later phases.
