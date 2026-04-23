# Inventory and Recipe Source Notes

## Inventory structure from provided screenshots

The screenshots show two inventory groupings that should become part of the application data model.

### 1. Ingredient inventory

The ingredient inventory table contains these columns:

| Column | Meaning |
| --- | --- |
| Item Name | Ingredient or product name |
| Category | Group such as Base, Flavor, or Beverages |
| Unit Type | Counting unit such as bags, cups, kg, g, units, L, or packs |
| Pack Size | Purchase package size such as 1.4kg bag, 1 kg, 500 g, gallon, 5kg pack, box, or pack |
| Cost per Unit | Purchase cost per package or counted unit |
| Current Inventory | Current on-hand count |
| Par Level | Minimum desired stock |
| Reorder Qty | Recommended reorder quantity |
| Reorder? | Whether the item is below par |
| Last Count Date | Date of last inventory count |
| Supplier | Supplier name |
| Supplier Contact | Supplier contact details |
| Notes | Freeform notes |

Visible ingredient examples include Almond Base, Coco Base, Cacao, Cacao Butter, Vanilla, Cinnamon, Coffee, Peanut Butter, Strawberry, Lemon, Lime, Ginger, Watermelon, Passion Fruit, Avocado, Sweet Potato, Mint, Mint extract, Pistachio, Kambucha, and Topo Chicos.

### 2. Utensils and cleaning inventory

The utensils and cleaning inventory uses the same core columns and includes examples such as Edible Spoons, Bamboo To-Go Spoons, Dine-In Metal Spoons, 4oz To-Go Cups, 8oz To-Go Cups, 8oz To-Go Lids, 16oz To-Go Cups, 16oz To-Go Lids, 32oz To-Go Cups, 32oz To-Go Lids, To-Go Bags, and Napkins.

## Recipe spreadsheet structure from Google Sheets

The shared workbook is titled "Ojala Cookbook (flavors & ingredients)" and is viewable. The visible sheet is named "Sheet1".

The recipe sheet currently appears to use this column structure:

| Column | Meaning |
| --- | --- |
| Ingredients | Recipe name rows plus ingredient rows underneath |
| Units | Quantity amount |
| Unit Type | Measurement unit |
| Cost per Unit | Ingredient cost reference |
| Total Cost | Extended ingredient or batch cost |
| Process Steps | Preparation instructions |

The visible recipe layout is grouped by flavor sections, where a flavor name acts as a section header and the ingredients follow below it. Visible flavor sections include Vanilla, Chocolate, Cinnamon, Cookies & Cream, Choco Mint, Peanut Butter, Coffee, and Strawberry.

Visible ingredient row patterns show that recipes include items like Water, Base, Vanilla extract, Cacao powder, Cinnamon, cookie crumbles, Mint extract, Mint, Peanut butter, Coffee, and Strawberry (blended). Quantities shown include examples such as 3 liters, 1 bag, 1.5 cup, 1 cup, grams, and 3.5 liters.

## Implementation implications

The app should support separate concepts for inventory items, recipes, and recipe ingredients. Recipe ingredients should link back to inventory items where possible so cost and low-stock analysis can stay connected. The existing source materials also imply a need for unit normalization or at least clear unit labeling, because inventory uses mixed units across bags, cups, kilograms, grams, liters, packs, boxes, and units.

## Preview verification notes — 2026-04-22

The employee portal inventory section now renders in grouped department blocks. The preview shows an **Ingredients** group with 21 countable items and a **Utensils & Cleaning** group with 12 items. Within the second group, **Packaging** is visibly represented through the **To-Go Bags** item, alongside Cup/Lid, Utensil, and Other categories.

The manager dashboard preview now shows packaging explicitly in the inventory table under **Utensils & Cleaning → Packaging → To-Go Bags**. The cookbook section is visible and includes recipe cards with **batch cost**, **cost per ounce**, **missing cost counts**, **linked reorder items**, and an ingredient table with a **Purchasing status** column. The visible states include **Add cost** and **Needs reorder**, confirming that the recipe view now surfaces purchasing guidance tied to inventory mappings.
