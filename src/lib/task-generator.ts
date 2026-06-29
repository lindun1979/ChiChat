import type { ScenarioConfig } from "./scenarios";

export interface Task {
  slotValues: Record<string, string>;
  objective: string;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRandomTask(scenario: ScenarioConfig): Task {
  const slotValues: Record<string, string> = {};
  for (const slot of scenario.slots) {
    slotValues[slot.id] = pick(scenario.taskOptions[slot.id]);
  }
  const objective = scenario.objectiveTemplate(slotValues);
  return { slotValues, objective };
}
