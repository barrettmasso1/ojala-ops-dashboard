KG_TO_OZ = 35.27396195
pan_data = {
    'large': {'empty_g': 400, 'full_total_kg': 4.3, 'capacity_l': 5.0},
    'small': {'empty_g': 286, 'full_total_kg': 1.9, 'capacity_l': 3.5},
}
for name, data in pan_data.items():
    empty_kg = data['empty_g'] / 1000
    net_gelato_kg = data['full_total_kg'] - empty_kg
    net_gelato_oz = net_gelato_kg * KG_TO_OZ
    print(name, round(empty_kg, 3), round(net_gelato_kg, 3), round(net_gelato_oz, 2))
