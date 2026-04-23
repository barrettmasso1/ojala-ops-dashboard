# Gelato Reconciliation Protocol

## Go-live operating model

The live Ojala gelato workflow uses a **full opening-versus-closing total-weight reconciliation model** rather than refill-transfer logging.

This decision was made to keep the employee process realistic for daily use while still giving management a clear discrepancy check against reported sales.

## Pan handling assumptions

Small pans are the **display pans** used for active service.
Large pans are the **reserve pans** used to hold extra product.

For the current live release, employees do **not** need to log each transfer from a large pan into a small pan.
Instead, the opening measurement should include the total on-hand gelato for the flavor, and the closing measurement should include the total remaining gelato for that same flavor.

Because the system compares the full beginning total against the full ending total, reserve-pan movement during service is implicitly covered by the day-level total reconciliation.

## Measurement rules

Employees should:

1. Weigh each flavor before opening.
2. Enter the number of small pans and their gross measured kilograms.
3. Enter the number of large pans and their gross measured kilograms.
4. Repeat the same measurement process at closing.

The system then converts the measured net gelato weight into equivalent serving volume ounces using the approved pan-specific calibration rules.

## Manager review logic

The manager dashboard compares:

- opening equivalent volume ounces,
- closing equivalent volume ounces, and
- sold volume ounces from the end-of-day report.

The difference is classified as either **Sample / minor discrepancy** or **Major discrepancy** so management can decide whether the gap looks operationally acceptable or needs follow-up.

## Deferred future enhancement

If Ojala later wants tighter refill auditing, a future enhancement can introduce explicit reserve-to-display transfer logging.
That is **not part of the current go-live workflow**.
