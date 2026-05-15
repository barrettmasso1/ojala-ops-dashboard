# Shopify Export Notes

## Exporting reports

Source: Shopify Help Center, "Exporting reports"

Confirmed current workflow:

- In Shopify admin, go to **Analytics > Reports**.
- Open the desired report.
- Use **... > Export**.
- Choose a file format when available.
- Shopify states exported files download to the device's default downloads folder.

Confirmed export formats Shopify lists for most reports:

- CSV
- XML
- JSONL
- Parquet

Confirmed note for some legacy finance reports:

- CSV may be the default format.
- Shopify may offer **Current page** versus **Full report** export options.

This supports recommending CSV as the first import format for Ojala because it is the simplest format for staff and manager uploads.

## Sales report notes

Source: Shopify Help Center, "Sales reports"

Key points confirmed from Shopify:

- Sales reports can be filtered from **Analytics > Reports** by choosing the **Sales** category.
- Shopify states sales reports are typically updated to within about one minute.
- Sales reports include useful product and order-based views such as sales by product.
- Shopify warns that sales reports include reversals such as refunds, cancellations, edits, and returns as negative values.
- Shopify notes that pending, unpaid, and canceled orders are included in sales reports, while test orders are not.

This means the Ojala import should prefer a product-level daily CSV, and the importer should either exclude or separately classify refunds, cancellations, and non-gelato items before using the data for flavor reconciliation.
