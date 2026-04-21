# Ojala Ops Dashboard Architecture

The application will be structured as a **role-aware operations system** with two primary experiences. Employees authenticated with the standard user role will enter the system through a focused **form portal** that contains only the daily operating workflows: Opening Checklist, Closing Checklist, and End-of-Day Report. Owners and managers authenticated with the admin role will see a broader **management workspace** that includes searchable day-by-day reporting, checklist completion monitoring, week-over-week sales trends, inventory alerts, and a unified notes feed.

## Experience model

| Audience | Role | Primary experience | Core actions |
|---|---|---|---|
| Employees | `user` | Focused form portal | Submit opening, closing, and end-of-day forms |
| Owners / Managers | `admin` | Analytics dashboard | Review operational history, search daily performance, monitor alerts, and inspect notes |

## Core data model

| Table | Purpose | Key fields |
|---|---|---|
| `openingChecklists` | Stores opening workflow submissions | business date, staff name, equipment, cleanliness, setup, starting cash, cash match, store-ready status, notes |
| `closingChecklists` | Stores closing workflow submissions | business date, staff name, cash counted, cash match, cleaning, product storage, store-closed status, notes |
| `endOfDayReports` | Stores daily sales and operational submissions | business date, shift, staff name, cups by size, Cash, Card, Zelle, Venmo totals, waste notes, low-item notes, general notes |
| `inventoryItems` | Stores inventory and alert thresholds | category, item name, unit label, current quantity, par level, notes |

## Reporting model

The daily dashboard will be derived directly from submissions rather than from manually maintained summary tables. Sales totals, payment-method breakdowns, cups sold by size, and checklist completion rates will be aggregated from the underlying submission records. The notes feed will merge the latest low-item, waste, closing, and general-note entries into a single chronological list for faster review.

## Routing approach

| Route | Audience | Purpose |
|---|---|---|
| `/` | Public / signed-in users | Elegant landing and role-aware entry routing |
| `/portal` | Employees | Daily forms portal |
| `/dashboard` | Owners / managers | KPI view, searchable daily reporting, charts, alerts, and note feed |

## Notification model

Every successful form submission will trigger an owner notification summarizing the submission type, date, staff member, and any notable notes content. This keeps the owner informed without requiring constant dashboard monitoring.
