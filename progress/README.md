# Progress Dashboard

## 1. Current status
- **Active sprint:** [Sprint 00: Foundations](sprint-00-foundations.md)
- **Current focus:** Setup tenancy and DB core in Sprint 01.
- **Next step:** Run migrations and verify DB roles.

## 2. Sprint index
| Sprint | Goal | Dates | Status | Tasks done / total | Link |
|---|---|---|---|---|---|
| Sprint 00 | Foundations | TBD | Active | 0/0 | [sprint-00-foundations.md](sprint-00-foundations.md) |
| Sprint 01 | Tenancy + DB core | TBD | Planned | 0/2 | [sprint-01-tenancy.md](sprint-01-tenancy.md) |

## 3. Planned phases
0. Foundations
1. Tenancy + DB core
2. Auth + RBAC (+ platform admin CLI, pending D5)
3. Catalog + Excel import
4. Orders + Stock (movements and low-stock alert)
5. Attar store (PWA, ar/fr)
6. Dashboard + Invoices
7. Security hardening
8. Staging and readiness
9. Pilot
10. Post-pilot review

## 4. Open decisions
| # | Decision | Recommendation | Answer |
|---|---|---|---|
| D1 | When is stock deducted? | At CONFIRMED, using the confirmed quantity | |
| D2 | Order quantity above available stock | Block in store; warn (don't block) at confirmation | |
| D3 | Invoice issuance | Manual button after DELIVERED | |
| D4 | Who issues invoices / edits stock | Owner, Admin, Employee; only Owner cancels an invoice | |
| D5 | Platform Admin in the pilot | CLI instead of UI | |
| D6 | Online payments | Out of scope (confirm) | |
| D7 | Weekly hours available | Assumption 15-25 h/week (confirm) | |
| D8 | Target pilot date | Unknown | |
| D9 | First distributor: catalogue size, number of attars | Unknown | |
| D10 | One invoice per order, or delivery note then periodic invoice? | Ask the distributor | |
| D11 | Defer stock or invoices to after the first pilot? | Decide after D7/D8 | |

## 5. Usage rules
- Maintain exactly one active sprint.
- Copy the template as `sprint-NN-short-slug.md` for new sprints.
- Update the active sprint file at the end of every session, then update its row in the index table.
- Never delete sprint files.
