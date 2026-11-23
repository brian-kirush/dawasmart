ALTER TABLE public.batches
    DROP CONSTRAINT IF EXISTS batches_quantity_on_hand_check;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.batches'::regclass
            AND conname = 'batches_quantity_on_hand_nonnegative_check'
    ) THEN
        ALTER TABLE public.batches
            ADD CONSTRAINT batches_quantity_on_hand_nonnegative_check
            CHECK (quantity_on_hand >= 0);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_stock(
    p_batch_id uuid,
    p_quantity_change integer,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_pharmacy_id uuid;
    v_current_quantity integer;
    v_new_quantity bigint;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_REQUIRED';
    END IF;

    v_pharmacy_id := public.current_pharmacy_id();
    IF v_pharmacy_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_REQUIRED';
    END IF;
    IF public.current_app_role() NOT IN ('administrator', 'pharmacist') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ROLE_NOT_ALLOWED';
    END IF;
    IF p_batch_id IS NULL
        OR p_quantity_change IS NULL
        OR p_quantity_change = 0
        OR p_reason IS NULL
        OR btrim(p_reason) = ''
        OR length(btrim(p_reason)) > 500
    THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_ADJUSTMENT';
    END IF;

    SELECT b.quantity_on_hand
    INTO v_current_quantity
    FROM public.batches AS b
    WHERE b.id = p_batch_id
        AND b.pharmacy_id = v_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BATCH_UNAVAILABLE';
    END IF;

    v_new_quantity := v_current_quantity::bigint + p_quantity_change::bigint;
    IF v_new_quantity < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
    END IF;
    IF v_new_quantity > 2147483647 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_ADJUSTMENT';
    END IF;

    INSERT INTO public.stock_adjustments (
        pharmacy_id,
        batch_id,
        quantity_change,
        reason,
        adjusted_by
    )
    VALUES (
        v_pharmacy_id,
        p_batch_id,
        p_quantity_change,
        btrim(p_reason),
        auth.uid()
    );

    UPDATE public.batches
    SET quantity_on_hand = v_new_quantity::integer
    WHERE id = p_batch_id
        AND pharmacy_id = v_pharmacy_id;

    RETURN jsonb_build_object(
        'batch_id', p_batch_id,
        'quantity_before', v_current_quantity,
        'quantity_change', p_quantity_change,
        'quantity_after', v_new_quantity
    );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, integer, text) TO authenticated;
