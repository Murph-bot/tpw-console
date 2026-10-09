import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import {
	MAX_ESCALATIONS,
	type ExceptionCode,
	ownerAt,
	policyFor,
} from "./shipment-exception";

export interface ShipmentExceptionParams {
	shipmentId: string;
	exceptionCode: ExceptionCode;
	/** ISO timestamp of when the exception was detected upstream. */
	detectedAt: string;
	note?: string;
}

/** Payload expected on the "exception-resolved" event. */
export interface ExceptionResolvedPayload {
	resolvedBy: string;
	note?: string;
}

export type ShipmentExceptionResult =
	| { outcome: "resolved"; resolvedBy: string; escalations: number }
	| { outcome: "unresolved"; escalations: number };

export const EXCEPTION_RESOLVED_EVENT = "exception-resolved";

/**
 * ShipmentExceptionWorkflow
 *
 * Lifecycle of one shipment exception:
 * 1. Open a case and notify the first owner, per the policy ladder.
 * 2. Wait for an "exception-resolved" event within the owner's SLA.
 * 3. On SLA timeout, escalate to the next owner and wait again.
 * 4. Resolve as soon as the event arrives, or hand off after MAX_ESCALATIONS.
 *
 * Step names are derived from the escalation level, so each replay sees the
 * same names in the same order. Side effects live inside step.do.
 *
 * @see https://developers.cloudflare.com/workflows/build/rules-of-workflows/
 */
export class ShipmentExceptionWorkflow extends WorkflowEntrypoint<
	Env,
	ShipmentExceptionParams
> {
	async run(
		event: WorkflowEvent<ShipmentExceptionParams>,
		step: WorkflowStep,
	): Promise<ShipmentExceptionResult> {
		const { shipmentId, exceptionCode, detectedAt, note } = event.payload;
		const policy = policyFor(exceptionCode);

		await step.do("open case", async () => {
			// Hook point: persist the case to D1 here.
			console.log(
				JSON.stringify({
					event: "case_opened",
					caseId: event.instanceId,
					shipmentId,
					exceptionCode,
					severity: policy.severity,
					detectedAt,
					note,
					owner: ownerAt(policy, 0),
				}),
			);
		});

		let escalations = 0;

		while (true) {
			try {
				const resolution = await step.waitForEvent<ExceptionResolvedPayload>(
					`await resolution ${escalations}`,
					{
						type: EXCEPTION_RESOLVED_EVENT,
						timeout: `${policy.slaHours} hours`,
					},
				);

				await step.do("close case", async () => {
					// Hook point: mark the case closed in D1 here.
					console.log(
						JSON.stringify({
							event: "case_resolved",
							caseId: event.instanceId,
							shipmentId,
							resolvedBy: resolution.payload.resolvedBy,
							escalations,
						}),
					);
				});

				return {
					outcome: "resolved",
					resolvedBy: resolution.payload.resolvedBy,
					escalations,
				};
			} catch {
				// SLA window elapsed without a resolution event. Escalate below.
			}

			if (escalations >= MAX_ESCALATIONS) {
				break;
			}

			escalations++;
			const owner = ownerAt(policy, escalations);

			await step.do(`escalate to level ${escalations}`, async () => {
				// Hook point: notify the new owner (email, Slack, queue) here.
				console.log(
					JSON.stringify({
						event: "case_escalated",
						caseId: event.instanceId,
						shipmentId,
						level: escalations,
						owner,
					}),
				);
			});
		}

		await step.do("hand off unresolved", async () => {
			// Hook point: flag the case for manual handling in D1 here.
			console.log(
				JSON.stringify({
					event: "case_unresolved",
					caseId: event.instanceId,
					shipmentId,
					escalations,
				}),
			);
		});

		return { outcome: "unresolved", escalations };
	}
}
