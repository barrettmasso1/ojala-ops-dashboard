const GELATO_FLAVOR_ALIASES: Record<string, string> = {
  bananas: "Banana",
};

export function normalizeGelatoFlavorName(flavor: string) {
  const trimmed = flavor.trim();
  if (!trimmed) return "";
  return GELATO_FLAVOR_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
