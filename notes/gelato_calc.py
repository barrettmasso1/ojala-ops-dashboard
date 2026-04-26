KG_TO_WEIGHT_OUNCES = 35.27396195
SMALL_PAN_EMPTY_KG = 0.286
LARGE_PAN_EMPTY_KG = 0.4
SMALL_PAN_FULL_WEIGHT_OUNCES = (1.9 - SMALL_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES
LARGE_PAN_FULL_WEIGHT_OUNCES = (4.3 - LARGE_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES
SMALL_PAN_FULL_VOLUME_OUNCES = 112
LARGE_PAN_FULL_VOLUME_OUNCES = 160

opening_small_count = 1
opening_small_kg = 1.52
opening_large_count = 1
opening_large_kg = 3.42
closing_small_count = 0
closing_small_kg = 0.0
closing_large_count = 0
closing_large_kg = 0.0

small_net_kg = max(0, opening_small_kg - opening_small_count * SMALL_PAN_EMPTY_KG)
large_net_kg = max(0, opening_large_kg - opening_large_count * LARGE_PAN_EMPTY_KG)
small_weight_oz = small_net_kg * KG_TO_WEIGHT_OUNCES
large_weight_oz = large_net_kg * KG_TO_WEIGHT_OUNCES
opening_vol_oz = (
    small_weight_oz * (SMALL_PAN_FULL_VOLUME_OUNCES / SMALL_PAN_FULL_WEIGHT_OUNCES)
    + large_weight_oz * (LARGE_PAN_FULL_VOLUME_OUNCES / LARGE_PAN_FULL_WEIGHT_OUNCES)
)
closing_vol_oz = 0.0
measured_distributed_vol_oz = opening_vol_oz - closing_vol_oz

print({
    "small_full_weight_oz": SMALL_PAN_FULL_WEIGHT_OUNCES,
    "large_full_weight_oz": LARGE_PAN_FULL_WEIGHT_OUNCES,
    "small_net_kg": small_net_kg,
    "large_net_kg": large_net_kg,
    "small_weight_oz": small_weight_oz,
    "large_weight_oz": large_weight_oz,
    "opening_vol_oz": opening_vol_oz,
    "closing_vol_oz": closing_vol_oz,
    "measured_distributed_vol_oz": measured_distributed_vol_oz,
})
