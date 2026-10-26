# Progress Dashboard

## 1. Current status
- **Active sprint:** [Sprint 03: Auth + Users](sprint-03-auth.md)
- **Current focus:** Setup `users`, `sessions`, and Argon2id session auth.
- **Next step:** Task 3.1 DB Schema & RLS for users and sessions.

## 2. Sprint index
| Sprint | Goal | Dates | Status | Tasks done / total | Link |
|---|---|---|---|---|---|
| Sprint 00 | Foundations | 2026-10-03 | Done | Completed | [sprint-00-foundations.md](sprint-00-foundations.md) |
| Sprint 01 | Tenancy + DB core | 2026-10-11 | Done | Completed | [sprint-01-tenancy.md](sprint-01-tenancy.md) |
| Sprint 02 | Tenancy Completion | 2026-10-19 → 2026-11-01 | Done | 5/5 | [sprint-02-tenancy.md](sprint-02-tenancy.md) |
| Sprint 03 | Auth + Users (Admin & Attar) | 2026-10-26 → 2026-11-08 | Planned | 0/7 | [sprint-03-auth.md](sprint-03-auth.md) |

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
