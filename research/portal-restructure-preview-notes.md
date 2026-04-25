# Portal Restructure Preview Notes

## Opening form preview observations

- The `/portal/opening` route renders correctly with the new top navigation chips for **Portal Home**, **Opening Form**, and **Closing Form**.
- The opening form now starts with a compact header row for **Business Date**, **Staff Name**, and **Starting cash amount**.
- The ready-made gelato section is visibly separated into flavor cards, and each visible card places **Small Pans**, **Small Gross Weight kg**, **Large Pans**, and **Large Gross Weight kg** on one row at desktop width.
- Number inputs in the opening form load blank rather than showing zero defaults, which satisfies the request to remove zero placeholders.
- The front-counter stock section shows the requested side-by-side paired layout for cups, lids, spoons, and bags.
- The form is still long because every flavor remains visible in a single page, but the structure is now split away from the closing workflow and the per-flavor inputs are more compact than before.
- The opening checklist still renders grouped sections below the inventory and gelato areas.

## Closing form and Spanish preview observations

The `/portal/closing` route also renders with the same compact route navigation and a short summary at the top. The first closing row now groups **Business Date**, **Staff Name**, **Cash total counted**, and the **Matches system?** yes-or-no control together, which is a clear reduction in scrolling compared with the prior single-page portal. The closing stock section shows paired inventory inputs on shared rows, and the sales section combines cup counts, payment totals, and notes in the same route so staff no longer have to jump into a separate end-of-day page.

After switching the closing route to Spanish, the major route labels, field labels, and form headings translated correctly. The preview showed **Inicio del portal**, **Formulario de apertura**, **Formulario de cierre**, **Nombre del empleado**, **Total de caja contado**, **Sí**, **No**, **Charolas pequeñas**, **Peso bruto pequeño kg**, and **Gelato listo**, confirming that the rebuilt route-level translation coverage is active on visible controls.

## Shared staff login validation note

Attempting to open `/staff-login` in the live preview redirected into the authenticated manager dashboard because the browser session was already logged in as an owner or manager. That means the fresh shared-password login screen could not be re-tested end-to-end inside the current persisted browser session. The implemented staff-login code still routes shared-password staff users to the opening form path, but a clean-session manual check from the user is still the last remaining live-preview validation item.

## Gelato-row tightening validation

The opening and closing ready-made gelato sections no longer display the extra helper copy that previously sat under the section heading. In both routes, the visible flavor cards now place **Small Pans** directly beside **Small Gross Weight kg**, with **Large Pans** directly beside **Large Gross Weight kg** on the next row. The live preview confirmed that this tighter pair-based structure is rendering across the visible flavors in both the opening and closing forms.
