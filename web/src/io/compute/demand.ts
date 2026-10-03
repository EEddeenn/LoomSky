export type Priority = "interactive" | "action" | "background";
export type PrioritySource = Priority | ComputeDemand | (() => Priority);
export const priorityOrder: Record<Priority, number> = { interactive: 0, action: 1, background: 2 };

export function priorityOf(source: PrioritySource): Priority {
  return typeof source === "string" ? source : typeof source === "function" ? source() : source.priority;
}

export class ComputeDemand {
  private readonly holds = new Map<symbol, PrioritySource>();

  constructor(private base: PrioritySource) {}

  get priority(): Priority {
    let priority = priorityOf(this.base);
    for (const held of this.holds.values()) {
      const current = priorityOf(held);
      if (priorityOrder[current] < priorityOrder[priority]) priority = current;
    }
    return priority;
  }

  setPriority(priority: PrioritySource): void { this.base = priority; }

  hold(priority: PrioritySource): () => void {
    const key = Symbol();
    this.holds.set(key, priority);
    return () => { this.holds.delete(key); };
  }
}

export function createDemand(priority: PrioritySource = "action"): ComputeDemand {
  return new ComputeDemand(priority);
}
