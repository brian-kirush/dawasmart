CREATE TABLE public.pharmacies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (btrim(name) <> ''),
    county text,
    country_code text NOT NULL DEFAULT 'KE' CHECK (country_code = 'KE'),
    dataset_kind text NOT NULL DEFAULT 'synthetic'
        CHECK (dataset_kind IN ('synthetic', 'real')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    full_name text NOT NULL CHECK (btrim(full_name) <> ''),
    role text NOT NULL CHECK (role IN ('administrator', 'pharmacist')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, pharmacy_id)
);

CREATE TABLE public.medicines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    sku text NOT NULL CHECK (btrim(sku) <> ''),
    generic_name text NOT NULL CHECK (btrim(generic_name) <> ''),
    brand_name text,
    strength text,
    dosage_form text,
    dispensing_unit text NOT NULL CHECK (btrim(dispensing_unit) <> ''),
    therapeutic_class text,
    demand_pattern text NOT NULL DEFAULT 'unknown'
        CHECK (demand_pattern IN ('chronic', 'acute', 'unknown')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pharmacy_id, sku),
    UNIQUE (id, pharmacy_id)
);

CREATE TABLE public.suppliers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    name text NOT NULL CHECK (btrim(name) <> ''),
    contact_name text,
    phone text,
    email text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, pharmacy_id)
);

CREATE TABLE public.purchases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    supplier_id uuid NOT NULL,
    purchase_number text NOT NULL CHECK (btrim(purchase_number) <> ''),
    purchase_date date NOT NULL DEFAULT current_date,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),
    created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pharmacy_id, purchase_number),
    UNIQUE (id, pharmacy_id),
    FOREIGN KEY (supplier_id, pharmacy_id)
        REFERENCES public.suppliers (id, pharmacy_id)
);

CREATE TABLE public.purchase_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    purchase_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
    quantity_received integer NOT NULL DEFAULT 0
        CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered),
    unit_cost numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (purchase_id, pharmacy_id)
        REFERENCES public.purchases (id, pharmacy_id),
    FOREIGN KEY (medicine_id, pharmacy_id)
        REFERENCES public.medicines (id, pharmacy_id)
);

CREATE TABLE public.batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    medicine_id uuid NOT NULL,
    supplier_id uuid,
    batch_number text NOT NULL CHECK (btrim(batch_number) <> ''),
    manufacture_date date,
    expiry_date date NOT NULL,
    quantity_received integer NOT NULL CHECK (quantity_received >= 0),
    quantity_on_hand integer NOT NULL CHECK (
        quantity_on_hand >= 0 AND quantity_on_hand <= quantity_received
    ),
    unit_cost numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (manufacture_date IS NULL OR manufacture_date <= expiry_date),
    UNIQUE (pharmacy_id, medicine_id, batch_number),
    UNIQUE (id, pharmacy_id),
    UNIQUE (id, pharmacy_id, medicine_id),
    FOREIGN KEY (medicine_id, pharmacy_id)
        REFERENCES public.medicines (id, pharmacy_id),
    FOREIGN KEY (supplier_id, pharmacy_id)
        REFERENCES public.suppliers (id, pharmacy_id)
);

CREATE TABLE public.sales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    receipt_number text NOT NULL CHECK (btrim(receipt_number) <> ''),
    sale_type text NOT NULL DEFAULT 'sale' CHECK (sale_type IN ('sale', 'return')),
    sold_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pharmacy_id, receipt_number),
    UNIQUE (id, pharmacy_id)
);

CREATE TABLE public.sale_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    sale_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, pharmacy_id, medicine_id),
    FOREIGN KEY (sale_id, pharmacy_id)
        REFERENCES public.sales (id, pharmacy_id),
    FOREIGN KEY (medicine_id, pharmacy_id)
        REFERENCES public.medicines (id, pharmacy_id)
);

