OZ_TO_KG = 0.028349523125
samples = [24, 8, 16, 32]
for ounces in samples:
    print(ounces, round(ounces * OZ_TO_KG, 4))
