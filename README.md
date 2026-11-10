# tpw-console

A shipment-exception console built on [Cloudflare Workflows](https://developers.cloudflare.com/workflows).
When a shipment hits a problem, a durable workflow opens a case, waits for the owner to resolve
it within the SLA, and escalates up a ladder of owners when the SLA runs out.

It started from Cloudflare's Workflows starter template. The template's demo workflow
(`MyWorkflow`, the animated diagram in the UI) is still in the repo next to the shipment
workflow.

## How the shipment workflow works

1. **Open case** — `POST /api/shipment-exceptions` starts one workflow instance per case.
2. **Wait for resolution** — the workflow pauses on `step.waitForEvent` for the SLA window
   of the current owner.
3. **Escalate** — if nobody resolves the case in time, it moves to the next owner. This
   repeats up to 3 escalations.
4. **Close or hand off** — a resolution closes the case; running out of escalations hands
   it off as unresolved.

The rules live in `worker/shipment-exception.ts` as plain data, separate from the workflow,
so they can change without touching durable state:

| Exception code | Severity | SLA per owner | Escalation ladder |
|---|---|---|---|
| `customs_hold` | high | 24 h | customs broker → trade compliance lead → logistics director |
| `delivery_attempt_failed` | medium | 8 h | regional dispatcher → operations manager → operations director |
| `damaged_in_transit` | critical | 4 h | claims team → operations manager → COO |
| `dwell_time` | low | 48 h | yard supervisor → operations manager → operations director |

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/shipment-exceptions` | Open a case. Body: `shipmentId`, `exceptionCode`, optional `note` |
| `GET` | `/api/shipment-exceptions/:caseId` | Case status |
| `POST` | `/api/shipment-exceptions/:caseId/resolve` | Resolve a case. Body includes `resolvedBy` |
| `POST` | `/api/workflow/start` | Start the template demo workflow |
| `GET` | `/ws` | WebSocket for live demo-workflow status |

## Layout

- `worker/` — Worker entry (`index.ts`), the two workflows, the policy table, and the
  Durable Object that pushes status over WebSockets
- `src/` — React front end (Vite, Tailwind)
- `test/` — Vitest tests that run inside the Workers runtime

## Commands

```bash
npm install
npm run dev      # local dev server on http://localhost:5173
npm test         # Vitest
npm run lint     # ESLint
npm run build    # typecheck + production build
npm run deploy   # build, then wrangler deploy
```
