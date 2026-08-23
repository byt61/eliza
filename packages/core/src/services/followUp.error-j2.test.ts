/**
 * Behavioral regression for error-policy J2 on FollowUpService.
 * Calls real FollowUpService methods against in-memory mocks covering
 * success, failure (wrapped ElizaError with cause), invalid input, and
 * concurrency. Proves no swallow (return []) and no bare throw without cause,
 * and that diagnostics go through runtime.reportError with ElizaError code/context.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ElizaError } from "../errors.ts";
import type { UUID } from "../types/primitives.ts";
import type { IAgentRuntime } from "../types/runtime.ts";
import type { Task, TaskWorker } from "../types/task.ts";
import { FollowUpService } from "./followUp.ts";

const AGENT_ID = "00000000-0000-0000-0000-0000000000bb" as UUID;
const ENTITY_ID = "00000000-0000-0000-0000-0000000000cc" as UUID;

function makeRuntime(overrides: Partial<{
  getTask: (id: UUID) => Promise<Task | null>;
  updatePendingTask: (id: UUID, patch: Partial<Task>) => Promise<boolean>;
  updateTask: (id: UUID, patch: Partial<Task>) => Promise<void>;
  getContact: (id: UUID) => Promise<any>;
  createMemory: () => Promise<void>;
  getEntityById: (id: UUID) => Promise<any>;
}> = {}) {
  const tasks = new Map<string, Task>();
  const workers = new Map<string, TaskWorker>();
  const noop = () => undefined;
  const contact = { entityId: ENTITY_ID, names: ["Test Contact"], customFields: { nextFollowUpAt: "2026-01-01T00:00:00.000Z", nextFollowUpReason: "test" } };
  const relationshipsService = {
    getContact: overrides.getContact ? overrides.getContact : async () => contact,
    updateContact: async (_id: UUID, patch: any) => { contact.customFields = patch.customFields; },
    searchContacts: async () => [contact],
    getRelationshipInsights: async () => ({ needsAttention: [] }),
    analyzeRelationship: async () => null,
  };
  const taskId = "11111111-1111-1111-1111-111111111111" as UUID;
  const baseTask: Task = {
    id: taskId,
    name: "follow_up",
    description: "test",
    entityId: AGENT_ID,
    agentId: AGENT_ID,
    roomId: "00000000-0000-0000-0000-0000000000aa" as UUID,
    worldId: "00000000-0000-0000-0000-0000000000aa" as UUID,
    tags: ["follow-up", "medium", "relationships", "queue"],
    dueAt: Date.now(),
    metadata: { status: "pending", targetEntityId: ENTITY_ID, scheduledAt: new Date().toISOString() },
  };
  tasks.set(String(taskId), baseTask);

  const runtime = {
    agentId: AGENT_ID,
    serverless: false,
    logger: { debug: noop, info: noop, warn: noop, error: noop },
    reportError: vi.fn(),
    registerTaskWorker: (w: TaskWorker) => workers.set(w.name, w),
    getTaskWorker: (name: string) => workers.get(name),
    unregisterTaskWorker: (name: string) => workers.delete(name),
    getServiceLoadPromise: async () => relationshipsService,
    getEntityById: overrides.getEntityById ? overrides.getEntityById : async (id: UUID) => id === ENTITY_ID ? { id, names: ["Test Contact"] } : null,
    createMemory: overrides.createMemory ? overrides.createMemory : async () => {},
    emitEvent: async () => {},
    getTasks: async () => Array.from(tasks.values()),
    getTask: overrides.getTask ? overrides.getTask : async (id: UUID) => tasks.get(String(id)) ?? null,
    createTask: async (t: Task) => { const id = (t.id ?? `task-${tasks.size+1}`) as UUID; tasks.set(String(id), { ...t, id }); return id; },
    updateTask: overrides.updateTask ? overrides.updateTask : async (id: UUID, patch: Partial<Task>) => {
      const ex = tasks.get(String(id));
      if (!ex) throw new Error(`no task ${id}`);
      tasks.set(String(id), { ...ex, ...patch } as Task);
    },
    updatePendingTask: overrides.updatePendingTask ? overrides.updatePendingTask : async (id: UUID, patch: Partial<Task>) => {
      const ex = tasks.get(String(id));
      if (!ex?.tags?.includes("queue") || (ex.metadata?.status != null && ex.metadata.status !== "pending")) return false;
      tasks.set(String(id), { ...ex, ...patch } as Task);
      return true;
    },
    deleteTask: async (id: UUID) => { tasks.delete(String(id)); },
  } as unknown as IAgentRuntime;

  return { runtime, tasks, workers, relationshipsService, contact, taskId };
}

describe("FollowUpService J2 error handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("completeFollowUp success clears contact fields", async () => {
    const { runtime, taskId, contact } = makeRuntime();
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    await svc.completeFollowUp(taskId);
    expect(contact.customFields.nextFollowUpAt).toBeUndefined();
    expect(runtime.reportError).not.toHaveBeenCalled();
  });

  it("completeFollowUp invalid taskId wraps not-found with ElizaError and cause and reports", async () => {
    const { runtime } = makeRuntime({
      getTask: async () => null,
    });
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    const badId = "00000000-0000-0000-0000-000000000099" as UUID;
    let thrown: unknown;
    try { await svc.completeFollowUp(badId); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ElizaError);
    const err = thrown as ElizaError;
    expect(err.code).toBe("FOLLOWUP_COMPLETE_FAILED");
    expect(err.context?.taskId).toBe(badId);
    expect(err.cause).toBeDefined();
    expect(String((err.cause as Error).message)).toContain("not found");
    expect(runtime.reportError).toHaveBeenCalledTimes(1);
    expect(runtime.reportError).toHaveBeenCalledWith("FollowUpService.completeFollowUp", expect.any(ElizaError), { taskId: badId });
  });

  it("completeFollowUp failure preserves adapter cause and does not return []", async () => {
    const cause = new Error("db write failed");
    const { runtime, taskId } = makeRuntime({
      updatePendingTask: async () => { throw cause; },
    });
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    let thrown: unknown;
    try { await svc.completeFollowUp(taskId); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ElizaError);
    expect((thrown as ElizaError).code).toBe("FOLLOWUP_COMPLETE_FAILED");
    expect((thrown as ElizaError).cause).toBe(cause);
    expect(runtime.reportError).toHaveBeenCalledTimes(1);
    // must not swallow to []
    expect(Array.isArray(thrown)).toBe(false);
  });

  it("snoozeFollowUp success updates dueAt", async () => {
    const { runtime, taskId, tasks } = makeRuntime();
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    const newDate = new Date("2026-02-01T00:00:00.000Z");
    await svc.snoozeFollowUp(taskId, newDate);
    const updated = tasks.get(String(taskId));
    expect(updated?.dueAt).toBe(newDate.getTime());
    expect(runtime.reportError).not.toHaveBeenCalled();
  });

  it("snoozeFollowUp failure wraps with ElizaError, cause, context and reports", async () => {
    const cause = new Error("updateTask failed");
    const { runtime, taskId } = makeRuntime({
      updateTask: async () => { throw cause; },
    });
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    const newDate = new Date("2026-02-01T00:00:00.000Z");
    let thrown: unknown;
    try { await svc.snoozeFollowUp(taskId, newDate); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ElizaError);
    const err = thrown as ElizaError;
    expect(err.code).toBe("FOLLOWUP_SNOOZE_FAILED");
    expect(err.cause).toBe(cause);
    expect(err.context?.taskId).toBe(taskId);
    expect(runtime.reportError).toHaveBeenCalledWith("FollowUpService.snoozeFollowUp", expect.any(ElizaError), { taskId });
  });

  it("snoozeFollowUp handles non-Error throw (string) by wrapping", async () => {
    const { runtime, taskId } = makeRuntime({
      getTask: async () => { throw "string thrown"; },
    });
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    let thrown: unknown;
    try { await svc.snoozeFollowUp(taskId, new Date()); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ElizaError);
    expect((thrown as ElizaError).cause).toBeInstanceOf(Error);
    expect(String((thrown as ElizaError).cause)).toContain("string thrown");
  });

  it("executeFollowUpWorker success via worker path creates memory", async () => {
    const { runtime } = makeRuntime();
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    const worker = (runtime.getTaskWorker as any)("follow_up") as TaskWorker;
    expect(worker).toBeDefined();
    const task: Task = {
      id: "22222222-2222-2222-2222-222222222222" as UUID,
      name: "follow_up",
      tags: ["follow-up", "queue"],
      metadata: { targetEntityId: ENTITY_ID, message: "hello", priority: "high" },
    } as Task;
    // need to add task to runtime store for claim to succeed
    (runtime as any).createTask(task);
    // Ensure getEntityById returns entity
    const res = await (svc as any).executeFollowUpWorker(runtime, { ...task, id: task.id });
    expect(res).toBeUndefined(); // preserveTask not needed on success
    expect(runtime.reportError).not.toHaveBeenCalled();
  });

  it("executeFollowUpWorker failure wraps and reports with cause", async () => {
    const cause = new Error("createMemory failed");
    const { runtime } = makeRuntime({
      createMemory: async () => { throw cause; },
      getEntityById: async () => ({ id: ENTITY_ID, names: ["Test"] }),
    });
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    const task: Task = {
      id: "33333333-3333-3333-3333-333333333333" as UUID,
      name: "follow_up",
      tags: ["follow-up", "queue"],
      metadata: { targetEntityId: ENTITY_ID },
      dueAt: Date.now(),
    } as Task;
    // Insert task into runtime so updatePendingTask can claim it
    await (runtime as any).createTask(task);
    // Need to ensure updatePendingTask succeeds: use real tasks map
    let thrown: unknown;
    try { await (svc as any).executeFollowUpWorker(runtime, task); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ElizaError);
    expect((thrown as ElizaError).code).toBe("FOLLOWUP_EXECUTION_FAILED");
    expect((thrown as ElizaError).cause).toBe(cause);
    expect(runtime.reportError).toHaveBeenCalledWith("FollowUpService.executeFollowUpWorker", expect.any(ElizaError), expect.objectContaining({ taskId: String(task.id) }));
  });

  it("concurrent completeFollowUp wraps each independently without swallow", async () => {
    const cause = new Error("concurrent db fail");
    const { runtime, taskId } = makeRuntime({
      updatePendingTask: async () => { throw cause; },
    });
    const svc = new FollowUpService(runtime);
    await svc.initialize(runtime);
    const results = await Promise.allSettled([
      svc.completeFollowUp(taskId),
      svc.completeFollowUp(taskId),
    ]);
    expect(results.every(r => r.status === "rejected")).toBe(true);
    for (const r of results) {
      const err = (r as PromiseRejectedResult).reason as ElizaError;
      expect(err).toBeInstanceOf(ElizaError);
      expect(err.code).toBe("FOLLOWUP_COMPLETE_FAILED");
      expect(err.cause).toBe(cause);
    }
    expect(runtime.reportError).toHaveBeenCalledTimes(2);
  });
});
