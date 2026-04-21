# Ojala Operations Architecture

The application is being revised into a **role-aware operations system** with one unified Ojalá brand experience and two operational layers. Employees authenticated with the standard user role will enter through a focused **staff portal** containing only simple action-driven inputs, while owners and managers authenticated with the admin role will access a broader **management workspace** for reporting, checklist maintenance, inventory oversight, and operational review.

## Experience model

| Audience | Role | Primary experience | Core actions |
| --- | --- | --- | --- |
| Employees | `user` | Focused staff portal | Submit Opening, Closing, End-of-Day, and inventory count updates through direct task links |
| Owners / Managers | `admin` | Analytics and configuration workspace | Review reporting, inspect notes, manage inventory structure, and add or remove checklist questions over time |

## Revised checklist philosophy

The Opening and Closing workflows are no longer primarily open-ended text forms. They are being redesigned as **accountability-driven checklists** built around definitive confirmations. Each required action is presented as a yes-or-no or completed-or-not-completed control so the submission records whether the employee explicitly verified the task. When a negative or exception state is selected, the interface will reveal a follow-up detail field so the employee must explain the issue.

## Checklist structure model

| Checklist | Structure | Example behavior |
| --- | --- | --- |
| Ojalá Opening Checklist | Section-based yes/no confirmations plus a few required numeric or short-answer fields | If a freezer check is marked negative, the form prompts for issue details before submission |
| Ojalá Closing Checklist | Section-based yes/no confirmations plus cash total and issue notes | If cash does not match the system, the employee must provide clarifying notes |
| End-of-Day Report | Numeric and note-based operational reporting | Sales and cup counts remain structured inputs with fixed labels |

## Opening checklist baseline

The initial Opening checklist will include **Equipment**, **Cleanliness**, **Setup**, **Cash**, and **Final** sections, plus an **Employee Preparation** area so the employee explicitly confirms presentation and uniform readiness. The baseline question set will include the user-provided items such as freezer status, display stocking, gelato texture checks, machines running properly, cleanliness confirmations, setup stocking checks, starting cash, cash correctness, and store-ready confirmation.

## Closing checklist baseline

The initial Closing checklist will include **Money**, **Cleaning**, **Product**, and **Final** sections. The baseline question set will include the user-provided items such as cash total counted, whether the total matches the system, counters cleaned, floors cleaned, utensils washed, trash taken out, gelato stored properly, freezers closed and working, and store closed properly, along with issue notes.

## Manager-controlled checklist editing

Checklist questions must be **editable from the manager side** so the owner can evolve the operating standard over time. The management experience will support adding questions, removing questions, assigning each question to a checklist and section, and marking whether the question needs a follow-up detail field when the answer indicates a problem. This allows the checklists to become stricter as recurring staff omissions are discovered.

## Core data model direction

| Data area | Purpose | Direction |
| --- | --- | --- |
| Checklist templates | Stores editable checklist definitions | New structure for checklist type, section, prompt, answer style, display order, and conditional follow-up rules |
| Checklist responses | Stores employee answers to each required question | New structure for linking one submission to many question-level answers |
| End-of-day reports | Stores structured sales and notes | Keep current structured reporting model |
| Inventory items | Stores tracked inventory and par levels | Keep current inventory base, while allowing employee count updates and manager configuration |

## Routing approach

| Route | Audience | Purpose |
| --- | --- | --- |
| `/` | Public / signed-in users | Branded Ojalá access hub tied visually to the main customer site |
| `/portal` | Employees | Staff-only direct inputs for Opening, Closing, End-of-Day, and inventory counts |
| `/dashboard` | Owners / managers | Reporting, analytics, inventory management, and checklist maintenance |

## Notification model

Every successful form submission will continue to trigger an owner notification summarizing the submission type, date, staff member, and relevant operational context. As checklist questions become more structured, the notification layer can evolve to highlight failed confirmations or unresolved issues with greater precision.
