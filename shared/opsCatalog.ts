export type InventoryCategory = "Base" | "Flavor" | "Beverages" | "Utensil" | "Cup/Lid" | "Packaging" | "Cleaning" | "Other";
export type InventoryDepartment = "Ingredients" | "Utensils & Cleaning";

export type InventorySeedItem = {
  department: InventoryDepartment;
  category: InventoryCategory;
  itemName: string;
  unitType: string;
  packSize: string;
  costPerUnit: string;
  currentInventory: string;
  parLevel: string;
  reorderQuantity: string;
  supplier: string;
  supplierContact: string;
  notes: string;
};

export type RecipeSeedItem = {
  recipeName: string;
  ingredientName: string;
  quantity: string;
  unitType: string;
  costPerUnit: string;
  totalCost: string;
  processSteps: string;
};

export const READY_MADE_GELATO_FLAVORS = [
  "Vanilla",
  "Chocolate",
  "Cinnamon",
  "Peanut Butter",
  "Coffee",
  "Ginger",
  "Lemon",
  "Mint Chip",
  "Cookies and Cream",
  "Passion Fruit",
  "Pistachio",
  "Strawberry",
  "Sweet Potato",
  "Watermelon",
] as const;

export const DEFAULT_INVENTORY_ITEMS: InventorySeedItem[] = [
  { department: "Ingredients", category: "Base", itemName: "Almond Base", unitType: "bags", packSize: "1.4kg bag", costPerUnit: "350.00", currentInventory: "0", parLevel: "5", reorderQuantity: "5", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Base", itemName: "Coco Base", unitType: "bags", packSize: "1.4kg bag", costPerUnit: "350.00", currentInventory: "0", parLevel: "3", reorderQuantity: "3", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Cacao", unitType: "cups", packSize: "1 kg", costPerUnit: "0.00", currentInventory: "0", parLevel: "2", reorderQuantity: "2", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Cacao Butter", unitType: "g", packSize: "500 g", costPerUnit: "0.00", currentInventory: "0", parLevel: "200", reorderQuantity: "200", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Vanilla", unitType: "cups", packSize: "gallon", costPerUnit: "0.00", currentInventory: "0", parLevel: "2", reorderQuantity: "2", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Cinnamon", unitType: "cups", packSize: "bag", costPerUnit: "0.00", currentInventory: "0", parLevel: "3", reorderQuantity: "3", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Coffee", unitType: "cups", packSize: "bag", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Peanut Butter", unitType: "cups", packSize: "10 gallon container", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Strawberry", unitType: "kg", packSize: "5kg pack", costPerUnit: "250.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Lemon", unitType: "kg", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Lime", unitType: "kg", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Ginger", unitType: "g", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Watermelon", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Passion Fruit", unitType: "L", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Avocado", unitType: "kg", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Sweet Potato", unitType: "kg", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Mint", unitType: "g", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Mint extract", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Flavor", itemName: "Pistachio", unitType: "kg", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Beverages", itemName: "Kambucha", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Ingredients", category: "Beverages", itemName: "Topo Chicos", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Utensil", itemName: "Edible Spoons", unitType: "units", packSize: "box", costPerUnit: "0.00", currentInventory: "0", parLevel: "500", reorderQuantity: "500", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Utensil", itemName: "Bamboo To-Go Spoons", unitType: "units", packSize: "box", costPerUnit: "0.00", currentInventory: "0", parLevel: "500", reorderQuantity: "500", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Utensil", itemName: "Dine-In Metal Spoons", unitType: "units", packSize: "set", costPerUnit: "0.00", currentInventory: "0", parLevel: "20", reorderQuantity: "20", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Cup/Lid", itemName: "4oz To-Go Cups", unitType: "boxes", packSize: "box", costPerUnit: "0.00", currentInventory: "0", parLevel: "5", reorderQuantity: "5", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Cup/Lid", itemName: "8oz To-Go Cups", unitType: "units", packSize: "pack", costPerUnit: "0.00", currentInventory: "0", parLevel: "20", reorderQuantity: "20", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Cup/Lid", itemName: "8oz To-Go Lids", unitType: "L", packSize: "1 L", costPerUnit: "0.00", currentInventory: "0", parLevel: "3", reorderQuantity: "3", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Cup/Lid", itemName: "16oz To-Go Cups", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Cup/Lid", itemName: "16oz To-Go Lids", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Cup/Lid", itemName: "32oz To-Go Cups", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Cup/Lid", itemName: "32oz To-Go Lids", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Packaging", itemName: "To-Go Bags", unitType: "units", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
  { department: "Utensils & Cleaning", category: "Other", itemName: "Napkins", unitType: "packs", packSize: "", costPerUnit: "0.00", currentInventory: "0", parLevel: "0", reorderQuantity: "0", supplier: "", supplierContact: "", notes: "" },
];

export const DEFAULT_RECIPE_ITEMS: RecipeSeedItem[] = [
  { recipeName: "Vanilla", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Vanilla", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Vanilla", ingredientName: "Vanilla extract", quantity: "1.5", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Chocolate", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Chocolate", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Chocolate", ingredientName: "Cacao powder", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Cinnamon", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Cinnamon", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Cinnamon", ingredientName: "Cinnamon", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Cookies & Cream", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Cookies & Cream", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Cookies & Cream", ingredientName: "Vanilla", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Cookies & Cream", ingredientName: "Cacao cookie crumbles", quantity: "0", unitType: "grams", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Choco Mint", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Choco Mint", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Choco Mint", ingredientName: "Cacao powder", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Choco Mint", ingredientName: "Mint extract", quantity: "0", unitType: "units", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Choco Mint", ingredientName: "Mint", quantity: "0", unitType: "grams", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Peanut Butter", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Peanut Butter", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Peanut Butter", ingredientName: "Peanut butter", quantity: "2", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Coffee", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Coffee", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Coffee", ingredientName: "Coffee", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Strawberry", ingredientName: "Strawberry (blended)", quantity: "3.5", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Strawberry", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Strawberry", ingredientName: "Lemon", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Strawberry", ingredientName: "Salt", quantity: "1", unitType: "tsp", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Lemon", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Lemon", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Lemon", ingredientName: "Lemon Juice", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Lemon", ingredientName: "Lemon Zest", quantity: "100", unitType: "grams", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Lemon", ingredientName: "Salt", quantity: "1", unitType: "tsp", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Watermelon & Lime", ingredientName: "Watermelon", quantity: "8.5", unitType: "kilos", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Watermelon & Lime", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Watermelon & Lime", ingredientName: "Lime", quantity: "18", unitType: "limes", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Watermelon & Lime", ingredientName: "Salt", quantity: "1", unitType: "tsp", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Sweet Potato", ingredientName: "Sweet Potato", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Sweet Potato", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Sweet Potato", ingredientName: "Cinnamon", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Avocado", ingredientName: "Avocado", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Avocado", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Avocado", ingredientName: "Cacao powder", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Wine", ingredientName: "Water", quantity: "2.2", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Wine", ingredientName: "Wine", quantity: "800", unitType: "ml", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Wine", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Wine", ingredientName: "Vanilla extract", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Orange Cacao", ingredientName: "Water", quantity: "2", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Orange Cacao", ingredientName: "Orange Juice", quantity: "1", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Orange Cacao", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Orange Cacao", ingredientName: "Cacao powder", quantity: "1", unitType: "cup", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Orange Cacao", ingredientName: "Orange Zest", quantity: "80", unitType: "g", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Pistachio", ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
  { recipeName: "Pistachio", ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
  { recipeName: "Pistachio", ingredientName: "Pistachio", quantity: "600", unitType: "grams", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
];