CREATE TABLE public.sale_item_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    sale_item_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sale_item_id, batch_id),
    FOREIGN KEY (sale_item_id, pharmacy_id, medicine_id)
        REFERENCES public.sale_items (id, pharmacy_id, medicine_id),
    FOREIGN KEY (batch_id, pharmacy_id, medicine_id)
        REFERENCES public.batches (id, pharmacy_id, medicine_id)
);

CREATE TABLE public.stock_adjustments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    batch_id uuid NOT NULL,
    quantity_change integer NOT NULL CHECK (quantity_change <> 0),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    adjusted_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (batch_id, pharmacy_id)
        REFERENCES public.batches (id, pharmacy_id)
);

CREATE TABLE public.forecast_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    dataset_kind text NOT NULL CHECK (dataset_kind IN ('synthetic', 'real')),
    model_name text NOT NULL CHECK (btrim(model_name) <> ''),
    training_start date NOT NULL,
    training_end date NOT NULL,
    horizon_days integer NOT NULL DEFAULT 28 CHECK (horizon_days = 28),
    metrics jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metrics) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (training_start <= training_end),
    UNIQUE (id, pharmacy_id)
);

CREATE TABLE public.forecast_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    forecast_run_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    forecast_date date NOT NULL,
    predicted_demand numeric(12, 3) NOT NULL CHECK (predicted_demand >= 0),
    lower_bound numeric(12, 3),
    upper_bound numeric(12, 3),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (lower_bound IS NULL OR lower_bound >= 0),
    CHECK (upper_bound IS NULL OR upper_bound >= 0),
    CHECK (
        lower_bound IS NULL OR upper_bound IS NULL OR lower_bound <= upper_bound
    ),
    UNIQUE (forecast_run_id, medicine_id, forecast_date),
    FOREIGN KEY (forecast_run_id, pharmacy_id)
        REFERENCES public.forecast_runs (id, pharmacy_id),
    FOREIGN KEY (medicine_id, pharmacy_id)
        REFERENCES public.medicines (id, pharmacy_id)
);

CREATE TABLE public.reorder_recommendations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    medicine_id uuid NOT NULL,
    forecast_run_id uuid,
    recommendation_date date NOT NULL DEFAULT current_date,
    recommended_quantity integer NOT NULL CHECK (recommended_quantity >= 0),
    safety_stock integer NOT NULL CHECK (safety_stock >= 0),
    rationale jsonb NOT NULL CHECK (jsonb_typeof(rationale) = 'object'),
    explanation text NOT NULL CHECK (btrim(explanation) <> ''),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'modified', 'dismissed')),
    modified_quantity integer CHECK (modified_quantity >= 0),
    decision_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'modified') = (modified_quantity IS NOT NULL)),
    FOREIGN KEY (medicine_id, pharmacy_id)
        REFERENCES public.medicines (id, pharmacy_id),
    FOREIGN KEY (forecast_run_id, pharmacy_id)
        REFERENCES public.forecast_runs (id, pharmacy_id)
);

CREATE TABLE public.expiry_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    batch_id uuid NOT NULL,
    alert_date date NOT NULL DEFAULT current_date,
    threshold_days integer NOT NULL CHECK (threshold_days IN (30, 60, 90)),
    days_remaining integer NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolved_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id, alert_date, threshold_days),
    FOREIGN KEY (batch_id, pharmacy_id)
        REFERENCES public.batches (id, pharmacy_id)
);

CREATE TABLE public.audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pharmacy_id uuid,
    entity_table text NOT NULL,
    entity_id uuid,
    operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    actor_id uuid,
    old_data jsonb,
    new_data jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.assistant_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid NOT NULL REFERENCES public.pharmacies (id),
    user_id uuid NOT NULL,
    question text NOT NULL CHECK (btrim(question) <> ''),
    answer text NOT NULL,
    tools_used jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(tools_used) = 'array'),
    status text NOT NULL CHECK (status IN ('answered', 'unavailable', 'refused')),
    response_time_ms integer CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, pharmacy_id)
        REFERENCES public.profiles (id, pharmacy_id) ON DELETE CASCADE
);

