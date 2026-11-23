CREATE OR REPLACE FUNCTION public.receive_batch(
    p_medicine_id uuid,
    p_supplier_id uuid,
    p_batch_number text,
    p_manufacture_date date,
    p_expiry_date date,
    p_quantity integer,
    p_unit_cost numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_pharmacy_id uuid;
    v_purchase_id uuid;
    v_batch_id uuid;
    v_purchase_number text;
    kenya_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
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
    IF p_medicine_id IS NULL
        OR p_supplier_id IS NULL
        OR p_batch_number IS NULL
        OR btrim(p_batch_number) = ''
        OR p_expiry_date IS NULL
        OR p_quantity IS NULL
        OR p_quantity <= 0
        OR p_unit_cost IS NULL
        OR p_unit_cost < 0
        OR p_unit_cost > 9999999999.99
        OR p_unit_cost <> round(p_unit_cost, 2)
        OR p_expiry_date < kenya_today
        OR (p_manufacture_date IS NOT NULL AND p_manufacture_date > kenya_today)
        OR (p_manufacture_date IS NOT NULL AND p_manufacture_date > p_expiry_date)
    THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_BATCH';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.medicines AS m
        WHERE m.id = p_medicine_id
            AND m.pharmacy_id = v_pharmacy_id
            AND m.is_active
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEDICINE_UNAVAILABLE';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.suppliers AS s
        WHERE s.id = p_supplier_id
            AND s.pharmacy_id = v_pharmacy_id
            AND s.is_active
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SUPPLIER_UNAVAILABLE';
    END IF;

    v_purchase_id := gen_random_uuid();
    v_batch_id := gen_random_uuid();
    v_purchase_number := 'P-' ||
        to_char(clock_timestamp() AT TIME ZONE 'Africa/Nairobi', 'YYYYMMDDHH24MISSMS') ||
        '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    INSERT INTO public.purchases (
        id, pharmacy_id, supplier_id, purchase_number, purchase_date, status, created_by
    )
    VALUES (
        v_purchase_id, v_pharmacy_id, p_supplier_id, v_purchase_number, kenya_today,
        'received', auth.uid()
    );

    INSERT INTO public.purchase_items (
        pharmacy_id, purchase_id, medicine_id, quantity_ordered,
        quantity_received, unit_cost
    )
    VALUES (
        v_pharmacy_id, v_purchase_id, p_medicine_id, p_quantity, p_quantity, p_unit_cost
    );

    INSERT INTO public.batches (
        id, pharmacy_id, medicine_id, supplier_id, batch_number,
        manufacture_date, expiry_date, quantity_received, quantity_on_hand, unit_cost
    )
    VALUES (
        v_batch_id, v_pharmacy_id, p_medicine_id, p_supplier_id, btrim(p_batch_number),
        p_manufacture_date, p_expiry_date, p_quantity, p_quantity, p_unit_cost
    );

    RETURN jsonb_build_object(
        'purchase_id', v_purchase_id,
        'purchase_number', v_purchase_number,
        'batch_id', v_batch_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_sale(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_pharmacy_id uuid;
    v_sale_id uuid;
    v_receipt_number text;
    line jsonb;
    v_medicine_id uuid;
    v_sale_item_id uuid;
    v_requested_quantity integer;
    v_requested_quantity_numeric numeric;
    v_remaining_quantity integer;
    v_allocated_quantity integer;
    v_unit_price numeric;
    total_amount numeric := 0;
    batch_row record;
    kenya_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
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
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SALE_ITEMS';
    END IF;
    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SALE_ITEMS';
    END IF;

    v_sale_id := gen_random_uuid();
    v_receipt_number := 'R-' ||
        to_char(clock_timestamp() AT TIME ZONE 'Africa/Nairobi', 'YYYYMMDDHH24MISSMS') ||
        '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    INSERT INTO public.sales (
        id, pharmacy_id, receipt_number, sale_type, created_by
    )
    VALUES (v_sale_id, v_pharmacy_id, v_receipt_number, 'sale', auth.uid());

    FOR line IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(line) <> 'object' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SALE_ITEMS';
        END IF;

        BEGIN
            v_medicine_id := nullif(line ->> 'medicine_id', '')::uuid;
            v_requested_quantity_numeric := nullif(line ->> 'quantity', '')::numeric;
            v_unit_price := nullif(line ->> 'unit_price', '')::numeric;
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SALE_ITEMS';
        END;

        IF v_medicine_id IS NULL
            OR v_requested_quantity_numeric IS NULL
            OR v_requested_quantity_numeric <> trunc(v_requested_quantity_numeric)
            OR v_requested_quantity_numeric <= 0
            OR v_requested_quantity_numeric > 2147483647
            OR v_unit_price IS NULL
            OR v_unit_price < 0
            OR v_unit_price > 9999999999.99
            OR v_unit_price <> round(v_unit_price, 2)
        THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SALE_ITEMS';
        END IF;
        v_requested_quantity := v_requested_quantity_numeric::integer;

        IF NOT EXISTS (
            SELECT 1
            FROM public.medicines AS m
            WHERE m.id = v_medicine_id
                AND m.pharmacy_id = v_pharmacy_id
                AND m.is_active
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEDICINE_UNAVAILABLE';
        END IF;

        INSERT INTO public.sale_items (
            pharmacy_id, sale_id, medicine_id, quantity, unit_price
        )
        VALUES (
            v_pharmacy_id, v_sale_id, v_medicine_id, v_requested_quantity, v_unit_price
        )
        RETURNING id INTO v_sale_item_id;

        v_remaining_quantity := v_requested_quantity;
        FOR batch_row IN
            SELECT b.id, b.quantity_on_hand
            FROM public.batches AS b
            WHERE b.pharmacy_id = v_pharmacy_id
                AND b.medicine_id = v_medicine_id
                AND b.quantity_on_hand > 0
                AND b.expiry_date >= kenya_today
            ORDER BY b.expiry_date, b.manufacture_date NULLS LAST, b.created_at, b.id
            FOR UPDATE
        LOOP
            v_allocated_quantity := least(v_remaining_quantity, batch_row.quantity_on_hand);
            UPDATE public.batches
            SET quantity_on_hand = quantity_on_hand - v_allocated_quantity
            WHERE id = batch_row.id;

            INSERT INTO public.sale_item_batches (
                pharmacy_id, sale_item_id, medicine_id, batch_id, quantity
            )
            VALUES (
                v_pharmacy_id, v_sale_item_id, v_medicine_id, batch_row.id, v_allocated_quantity
            );

            v_remaining_quantity := v_remaining_quantity - v_allocated_quantity;
            EXIT WHEN v_remaining_quantity = 0;
        END LOOP;

        IF v_remaining_quantity > 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
        END IF;

        total_amount := total_amount + v_requested_quantity * v_unit_price;
    END LOOP;

    RETURN jsonb_build_object(
        'sale_id', v_sale_id,
        'receipt_number', v_receipt_number,
        'total_amount', total_amount
    );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_batch(uuid, uuid, text, date, date, integer, numeric)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_sale(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_batch(uuid, uuid, text, date, date, integer, numeric)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale(jsonb) TO authenticated;
