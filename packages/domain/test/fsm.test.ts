import { describe, expect, it } from "vitest";
import {
  FSM_STATES, FSM_STATE_COUNT, TERMINAL_STATES, TRANSITIONS,
  evaluateStopConditions, findTransitions, statesReachableFromTable,
  type GuardContext,
} from "@aee/domain";

const now = new Date("2026-08-22T00:00:00Z");

export function baseCtx(over: Partial<GuardContext> = {}): GuardContext {
  return {
    state: "IDLE",
    now,
    objective: {
      id: "11111111-1111-1111-1111-111111111111",
      createdAt: "2026-08-22T00:00:00.000Z",
      deadline: "2027-08-22",
      capitalApproved: "10000000.00",
      horizonMonths: 12,
      autonomyLevel: 3,
      riskTolerance: "moderate",
    },
    ...over,
  };
}

describe("FSM §5.2 — properti tabel transisi", () => {
  it("tepat 25 state (OBS-01: 24 + STOPPED; klaim lama 27 salah)", () => {
    expect(FSM_STATE_COUNT).toBe(25);
    expect(FSM_STATES).toContain("STOPPED");
  });

  it("39 transisi T01–T39 unik", () => {
    expect(TRANSITIONS.length).toBe(39);
    const ids = TRANSITIONS.map((t) => t.id);
    expect(new Set(ids).size).toBe(39);
  });

  it("setiap state terdefinisi tercapai dari tabel (union From/To = 25)", () => {
    const reach = statesReachableFromTable();
    expect(reach.size).toBe(25);
    for (const s of FSM_STATES) expect(reach.has(s)).toBe(true);
  });

  it("semua From/To anggota enumerasi (kecuali pseudo T38 '*' & T34 '{resume_state}')", () => {
    for (const t of TRANSITIONS) {
      if (t.from !== "*") expect(FSM_STATES).toContain(t.from);
      if (t.to !== "{resume_state}") expect(FSM_STATES).toContain(t.to);
    }
  });

  it("terminal tidak punya transisi keluar", () => {
    for (const s of TERMINAL_STATES) {
      const outs = TRANSITIONS.filter((t) => t.from === s);
      expect(outs).toHaveLength(0);
      expect(findTransitions(s, "stop_objective")).toHaveLength(0);
    }
  });

  it("T38 wildcard cocok dari state non-terminal mana pun", () => {
    for (const s of FSM_STATES) {
      if (TERMINAL_STATES.includes(s)) continue;
      expect(findTransitions(s, "stop_objective").map((t) => t.id)).toEqual(["T38"]);
    }
  });

  it("transisi tak dikenal → kosong (INVALID_TRANSITION di caller)", () => {
    expect(findTransitions("IDLE", "normalize")).toHaveLength(0);
    expect(findTransitions("EXECUTING", "kimi_select")).toHaveLength(0);
  });
});

describe("Stop conditions §41 (guard global)", () => {
  const g = (over: Record<string, unknown>): GuardContext =>
    baseCtx({
      state: "RESEARCHING",
      global: {
        stopRequested: false, drawdown: "0.00", maxTotalDrawdown: "4000000.00",
        evNegativeStreak: 0, consecutiveMissionFailures: 0, providerErrorRate1h: 0,
        approvalPending: false, securityAnomaly: false,
        currentProfit: "0.00", targetProfit: "100000000.00",
        ...over,
      } as GuardContext["global"],
    });

  it("kondisi bersih → tidak aktif", () => {
    expect(evaluateStopConditions(g({})).active).toBe(false);
  });
  it("drawdown ≥ 4.000.000 → aktif", () => {
    expect(evaluateStopConditions(g({ drawdown: "4000000.00" })).active).toBe(true);
  });
  it("EV<0 dua siklus → aktif", () => {
    expect(evaluateStopConditions(g({ evNegativeStreak: 2 })).active).toBe(true);
    expect(evaluateStopConditions(g({ evNegativeStreak: 1 })).active).toBe(false);
  });
  it("gagal misi 3× berturut → aktif", () => {
    expect(evaluateStopConditions(g({ consecutiveMissionFailures: 3 })).active).toBe(true);
  });
  it("provider error > 50% dalam 1 jam → aktif", () => {
    expect(evaluateStopConditions(g({ providerErrorRate1h: 0.51 })).active).toBe(true);
    expect(evaluateStopConditions(g({ providerErrorRate1h: 0.5 })).active).toBe(false);
  });
});