CREATE INDEX profiles_pharmacy_idx ON public.profiles (pharmacy_id);
CREATE INDEX medicines_pharmacy_name_idx
    ON public.medicines (pharmacy_id, generic_name);
CREATE INDEX suppliers_pharmacy_name_idx
    ON public.suppliers (pharmacy_id, name);
CREATE INDEX purchases_pharmacy_date_idx
    ON public.purchases (pharmacy_id, purchase_date DESC);
CREATE INDEX purchase_items_medicine_idx
    ON public.purchase_items (pharmacy_id, medicine_id);
CREATE INDEX batches_fefo_idx
    ON public.batches (pharmacy_id, medicine_id, expiry_date, manufacture_date)
    WHERE quantity_on_hand > 0;
CREATE INDEX batches_expiry_idx
    ON public.batches (pharmacy_id, expiry_date);
CREATE INDEX sales_pharmacy_sold_at_idx
    ON public.sales (pharmacy_id, sold_at DESC);
CREATE INDEX sales_items_medicine_idx
    ON public.sale_items (pharmacy_id, medicine_id);
CREATE INDEX sale_item_batches_batch_idx
    ON public.sale_item_batches (pharmacy_id, batch_id);
CREATE INDEX stock_adjustments_batch_date_idx
    ON public.stock_adjustments (pharmacy_id, batch_id, created_at DESC);
CREATE INDEX forecast_runs_pharmacy_date_idx
    ON public.forecast_runs (pharmacy_id, created_at DESC);
CREATE INDEX forecast_results_medicine_date_idx
    ON public.forecast_results (pharmacy_id, medicine_id, forecast_date);
CREATE INDEX recommendations_pharmacy_status_date_idx
    ON public.reorder_recommendations
        (pharmacy_id, status, recommendation_date DESC);
CREATE INDEX recommendations_medicine_idx
    ON public.reorder_recommendations (pharmacy_id, medicine_id);
CREATE INDEX expiry_alerts_pharmacy_status_idx
    ON public.expiry_alerts (pharmacy_id, status, alert_date);
CREATE INDEX audit_log_pharmacy_date_idx
    ON public.audit_log (pharmacy_id, created_at DESC);
CREATE INDEX assistant_logs_user_date_idx
    ON public.assistant_logs (pharmacy_id, user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER medicines_set_updated_at
    BEFORE UPDATE ON public.medicines
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_pharmacy_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT p.pharmacy_id
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT p.role
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.current_pharmacy_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_pharmacy_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    old_row jsonb;
    new_row jsonb;
    row_data jsonb;
    row_pharmacy_id uuid;
    row_id uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        new_row := to_jsonb(NEW);
        row_data := new_row;
    ELSIF TG_OP = 'UPDATE' THEN
        old_row := to_jsonb(OLD);
        new_row := to_jsonb(NEW);
        row_data := new_row;
    ELSE
        old_row := to_jsonb(OLD);
        row_data := old_row;
    END IF;

    row_pharmacy_id := COALESCE(
        NULLIF(new_row ->> 'pharmacy_id', '')::uuid,
        NULLIF(old_row ->> 'pharmacy_id', '')::uuid
    );
    IF row_pharmacy_id IS NULL AND TG_TABLE_NAME = 'pharmacies' THEN
        row_pharmacy_id := (row_data ->> 'id')::uuid;
    END IF;
    row_id := NULLIF(row_data ->> 'id', '')::uuid;

    INSERT INTO public.audit_log (
        pharmacy_id,
        entity_table,
        entity_id,
        operation,
        actor_id,
        old_data,
        new_data
    )
    VALUES (
        row_pharmacy_id,
        TG_TABLE_NAME,
        row_id,
        TG_OP,
        auth.uid(),
        old_row,
        new_row
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'pharmacies',
        'profiles',
        'medicines',
        'suppliers',
        'purchases',
        'purchase_items',
        'batches',
        'sales',
        'sale_items',
        'sale_item_batches',
        'stock_adjustments',
        'forecast_runs',
        'forecast_results',
        'reorder_recommendations',
        'expiry_alerts',
        'assistant_logs'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.write_audit_log()',
            table_name,
            table_name
        );
    END LOOP;
END;
$$;

ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_item_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reorder_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expiry_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pharmacies_read_own ON public.pharmacies
    FOR SELECT TO authenticated
    USING (id = (SELECT public.current_pharmacy_id()));
CREATE POLICY pharmacies_admin_update ON public.pharmacies
    FOR UPDATE TO authenticated
    USING (
        id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    )
    WITH CHECK (
        id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    );

CREATE POLICY profiles_read_own_or_admin ON public.profiles
    FOR SELECT TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR (
            pharmacy_id = (SELECT public.current_pharmacy_id())
            AND (SELECT public.current_app_role()) = 'administrator'
        )
    );

