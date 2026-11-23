INSERT INTO public.pharmacies (id, name, county, dataset_kind)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'DawaSmart Synthetic Demo Pharmacy',
    'Nairobi',
    'synthetic'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.suppliers (id, pharmacy_id, name)
VALUES
    (
        '22222222-2222-4222-8222-222222222221',
        '11111111-1111-4111-8111-111111111111',
        'Synthetic Demo Supplier A'
    ),
    (
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'Synthetic Demo Supplier B'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.medicines (
    id,
    pharmacy_id,
    sku,
    generic_name,
    strength,
    dosage_form,
    dispensing_unit,
    therapeutic_class,
    demand_pattern
)
VALUES
    (
        '33333333-3333-4333-8333-333333333331',
        '11111111-1111-4111-8111-111111111111',
        'SYN-PARA-500',
        'Paracetamol',
        '500 mg',
        'Tablet',
        'tablet',
        'Analgesic',
        'acute'
    ),
    (
        '33333333-3333-4333-8333-333333333332',
        '11111111-1111-4111-8111-111111111111',
        'SYN-AMOX-500',
        'Amoxicillin',
        '500 mg',
        'Capsule',
        'capsule',
        'Antibiotic',
        'acute'
    ),
    (
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        'SYN-ORS',
        'Oral rehydration salts',
        'Standard',
        'Powder',
        'sachet',
        'Rehydration',
        'acute'
    ),
    (
        '33333333-3333-4333-8333-333333333334',
        '11111111-1111-4111-8111-111111111111',
        'SYN-MET-500',
        'Metformin',
        '500 mg',
        'Tablet',
        'tablet',
        'Antidiabetic',
        'chronic'
    ),
    (
        '33333333-3333-4333-8333-333333333335',
        '11111111-1111-4111-8111-111111111111',
        'SYN-CET-10',
        'Cetirizine',
        '10 mg',
        'Tablet',
        'tablet',
        'Antihistamine',
        'acute'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.batches (
    id,
    pharmacy_id,
    medicine_id,
    supplier_id,
    batch_number,
    manufacture_date,
    expiry_date,
    quantity_received,
    quantity_on_hand,
    unit_cost
)
VALUES
    (
        '44444444-4444-4444-8444-444444444441',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333331',
        '22222222-2222-4222-8222-222222222221',
        'SYN-PARA-A',
        current_date - 120,
        current_date + 240,
        500,
        350,
        1.50
    ),
    (
        '44444444-4444-4444-8444-444444444442',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333332',
        '22222222-2222-4222-8222-222222222222',
        'SYN-AMOX-A',
        current_date - 90,
        current_date + 150,
        200,
        80,
        8.00
    ),
    (
        '44444444-4444-4444-8444-444444444443',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222221',
        'SYN-ORS-A',
        current_date - 60,
        current_date + 55,
        300,
        120,
        6.00
    ),
    (
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333334',
        '22222222-2222-4222-8222-222222222222',
        'SYN-MET-A',
        current_date - 180,
        current_date + 400,
        600,
        420,
        2.25
    ),
    (
        '44444444-4444-4444-8444-444444444445',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333335',
        '22222222-2222-4222-8222-222222222221',
        'SYN-CET-A',
        current_date - 75,
        current_date + 85,
        150,
        35,
        3.00
    )
ON CONFLICT (id) DO NOTHING;
