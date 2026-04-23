# Recipe Book Source Notes

The provided Google Sheet `Ojala Cookbook (flavors & ingredients)` contains one visible worksheet with a repeated recipe-block pattern.

| Column | Meaning |
| --- | --- |
| INGREDIENTS | Either the flavor header or the ingredient name |
| UNITS | Numeric quantity where available |
| UNIT TYPE | Measurement unit such as liters, bag, cup, grams, tsp, kilos, ml, or limes |
| COST PER UNIT | Currently populated only in some rows, most notably the base bag at 350 |
| TOTAL COST | Currently populated only where cost is already known, again mainly the base bag at 350 |
| PROCESS STEPS | Occasional free-text notes, such as the blended-watermelon and lime-juice clarifications |

The visible exported workbook currently includes recipe blocks for Vanilla, Chocolate, Cinnamon, Cookies & Cream, Choco Mint, Peanut Butter, Coffee, Strawberry, Lemon, Watermelon & Lime, Sweet Potato, Avocado, Wine, Orange Cacao, and Pistachio.

Across the parsed rows, each flavor is followed by its ingredient lines and then a blank separator row. The base ingredient appears repeatedly as `Base` with `1 bag`, `350` cost per unit, and `350` total cost, which means the first recipe-book version can already show partial ingredient costing even before all ingredient costs are filled in.

Several ingredients still have incomplete quantities, units, or costs. Examples include mint extract, mint, cacao cookie crumbles, and some fruit-related notes that appear in the `PROCESS STEPS` column rather than in structured quantity fields. The recipe book should therefore preserve available spreadsheet data exactly, while exposing placeholders for missing yield and cost-per-ounce values until those inputs are provided later.

## Current Dashboard Recipe-Book Findings

The manager dashboard already contains a `Recipe map and cookbook` section, but it is still an operations-style summary rather than a dedicated recipe book. It currently shows recipe cards with ingredient rows, batch cost, a pending-yield placeholder, and cost-per-ounce messaging.

The current recipe presentation reveals two issues that the dedicated recipe-book work should address:

| Area | Current behavior | Improvement needed |
| --- | --- | --- |
| Recipe completeness | The dashboard lists recipes and ingredients, but it is presented as a monitoring block inside the operations dashboard rather than as a clear recipe-book experience | Convert or expand this into a clearer cookbook section focused on flavor formulas |
| Ingredient cost matching | Some ingredients are mismatched to unrelated inventory items, such as water appearing matched to Watermelon in the current derived view | Tighten recipe-book display so ingredient costs are shown accurately and transparently, with placeholders where costs are still missing |
| Yield and cost per ounce | Yield is currently shown as pending, and cost per ounce cannot be computed yet | Keep visible placeholders until yield values are provided later |

The current dashboard confirms that the app already has backend recipe structures and a seeded recipe list, so the next step is to refine the recipe model and presentation rather than starting from zero.

## Confirmed Future Yield And Cost Update Path

The recipe book now derives every flavor card from the same seeded recipe and inventory records that power `buildRecipeCostSummaries()` in `server/db.ts`. That means future updates do not require UI rewrites. When a manager later fills in `batchYieldOunces` for a recipe record, the cookbook will automatically change the recipe from a `Pending` yield state to a numeric yield and will immediately compute `costPerOunce` as `batchCost / batchYieldOunces`.

Ingredient cost updates follow the same automatic path. If an ingredient has a matching inventory item with the same normalized unit and that inventory item carries a non-zero `costPerUnit`, the cookbook will use the live inventory cost. If the matched inventory item is still zero-priced, the cookbook now safely falls back to the seeded recipe-row cost instead of overwriting a known workbook value with zero. Any ingredient that still lacks both a usable inventory cost and a seeded recipe cost remains visibly marked as missing cost data, which keeps purchasing gaps transparent instead of guessing.

This means the remaining operational work is straightforward: managers can continue updating inventory costs in the inventory section and later add recipe yields in the recipe data, and the recipe-book totals plus cost-per-ounce values will refresh automatically from those stored values without needing additional structural changes.