CREATE POLICY medicines_read_pharmacy ON public.medicines
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY medicines_admin_insert ON public.medicines
    FOR INSERT TO authenticated
    WITH CHECK (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    );
CREATE POLICY medicines_admin_update ON public.medicines
    FOR UPDATE TO authenticated
    USING (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    )
    WITH CHECK (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    );
CREATE POLICY medicines_admin_delete ON public.medicines
    FOR DELETE TO authenticated
    USING (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    );

CREATE POLICY suppliers_read_pharmacy ON public.suppliers
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY suppliers_admin_insert ON public.suppliers
    FOR INSERT TO authenticated
    WITH CHECK (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    );
CREATE POLICY suppliers_admin_update ON public.suppliers
    FOR UPDATE TO authenticated
    USING (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    )
    WITH CHECK (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    );
CREATE POLICY suppliers_admin_delete ON public.suppliers
    FOR DELETE TO authenticated
    USING (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    );

CREATE POLICY purchases_read_pharmacy ON public.purchases
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY purchase_items_read_pharmacy ON public.purchase_items
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY batches_read_pharmacy ON public.batches
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY sales_read_pharmacy ON public.sales
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY sale_items_read_pharmacy ON public.sale_items
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY sale_item_batches_read_pharmacy ON public.sale_item_batches
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY stock_adjustments_read_pharmacy ON public.stock_adjustments
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY forecast_runs_read_pharmacy ON public.forecast_runs
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY forecast_results_read_pharmacy ON public.forecast_results
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY recommendations_read_pharmacy
    ON public.reorder_recommendations
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));
CREATE POLICY expiry_alerts_read_pharmacy ON public.expiry_alerts
    FOR SELECT TO authenticated
    USING (pharmacy_id = (SELECT public.current_pharmacy_id()));

CREATE POLICY audit_log_admin_read ON public.audit_log
    FOR SELECT TO authenticated
    USING (
        pharmacy_id = (SELECT public.current_pharmacy_id())
        AND (SELECT public.current_app_role()) = 'administrator'
    );
CREATE POLICY assistant_logs_user_or_admin_read ON public.assistant_logs
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR (
            pharmacy_id = (SELECT public.current_pharmacy_id())
            AND (SELECT public.current_app_role()) = 'administrator'
        )
    );

GRANT SELECT ON TABLE
    public.pharmacies,
    public.profiles,
    public.medicines,
    public.suppliers,
    public.purchases,
    public.purchase_items,
    public.batches,
    public.sales,
    public.sale_items,
    public.sale_item_batches,
    public.stock_adjustments,
    public.forecast_runs,
    public.forecast_results,
    public.reorder_recommendations,
    public.expiry_alerts,
    public.audit_log,
    public.assistant_logs
TO authenticated;

GRANT UPDATE ON public.pharmacies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.medicines, public.suppliers
TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
