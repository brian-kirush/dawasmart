ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS lead_time_days integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.suppliers'::regclass
            AND conname = 'suppliers_lead_time_days_check'
    ) THEN
        ALTER TABLE public.suppliers
            ADD CONSTRAINT suppliers_lead_time_days_check
            CHECK (
                lead_time_days IS NULL
                OR lead_time_days BETWEEN 1 AND 365
            );
    END IF;
END;
$$;

ALTER TABLE public.reorder_recommendations
    ADD COLUMN IF NOT EXISTS supplier_id uuid,
    ADD COLUMN IF NOT EXISTS lead_time_days integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.reorder_recommendations'::regclass
            AND conname = 'recommendations_supplier_pharmacy_fkey'
    ) THEN
        ALTER TABLE public.reorder_recommendations
            ADD CONSTRAINT recommendations_supplier_pharmacy_fkey
            FOREIGN KEY (supplier_id, pharmacy_id)
            REFERENCES public.suppliers (id, pharmacy_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.reorder_recommendations'::regclass
            AND conname = 'recommendations_lead_time_days_check'
    ) THEN
        ALTER TABLE public.reorder_recommendations
            ADD CONSTRAINT recommendations_lead_time_days_check
            CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 1 AND 365);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS recommendations_run_medicine_unique_idx
    ON public.reorder_recommendations (forecast_run_id, medicine_id);

CREATE OR REPLACE FUNCTION public.decide_reorder_recommendation(
    p_recommendation_id uuid,
    p_decision text,
    p_modified_quantity integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_pharmacy_id uuid;
    v_status text;
    v_decided_at timestamptz;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_REQUIRED';
    END IF;

    v_pharmacy_id := public.current_pharmacy_id();
    IF v_pharmacy_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_REQUIRED';
    END IF;
    IF COALESCE(
        public.current_app_role(),
        ''
    ) NOT IN ('administrator', 'pharmacist') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ROLE_NOT_ALLOWED';
    END IF;
    IF p_recommendation_id IS NULL
        OR p_decision IS NULL
        OR p_decision NOT IN ('accepted', 'modified', 'dismissed')
        OR (
            p_decision = 'modified'
            AND (p_modified_quantity IS NULL OR p_modified_quantity < 0)
        )
        OR (
            p_decision <> 'modified'
            AND p_modified_quantity IS NOT NULL
        )
    THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DECISION';
    END IF;

    SELECT recommendation.status
    INTO v_status
    FROM public.reorder_recommendations AS recommendation
    WHERE recommendation.id = p_recommendation_id
        AND recommendation.pharmacy_id = v_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOMMENDATION_UNAVAILABLE';
    END IF;
    IF v_status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOMMENDATION_ALREADY_DECIDED';
    END IF;

    UPDATE public.reorder_recommendations
    SET status = p_decision,
        modified_quantity = p_modified_quantity,
        decision_by = auth.uid(),
        decided_at = now()
    WHERE id = p_recommendation_id
        AND pharmacy_id = v_pharmacy_id
    RETURNING decided_at INTO v_decided_at;

    RETURN jsonb_build_object(
        'recommendation_id', p_recommendation_id,
        'status', p_decision,
        'modified_quantity', p_modified_quantity,
        'decided_at', v_decided_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_reorder_recommendation(uuid, text, integer)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_reorder_recommendation(uuid, text, integer)
    TO authenticated;
