ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS profiles_active_pharmacy_role_idx
    ON public.profiles (pharmacy_id, role, is_active);

REVOKE UPDATE ON TABLE public.pharmacies FROM authenticated;
GRANT UPDATE (name, county) ON TABLE public.pharmacies TO authenticated;

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
        AND p.is_active
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
        AND p.is_active
$$;

CREATE OR REPLACE FUNCTION public.admin_manage_staff_profile(
    p_action text,
    p_user_id uuid,
    p_full_name text DEFAULT NULL,
    p_role text DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_pharmacy_id uuid;
    v_target public.profiles%ROWTYPE;
    v_active_admin_count bigint;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_REQUIRED';
    END IF;

    v_pharmacy_id := public.current_pharmacy_id();
    IF v_pharmacy_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_REQUIRED';
    END IF;
    IF COALESCE(public.current_app_role(), '') <> 'administrator' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ROLE_NOT_ALLOWED';
    END IF;

    PERFORM 1
    FROM public.pharmacies AS pharmacy
    WHERE pharmacy.id = v_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_REQUIRED';
    END IF;

    IF p_action = 'invite' THEN
        IF p_user_id IS NULL
            OR p_full_name IS NULL
            OR btrim(p_full_name) = ''
            OR length(btrim(p_full_name)) > 120
            OR p_role IS NULL
            OR p_role NOT IN ('administrator', 'pharmacist')
        THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STAFF_PROFILE';
        END IF;

        INSERT INTO public.profiles (
            id,
            pharmacy_id,
            full_name,
            role
        )
        VALUES (
            p_user_id,
            v_pharmacy_id,
            btrim(p_full_name),
            p_role
        )
        RETURNING * INTO v_target;
    ELSIF p_action = 'update' THEN
        IF p_user_id IS NULL
            OR p_role IS NULL
            OR p_role NOT IN ('administrator', 'pharmacist')
            OR p_is_active IS NULL
        THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STAFF_PROFILE';
        END IF;

        SELECT *
        INTO v_target
        FROM public.profiles AS profile
        WHERE profile.id = p_user_id
            AND profile.pharmacy_id = v_pharmacy_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STAFF_PROFILE_UNAVAILABLE';
        END IF;
        IF v_target.id = auth.uid() THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_MANAGE_SELF';
        END IF;

        IF v_target.role = 'administrator'
            AND v_target.is_active
            AND (p_role <> 'administrator' OR NOT p_is_active)
        THEN
            SELECT count(*)
            INTO v_active_admin_count
            FROM public.profiles AS profile
            WHERE profile.pharmacy_id = v_pharmacy_id
                AND profile.role = 'administrator'
                AND profile.is_active;

            IF v_active_admin_count <= 1 THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ADMIN_REQUIRED';
            END IF;
        END IF;

        UPDATE public.profiles AS profile
        SET role = p_role,
            is_active = p_is_active
        WHERE profile.id = p_user_id
            AND profile.pharmacy_id = v_pharmacy_id
        RETURNING * INTO v_target;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_ACTION';
    END IF;

    RETURN jsonb_build_object(
        'id', v_target.id,
        'pharmacy_id', v_target.pharmacy_id,
        'full_name', v_target.full_name,
        'role', v_target.role,
        'is_active', v_target.is_active,
        'created_at', v_target.created_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manage_staff_profile(
    text,
    uuid,
    text,
    text,
    boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_manage_staff_profile(
    text,
    uuid,
    text,
    text,
    boolean
) TO authenticated;
