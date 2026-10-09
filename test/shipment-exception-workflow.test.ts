import { env, introspectWorkflowInstance } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
	EXCEPTION_POLICIES,
	MAX_ESCALATIONS,
	isExceptionCode,
	ownerAt,
	policyFor,
} from "../worker/shipment-exception";

const params = {
	shipmentId: "SHP-1001",
	exceptionCode: "customs_hold" as const,
	detectedAt: new Date().toISOString(),
};

describe("ShipmentExceptionWorkflow", () => {
	it("resolves when the resolution event arrives within the SLA", async () => {
		const instanceId = `case-${Date.now()}`;

		await using instance = await introspectWorkflowInstance(
			env.SHIPMENT_EXCEPTION_WORKFLOW,
			instanceId,
		);

		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockEvent({
				type: "exception-resolved",
				payload: { resolvedBy: "broker-42", note: "cleared" },
			});
		});

		await env.SHIPMENT_EXCEPTION_WORKFLOW.create({ id: instanceId, params });

		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
		await expect(instance.waitForStepResult({ name: "close case" })).resolves
			.toBeUndefined();
	});

	it("escalates on each SLA miss, then hands off after MAX_ESCALATIONS", async () => {
		const instanceId = `case-${Date.now()}`;

		await using instance = await introspectWorkflowInstance(
			env.SHIPMENT_EXCEPTION_WORKFLOW,
			instanceId,
		);

		await instance.modify(async (m) => {
			await m.disableSleeps();
			for (let level = 0; level <= MAX_ESCALATIONS; level++) {
				await m.forceEventTimeout({ name: `await resolution ${level}` });
			}
		});

		await env.SHIPMENT_EXCEPTION_WORKFLOW.create({ id: instanceId, params });

		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
		await expect(
			instance.waitForStepResult({ name: "hand off unresolved" }),
		).resolves.toBeUndefined();
	});
});

describe("shipment exception policy", () => {
	it("gives every exception code a non-empty escalation ladder", () => {
		for (const policy of Object.values(EXCEPTION_POLICIES)) {
			expect(policy.owners.length).toBeGreaterThan(0);
			expect(policy.slaHours).toBeGreaterThan(0);
		}
	});

	it("clamps the owner to the last rung of the ladder", () => {
		const policy = policyFor("damaged_in_transit");
		expect(ownerAt(policy, 0)).toBe("claims team");
		expect(ownerAt(policy, 99)).toBe(policy.owners[policy.owners.length - 1]);
	});

	it("accepts only known exception codes", () => {
		expect(isExceptionCode("dwell_time")).toBe(true);
		expect(isExceptionCode("lost_cargo")).toBe(false);
		expect(isExceptionCode(undefined)).toBe(false);
	});
});
