/**
 * Exercises the `agent-event-bridge` functions that fan runtime lifecycle,
 * action, evaluator, and connector-message events into `AgentEventService`
 * streams and guarded inbox notifications, including the no-service no-op path.
 * Runs through a real AgentRuntime with registered event and notification services.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCharacter } from "../character.ts";
import { registerConnectorSourceMetadata } from "../connectors.ts";
import { InMemoryDatabaseAdapter } from "../database/inMemoryAdapter.ts";
import { AgentRuntime } from "../runtime.ts";
import type { AgentEventPayload } from "../types/agentEvent.ts";
import type {
	ActionEventPayload,
	EvaluatorEventPayload,
	MessagePayload,
} from "../types/events.ts";
import { EventType } from "../types/events.ts";
import { ChannelType } from "../types/primitives.ts";
import type { IAgentRuntime } from "../types/runtime.ts";
import { ServiceType } from "../types/service.ts";
import {
	bridgeActionCompletedToStreams,
	bridgeActionStartedToStreams,
	bridgeConnectorMessageReceivedToStreams,
	bridgeEvaluatorCompletedToStreams,
	bridgeEvaluatorStartedToStreams,
	bridgeMessageReceivedToStreams,
	bridgeRunEndedToStreams,
	bridgeRunStartedToStreams,
	CONNECTOR_MESSAGE_RECEIVED_EVENT_TYPES,
} from "./agent-event-bridge.ts";
import { AgentEventService } from "./agentEvent.ts";
import { NotificationService } from "./notification.ts";

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";
const WORLD_ID = "33333333-3333-3333-3333-333333333333";

async function createCtx(opts: { withService?: boolean } = {}): Promise<{
	runtime: AgentRuntime;
	runId: string;
	events: AgentEventPayload[];
	notificationService: NotificationService | null;
}> {
	const withService = opts.withService ?? true;
	const events: AgentEventPayload[] = [];
	const runtime = new AgentRuntime({
		character: createCharacter({ name: "AgentEventBridgeIntegrationAgent" }),
		adapter: new InMemoryDatabaseAdapter(),
		logLevel: "fatal",
		enableAutonomy: false,
	});
	await runtime.initialize();
	const runId = runtime.startRun();
	let notificationService: NotificationService | null = null;
	if (withService) {
		await runtime.registerPlugin({
			name: "agent-event-bridge-integration-test",
			description: "Real services for event bridge integration coverage",
			services: [AgentEventService, NotificationService],
		});
		const service = (await runtime.getServiceLoadPromise(
			ServiceType.AGENT_EVENT,
		)) as AgentEventService;
		notificationService = (await runtime.getServiceLoadPromise(
			ServiceType.NOTIFICATION,
		)) as NotificationService;
		service.subscribe((event) => events.push(event));
	}
	activeRuntimes.push(runtime);
	return { runtime, runId, events, notificationService };
}

const activeRuntimes: AgentRuntime[] = [];

afterEach(async () => {
	await Promise.all(
		activeRuntimes.splice(0).map(async (runtime) => {
			await runtime.stop();
			await runtime.close();
		}),
	);
});

function actionPayload(
	runtime: IAgentRuntime,
	actionName: string,
	status: "executing" | "completed" | "failed",
): ActionEventPayload {
	return {
		runtime,
		roomId: ROOM_ID,
		world: WORLD_ID,
		content: {
			text: `Executing action: ${actionName}`,
			actions: [actionName],
			actionStatus: status,
			source: "client_chat",
		},
	} as unknown as ActionEventPayload;
}

function messagePayload(
	runtime: IAgentRuntime,
	overrides: Partial<MessagePayload> = {},
): MessagePayload {
	return {
		runtime,
		source: "discord",
		message: {
			id: "44444444-4444-4444-4444-444444444444",
			entityId: "55555555-5555-5555-5555-555555555555",
			roomId: ROOM_ID,
			agentId: runtime.agentId,
			content: {
				text: "Can you check this?",
				source: "discord",
				channelType: ChannelType.DM,
				url: "https://discord.example/message/1",
			},
			metadata: {
				sessionKey: "discord:room:1",
				sender: { username: "alice" },
				wasMentioned: true,
			},
		},
		...overrides,
	} as unknown as MessagePayload;
}

async function emitMessageReceived(
	runtime: AgentRuntime,
	payload: MessagePayload,
): Promise<void> {
	await runtime.emitEvent(EventType.MESSAGE_RECEIVED, payload);
}

describe("agent-event-bridge", () => {
	it("populates the action + lifecycle streams on ACTION_STARTED", async () => {
		const { runtime, runId, events } = await createCtx();
		bridgeActionStartedToStreams(
			actionPayload(runtime, "WEB_SEARCH", "executing"),
		);

		const action = events.find((e) => e.stream === "action");
		expect(action).toBeDefined();
		expect(action?.runId).toBe(runId);
		expect(action?.data).toMatchObject({
			type: "start",
			actionName: "WEB_SEARCH",
		});

		const lifecycle = events.find((e) => e.stream === "lifecycle");
		expect(lifecycle?.data).toMatchObject({
			type: "action_start",
			actionName: "WEB_SEARCH",
		});
	});

	it("populates the action stream with success on ACTION_COMPLETED", async () => {
		const { runtime, events } = await createCtx();
		bridgeActionCompletedToStreams(
			actionPayload(runtime, "WEB_SEARCH", "completed"),
		);
		const action = events.find((e) => e.stream === "action");
		expect(action?.data).toMatchObject({
			type: "complete",
			actionName: "WEB_SEARCH",
			success: true,
		});
	});

	it("reports success=false when the action failed", async () => {
		const { runtime, events } = await createCtx();
		bridgeActionCompletedToStreams(actionPayload(runtime, "REPLY", "failed"));
		const action = events.find((e) => e.stream === "action");
		expect(action?.data).toMatchObject({ type: "complete", success: false });
	});

	it("populates the message stream on MESSAGE_RECEIVED (connector inbound)", async () => {
		const { runtime, runId, events } = await createCtx();
		bridgeMessageReceivedToStreams({
			runtime,
			message: {
				id: "44444444-4444-4444-4444-444444444444",
				roomId: ROOM_ID,
				entityId: "55555555-5555-5555-5555-555555555555",
				content: { text: "hello from discord", attachments: [] },
			},
		} as unknown as MessagePayload);

		const message = events.find((e) => e.stream === "message");
		expect(message).toBeDefined();
		expect(message?.runId).toBe(runId);
		expect(message?.data).toMatchObject({
			type: "received",
			content: "hello from discord",
			roomId: ROOM_ID,
			hasAttachments: false,
		});
	});

	it("no-ops MESSAGE_RECEIVED when the AgentEventService is absent", async () => {
		const { runtime, events } = await createCtx({ withService: false });
		bridgeMessageReceivedToStreams({
			runtime,
			message: {
				id: "44444444-4444-4444-4444-444444444444",
				content: { text: "x" },
			},
		} as unknown as MessagePayload);
		expect(events).toHaveLength(0);
	});

	it("populates the lifecycle stream on RUN_STARTED / RUN_ENDED", async () => {
		const { runtime, events } = await createCtx();
		bridgeRunStartedToStreams({
			runtime,
			runId: RUN_ID,
			messageId: ROOM_ID,
			roomId: ROOM_ID,
			entityId: WORLD_ID,
			startTime: 1,
			status: "started",
		} as unknown as Parameters<typeof bridgeRunStartedToStreams>[0]);
		bridgeRunEndedToStreams({
			runtime,
			runId: RUN_ID,
			messageId: ROOM_ID,
			roomId: ROOM_ID,
			entityId: WORLD_ID,
			startTime: 1,
			endTime: 6,
			duration: 5,
			status: "completed",
		} as unknown as Parameters<typeof bridgeRunEndedToStreams>[0]);

		const lifecycleTypes = events
			.filter((e) => e.stream === "lifecycle")
			.map((e) => e.data.type);
		expect(lifecycleTypes).toContain("run_start");
		expect(lifecycleTypes).toContain("run_end");
		const runEnd = events.find(
			(e) => e.stream === "lifecycle" && e.data.type === "run_end",
		);
		expect(runEnd?.data).toMatchObject({ success: true, duration: 5 });
	});

	it("clears per-run sequence state after RUN_ENDED (no map leak)", async () => {
		const { runtime } = await createCtx();
		const service = runtime.getService(
			ServiceType.AGENT_EVENT,
		) as AgentEventService;
		bridgeRunStartedToStreams({
			runtime,
			runId: RUN_ID,
			messageId: ROOM_ID,
			roomId: ROOM_ID,
			entityId: WORLD_ID,
			startTime: 1,
			status: "started",
		} as unknown as Parameters<typeof bridgeRunStartedToStreams>[0]);
		expect(service.getCurrentSeq(RUN_ID)).toBeGreaterThan(0);
		bridgeRunEndedToStreams({
			runtime,
			runId: RUN_ID,
			messageId: ROOM_ID,
			roomId: ROOM_ID,
			entityId: WORLD_ID,
			startTime: 1,
			endTime: 2,
			status: "completed",
		} as unknown as Parameters<typeof bridgeRunEndedToStreams>[0]);
		// seq reset to 0 → run context dropped.
		expect(service.getCurrentSeq(RUN_ID)).toBe(0);
	});

	it("populates the evaluator stream on EVALUATOR_STARTED / COMPLETED", async () => {
		const { runtime, events } = await createCtx();
		const base = {
			runtime,
			evaluatorId: WORLD_ID,
			evaluatorName: "post_turn",
		} as unknown as EvaluatorEventPayload;
		bridgeEvaluatorStartedToStreams(base);
		bridgeEvaluatorCompletedToStreams({
			...base,
			completed: true,
		} as EvaluatorEventPayload);

		const evals = events.filter((e) => e.stream === "evaluator");
		expect(evals.map((e) => e.data.type)).toEqual(["start", "complete"]);
		expect(evals[1]?.data).toMatchObject({
			evaluatorName: "post_turn",
			validated: true,
		});
	});

	it("bridges MESSAGE_RECEIVED to activity plus a guarded connector notification", async () => {
		const { runtime, events, notificationService } = await createCtx();
		await emitMessageReceived(runtime, messagePayload(runtime));

		const messageEvent = events.find((e) => e.stream === "message");
		expect(messageEvent?.runId).toBe("44444444-4444-4444-4444-444444444444");
		expect(messageEvent?.sessionKey).toBe("discord:room:1");
		expect(messageEvent?.data).toMatchObject({
			type: "received",
			channel: ChannelType.DM,
			userId: "55555555-5555-5555-5555-555555555555",
			roomId: ROOM_ID,
			content: "Can you check this?",
			hasAttachments: false,
		});

		if (!notificationService) throw new Error("NotificationService not loaded");
		const notifications = notificationService.list();
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toMatchObject({
			title: "New discord message from alice",
			body: "Can you check this?",
			category: "message",
			priority: "high",
			source: "discord",
			deepLink: "https://discord.example/message/1",
			groupKey: `message:discord:${ROOM_ID}`,
		});
	});

	it("does not create inbox notifications for local client chat or self messages", async () => {
		const { runtime, events, notificationService } = await createCtx();
		await emitMessageReceived(
			runtime,
			messagePayload(runtime, {
				source: "client_chat",
				message: {
					...messagePayload(runtime).message,
					content: {
						text: "local prompt",
						source: "client_chat",
						channelType: ChannelType.DM,
					},
				},
			} as Partial<MessagePayload>),
		);
		await emitMessageReceived(
			runtime,
			messagePayload(runtime, {
				message: {
					...messagePayload(runtime).message,
					entityId: runtime.agentId,
				},
			} as Partial<MessagePayload>),
		);

		expect(events.filter((e) => e.stream === "message")).toHaveLength(2);
		if (!notificationService) throw new Error("NotificationService not loaded");
		expect(notificationService.list()).toHaveLength(0);
	});

	it("does not create inbox notifications for programmatic API / internal sources", async () => {
		const { runtime, events, notificationService } = await createCtx();
		// REST `POST /agents/:id/message` (the LP3 "New API message" spam source,
		// including bench-harness traffic).
		await emitMessageReceived(
			runtime,
			messagePayload(runtime, {
				source: "agent_message_api",
				message: {
					...messagePayload(runtime).message,
					content: {
						text: "bench bench 3: reply with one short sentence",
						source: "agent_message_api",
						channelType: "API",
					},
				},
			} as Partial<MessagePayload>),
		);
		// OpenAI-compat `/v1/chat/completions`.
		await emitMessageReceived(
			runtime,
			messagePayload(runtime, {
				source: "compat_openai",
				message: {
					...messagePayload(runtime).message,
					content: {
						text: "compat prompt",
						source: "compat_openai",
						channelType: "API",
					},
				},
			} as Partial<MessagePayload>),
		);
		// A caller-chosen `platformName` becomes an arbitrary source label, but
		// the API route still stamps channelType API — the channel classifies it.
		await emitMessageReceived(
			runtime,
			messagePayload(runtime, {
				source: "my-custom-bot",
				message: {
					...messagePayload(runtime).message,
					content: {
						text: "custom platform prompt",
						source: "my-custom-bot",
						channelType: "API",
					},
				},
			} as Partial<MessagePayload>),
		);
		// The runtime talking to itself: scheduled trigger wake-up prompt.
		await emitMessageReceived(
			runtime,
			messagePayload(runtime, {
				source: "trigger-prompt",
				message: {
					...messagePayload(runtime).message,
					content: {
						text: 'Scheduled trigger "hydrate" fired. Do this now: drink water',
						source: "trigger-prompt",
					},
				},
			} as Partial<MessagePayload>),
		);

		// All four still light up the activity stream (the WS chat indicator)…
		expect(events.filter((e) => e.stream === "message")).toHaveLength(4);
		// …but none of them is a user-facing notification.
		if (!notificationService) throw new Error("NotificationService not loaded");
		expect(notificationService.list()).toHaveLength(0);
	});

	it("fails closed unless both source and channel are trusted user-facing connector provenance", async () => {
		const { runtime, notificationService } = await createCtx();
		const cases: Array<Partial<MessagePayload>> = [
			{
				source: "unknown-connector",
				message: {
					...messagePayload(runtime).message,
					content: {
						text: "unknown source with a user-looking channel",
						source: "unknown-connector",
						channelType: ChannelType.DM,
					},
				},
			} as Partial<MessagePayload>,
			{
				source: "discord",
				message: {
					...messagePayload(runtime).message,
					content: {
						text: "trusted source with internal channel",
						source: "discord",
						channelType: ChannelType.API,
					},
				},
			} as Partial<MessagePayload>,
			{
				source: "discord",
				message: {
					...messagePayload(runtime).message,
					content: {
						text: "trusted source with missing channel",
						source: "discord",
					},
				},
			} as Partial<MessagePayload>,
		];

		for (const item of cases) {
			await emitMessageReceived(runtime, messagePayload(runtime, item));
		}

		if (!notificationService) throw new Error("NotificationService not loaded");
		expect(notificationService.list()).toHaveLength(0);
	});

	it("notifies for trusted connector traffic and connector-registry extensions", async () => {
		const { runtime, notificationService } = await createCtx();
		await emitMessageReceived(runtime, messagePayload(runtime));

		registerConnectorSourceMetadata("custom-gateway", {
			aliases: ["custom-gateway"],
			sourceKind: "active",
		});
		await emitMessageReceived(
			runtime,
			messagePayload(runtime, {
				source: "custom-gateway",
				message: {
					...messagePayload(runtime).message,
					roomId: "77777777-7777-7777-7777-777777777777",
					content: {
						text: "registered extension",
						source: "custom-gateway",
						channelType: ChannelType.DM,
					},
				},
			} as Partial<MessagePayload>),
		);

		if (!notificationService) throw new Error("NotificationService not loaded");
		const titles = notificationService.list().map((item) => item.title);
		expect(titles).toHaveLength(2);
		expect(titles).toContain("New discord message from alice");
		expect(titles).toContain("New custom-gateway message from alice");
	});

	it("reports connector notification write failures through the runtime error boundary", async () => {
		const { runtime, notificationService } = await createCtx();
		if (!notificationService) throw new Error("NotificationService not loaded");
		vi.spyOn(notificationService, "notify").mockRejectedValueOnce(
			new Error("notification store unavailable"),
		);
		const reportError = vi.spyOn(runtime, "reportError");

		await emitMessageReceived(runtime, messagePayload(runtime));

		expect(reportError).toHaveBeenCalledWith(
			"AgentEventBridge.inboundNotify",
			expect.any(Error),
			expect.objectContaining({
				src: "agent-event-bridge",
				source: "discord",
				messageId: "44444444-4444-4444-4444-444444444444",
			}),
		);
	});

	it("coalesces repeated Discord DM bridge notifications into one inbox item", async () => {
		const { runtime, notificationService } = await createCtx();
		await emitMessageReceived(runtime, messagePayload(runtime));
		await emitMessageReceived(
			runtime,
			messagePayload(runtime, {
				message: {
					...messagePayload(runtime).message,
					id: "66666666-6666-6666-6666-666666666666",
					content: {
						text: "Retry payload should replace the same room group",
						source: "discord",
						channelType: ChannelType.DM,
					},
				},
			} as Partial<MessagePayload>),
		);

		if (!notificationService) throw new Error("NotificationService not loaded");
		const notifications = notificationService.list();
		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.groupKey).toBe(`message:discord:${ROOM_ID}`);
		expect(notifications[0]?.data?.count).toBe(2);
	});

	it("bridges raw connector message events that lack canonical Memory payloads", async () => {
		expect(CONNECTOR_MESSAGE_RECEIVED_EVENT_TYPES).toContain(
			"TWITCH_MESSAGE_RECEIVED",
		);

		const { runtime, events, notificationService } = await createCtx();
		await bridgeConnectorMessageReceivedToStreams("TWITCH_MESSAGE_RECEIVED", {
			runtime,
			source: "internal-api",
			accountId: "main",
			message: {
				id: "twitch-message-1",
				channel: "ops",
				text: "Check the stream health",
				user: {
					userId: "twitch-user-1",
					displayName: "Alice",
				},
				timestamp: new Date("2026-06-24T12:00:00.000Z"),
			},
		});

		const messageEvent = events.find((e) => e.stream === "message");
		expect(messageEvent).toMatchObject({
			runId: "twitch-message-1",
			sessionKey: "twitch:ops",
			data: {
				type: "received",
				channel: "ops",
				userId: "twitch-user-1",
				roomId: "ops",
				content: "Check the stream health",
				hasAttachments: false,
				deliveredAt: Date.parse("2026-06-24T12:00:00.000Z"),
			},
		});

		if (!notificationService) throw new Error("NotificationService not loaded");
		const notifications = notificationService.list();
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toMatchObject({
			title: "New ops message from Alice",
			body: "Check the stream health",
			category: "message",
			priority: "normal",
			source: "twitch",
			groupKey: "message:twitch:ops",
			data: {
				source: "twitch",
				messageId: "twitch-message-1",
				roomId: "ops",
				entityId: "twitch-user-1",
				accountId: "main",
			},
		});
	});

	it("fails closed for unregistered raw connector message event types", async () => {
		const { runtime, events, notificationService } = await createCtx();
		await bridgeConnectorMessageReceivedToStreams("INTERNAL_MESSAGE_RECEIVED", {
			runtime,
			source: "discord",
			message: {
				id: "internal-message-1",
				channel: "ops",
				text: "looks like a connector but is not registered",
			},
		});

		expect(events.filter((e) => e.stream === "message")).toHaveLength(0);
		if (!notificationService) throw new Error("NotificationService not loaded");
		expect(notificationService.list()).toHaveLength(0);
	});

	it("is a no-op (never throws) when AgentEventService is absent", async () => {
		const { runtime, events } = await createCtx({ withService: false });
		expect(() =>
			bridgeActionStartedToStreams(
				actionPayload(runtime, "WEB_SEARCH", "executing"),
			),
		).not.toThrow();
		expect(events).toHaveLength(0);
	});

	it("falls back to the runtime current run id when the payload omits one", async () => {
		const { runtime, runId, events } = await createCtx();
		// payload content has no runId → bridge uses runtime.getCurrentRunId()
		bridgeActionStartedToStreams(actionPayload(runtime, "REPLY", "executing"));
		expect(events[0]?.runId).toBe(runId);
	});
});
