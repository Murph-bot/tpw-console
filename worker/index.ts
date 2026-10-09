// Export the Workflow and Durable Object classes
export { MyWorkflow } from "./workflow";
export { ShipmentExceptionWorkflow } from "./shipment-exception-workflow";
export { WorkflowStatusDO } from "./durable-object";

import { isExceptionCode } from "./shipment-exception";
import { EXCEPTION_RESOLVED_EVENT } from "./shipment-exception-workflow";
import type { ExceptionResolvedPayload } from "./shipment-exception-workflow";

/**
 * Main Worker fetch handler
 *
 * Handles API routes and WebSocket upgrade requests for workflow management:
 * - POST /api/workflow/start - Create new workflow instance
 * - GET /api/workflow/status/:id - Get workflow status
 * - POST /api/workflow/event/:id - Send events to workflow
 * - POST /api/shipment-exceptions - Open a shipment exception case
 * - GET /api/shipment-exceptions/:id - Get exception case status
 * - POST /api/shipment-exceptions/:id/resolve - Resolve an exception case
 * - GET /ws - WebSocket connection for real-time updates
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// API: Open a shipment exception case
		if (url.pathname === "/api/shipment-exceptions" && request.method === "POST") {
			let body: {
				shipmentId?: unknown;
				exceptionCode?: unknown;
				note?: unknown;
			};
			try {
				body = await request.json();
			} catch {
				return Response.json({ error: "Invalid JSON body" }, { status: 400 });
			}

			if (typeof body.shipmentId !== "string" || !body.shipmentId) {
				return Response.json(
					{ error: "shipmentId is required" },
					{ status: 400 },
				);
			}
			if (!isExceptionCode(body.exceptionCode)) {
				return Response.json(
					{ error: "exceptionCode is not a known exception" },
					{ status: 400 },
				);
			}

			const caseId = crypto.randomUUID();
			try {
				await env.SHIPMENT_EXCEPTION_WORKFLOW.create({
					id: caseId,
					params: {
						shipmentId: body.shipmentId,
						exceptionCode: body.exceptionCode,
						detectedAt: new Date().toISOString(),
						note: typeof body.note === "string" ? body.note : undefined,
					},
				});
				return Response.json({ caseId }, { status: 201 });
			} catch {
				return Response.json(
					{ error: "Failed to open shipment exception" },
					{ status: 500 },
				);
			}
		}

		// API: Shipment exception case status, or resolve a case
		const exceptionMatch = url.pathname.match(
			/^\/api\/shipment-exceptions\/([^/]+)(\/resolve)?$/,
		);
		if (exceptionMatch) {
			const caseId = decodeURIComponent(exceptionMatch[1]);
			const isResolve = Boolean(exceptionMatch[2]);

			if (!isResolve && request.method === "GET") {
				try {
					const instance = await env.SHIPMENT_EXCEPTION_WORKFLOW.get(caseId);
					return Response.json(await instance.status());
				} catch {
					return Response.json(
						{ error: "Case not found" },
						{ status: 404 },
					);
				}
			}

			if (isResolve && request.method === "POST") {
				let body: Partial<ExceptionResolvedPayload>;
				try {
					body = await request.json();
				} catch {
					return Response.json({ error: "Invalid JSON body" }, { status: 400 });
				}
				if (typeof body.resolvedBy !== "string" || !body.resolvedBy) {
					return Response.json(
						{ error: "resolvedBy is required" },
						{ status: 400 },
					);
				}

				try {
					const instance = await env.SHIPMENT_EXCEPTION_WORKFLOW.get(caseId);
					await instance.sendEvent({
						type: EXCEPTION_RESOLVED_EVENT,
						payload: {
							resolvedBy: body.resolvedBy,
							note: body.note,
						} satisfies ExceptionResolvedPayload,
					});
					return Response.json({ success: true });
				} catch {
					return Response.json(
						{ error: "Failed to resolve case" },
						{ status: 500 },
					);
				}
			}
		}

		// API: Start a new workflow instance
		if (url.pathname === "/api/workflow/start" && request.method === "POST") {
			try {
				const instance = await env.MY_WORKFLOW.create({
					params: {
						timestamp: Date.now(),
					},
				});

				return Response.json({
					instanceId: instance.id,
					message: "Workflow started successfully",
				});
			} catch {
				return Response.json(
					{ error: "Failed to start workflow" },
					{ status: 500 },
				);
			}
		}

		// API: Get workflow status
		if (url.pathname.startsWith("/api/workflow/status/")) {
			const instanceId = url.pathname.split("/").pop();
			if (!instanceId) {
				return Response.json(
					{ error: "Instance ID required" },
					{ status: 400 },
				);
			}

			try {
				const instance = await env.MY_WORKFLOW.get(instanceId);
				const status = await instance.status();
				return Response.json(status);
			} catch {
				return Response.json(
					{ error: "Failed to get workflow status" },
					{ status: 500 },
				);
			}
		}

		// API: Send event to workflow instance
		if (
			url.pathname.startsWith("/api/workflow/event/") &&
			request.method === "POST"
		) {
			const instanceId = url.pathname.split("/").pop();
			if (!instanceId) {
				return Response.json(
					{ error: "Instance ID required" },
					{ status: 400 },
				);
			}

			try {
				const body = (await request.json()) as {
					approved: boolean;
					comment?: string;
				};
				const instance = await env.MY_WORKFLOW.get(instanceId);

				await instance.sendEvent({
					type: "user-approval",
					payload: body,
				});

				return Response.json({
					success: true,
					message: "Event sent successfully",
				});
			} catch {
				return Response.json(
					{ error: "Failed to send event" },
					{ status: 500 },
				);
			}
		}

		// WebSocket: Connect to workflow status updates
		if (url.pathname === "/ws") {
			const instanceId = url.searchParams.get("instanceId");
			if (!instanceId) {
				return new Response("instanceId query parameter required", {
					status: 400,
				});
			}

			const upgradeHeader = request.headers.get("Upgrade");
			if (upgradeHeader !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}

			try {
				const doId = env.WORKFLOW_STATUS.idFromName(instanceId);
				const stub = env.WORKFLOW_STATUS.get(doId);
				return stub.fetch(request);
			} catch {
				return new Response("Failed to establish WebSocket connection", {
					status: 500,
				});
			}
		}

		return Response.json({ error: "Not Found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
