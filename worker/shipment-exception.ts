/**
 * Shipment exception policy
 *
 * Pure, deterministic rules the workflow reads from. Keeping them here (not
 * inside the workflow) means they can change without touching durable state,
 * and they are easy to unit test.
 */

export const EXCEPTION_CODES = [
	"customs_hold",
	"delivery_attempt_failed",
	"damaged_in_transit",
	"dwell_time",
] as const;

export type ExceptionCode = (typeof EXCEPTION_CODES)[number];

export type Severity = "low" | "medium" | "high" | "critical";

export interface ExceptionPolicy {
	severity: Severity;
	/** Hours each owner has to resolve before the case escalates. */
	slaHours: number;
	/** Ordered escalation ladder. Level 0 is the first owner. */
	owners: readonly string[];
}

export const EXCEPTION_POLICIES: Record<ExceptionCode, ExceptionPolicy> = {
	customs_hold: {
		severity: "high",
		slaHours: 24,
		owners: ["customs broker", "trade compliance lead", "logistics director"],
	},
	delivery_attempt_failed: {
		severity: "medium",
		slaHours: 8,
		owners: ["regional dispatcher", "operations manager", "operations director"],
	},
	damaged_in_transit: {
		severity: "critical",
		slaHours: 4,
		owners: ["claims team", "operations manager", "COO"],
	},
	dwell_time: {
		severity: "low",
		slaHours: 48,
		owners: ["yard supervisor", "operations manager", "operations director"],
	},
};

/** Number of escalations after the first owner before the case is handed off. */
export const MAX_ESCALATIONS = 3;

export function isExceptionCode(value: unknown): value is ExceptionCode {
	return (
		typeof value === "string" &&
		(EXCEPTION_CODES as readonly string[]).includes(value)
	);
}

export function policyFor(code: ExceptionCode): ExceptionPolicy {
	return EXCEPTION_POLICIES[code];
}

/** Owner responsible at a given escalation level. Clamps to the last owner. */
export function ownerAt(policy: ExceptionPolicy, level: number): string {
	return policy.owners[Math.min(level, policy.owners.length - 1)];
}
