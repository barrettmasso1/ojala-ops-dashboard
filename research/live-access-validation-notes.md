# Live Access Validation Notes

## Preview validation summary

I validated the running web preview on the active project preview URL.

| Area | Finding |
| --- | --- |
| Home screen access split | The landing page now separates **Staff Login** from **Manager Login**, matching the requested shared-staff versus manager-only entry model. |
| Manager navigation | The sidebar shows **Dashboard**, **Cookbook**, and **Employee Portal**, confirming the new top-level cookbook route remains available in the manager experience. |
| Manager review coverage | The dashboard visibly includes summary cards for total sales, total cups sold, sold volume ounces, opening completion, closing completion, gelato discrepancy, and packaging discrepancy. |
| Daily submission visibility | The selected-day performance section shows opening submissions, closing submissions, latest report staff, checklist completion, gelato opening/closing/distributed volume ounces, sold volume ounces, and discrepancy review. |
| Packaging discrepancy review | The dashboard includes a service-item table for 4oz, 8oz, 16oz, and 32oz cups/lids plus to-go spoons, with opening count, closing count, expected used, actual used, variance, and review columns. |
| Inventory and ordering view | The dashboard includes inventory alerts and a manager-maintained inventory table with current inventory, par, reorder, and suggested reorder information. |
| Recipe and future cost view | The cookbook shows known ingredient cost totals, missing-cost indicators, yield placeholders, and pending cost-per-ounce states, which serve as current margin placeholders until final cost data is entered. |

## Remaining note

| Topic | Status |
| --- | --- |
| Mobile-specific verification | The responsive web app and access split are in place, but true on-device iPad and phone confirmation should still be done by the shop team after publish because this validation was performed in the preview environment rather than on physical hardware. |
