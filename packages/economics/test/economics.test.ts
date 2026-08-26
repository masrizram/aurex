import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATES, EconomicsError, accountBalance, achievedFromLedger,
  assertDoubleEntryBalance, capitalPlan, checkDeployment, checkExperimentBudget,
  computeSnapshot, validateLedgerEntry, type LedgerRow,
} from "@aee/economics";

const rows: LedgerRow[] = [
  { idempotency_key: "seed-1", debit_account: "CASH", credit_account: "CAPITAL_DEPLOYED", amount: "1000000.00", verification_tier: "VERIFIED" },
  { idempotency_key: "rev-1", debit_account: "CASH", credit_account: "REVENUE", amount: "250000.00", verification_tier: "RECONCILED" },
  { idempotency_key: "cogs-1", debit_account: "COGS", credit_account: "CASH", amount: "50000.00", verification_tier: "RECONCILED" },
];

describe("ledger double-entry (D7)", () => {
  it("self-transfer DITOLAK (GAP-06)", () => {
    expect(() =>
      validateLedgerEntry({ debit: "CASH", credit: "CASH", amount: "100.00", verificationTier: "RECONCILED", idempotencyKey: "x-1" }),
    ).toThrow(EconomicsError);
  });
  it("amount ≤ 0 DITOLAK (CHECK DB juga)", () => {
    expect(() =>
      validateLedgerEntry({ debit: "CASH", credit: "REVENUE", amount: "0.00", verificationTier: "RECONCILED", idempotencyKey: "x-2" }),
    ).toThrow(EconomicsError);
  });
  it("idempotency_key kosong DITOLAK (UNIQUE DB juga)", () => {
    expect(() =>
      validateLedgerEntry({ debit: "CASH", credit: "REVENUE", amount: "10.00", verificationTier: "RECONCILED", idempotencyKey: "" }),
    ).toThrow(EconomicsError);
  });
  it("saldo akun = Σdebit − Σcredit (konvensi: kredit-normal utk CAPITAL_DEPLOYED & REVENUE)", () => {
    expect(accountBalance(rows, "CAPITAL_DEPLOYED")).toBe("-1000000.00"); // dikredit seed-1 (injeksi modal)
    expect(accountBalance(rows, "CASH")).toBe("1200000.00");              // +1.000.000 +250.000 −50.000
    expect(accountBalance(rows, "REVENUE")).toBe("-250000.00");           // kredit-normal
    expect(accountBalance(rows, "COGS")).toBe("50000.00");                // debit-normal
  });
  it("invariant double-entry: konservasi saldo akun = 0 (P1 fix anti-tautologi)", () => {
    // Buku menutup bila semua saldo akun dijumlah = 0.00.
    const r = assertDoubleEntryBalance(rows);
    expect(r.balanced).toBe(true);
    expect(r.totalDebit).toBe("1300000.00");
    expect(r.totalCredit).toBe("1300000.00");
    // Satu postingan saja tetap seimbang (satu debit + satu credit, amount sama).
    const single = assertDoubleEntryBalance([rows[0]!]);
    expect(single.balanced).toBe(true);
  });
});

describe("snapshot ekonomi dari ledger (§15 — deterministik)", () => {
  it("semua metrik konsisten aritmetika", () => {
    const snap = computeSnapshot(
      {
        cashIn: "0.00", cashOut: "0.00",
        revenue: "250000.00", cogs: "50000.00", opex: "30000.00",
        experimentCost: "10000.00", llmCost: "20000.00", drawdown: "0.00",
        capitalDeployed: "1000000.00",
      },
      "10000000.00",
    );
    expect(snap.revenue).toBe("250000.00");
    expect(snap.grossProfit).toBe("200000.00");          // 250.000 − 50.000
    expect(snap.grossMargin).toBe("0.8000");              // 200/250
    expect(snap.operatingProfit).toBe("140000.00");       // 200 − 30 − 20 − 10
    expect(snap.burn).toBe("60000.00");                   // 30+20+10
    expect(snap.netProfit).toBe("190000.00");             // 250 − 60
    expect(snap.capitalRemaining).toBe("9000000.00");     // 10.000.000 − 1.000.000
    expect(snap.roi).toBe("0.0190");                      // 190.000/10.000.000
  });
  it("deployed > approved DITOLAK (TOTAL_DEPLOYED ≤ APPROVED)", () => {
    expect(() =>
      computeSnapshot(
        { cashIn: "0", cashOut: "0", revenue: "0", cogs: "0", opex: "0", experimentCost: "0", llmCost: "0", drawdown: "0", capitalDeployed: "10000001.00" },
        "10000000.00",
      ),
    ).toThrow(EconomicsError);
  });
  it("revenue 0 → grossMargin null (bukan NaN/div0)", () => {
    const snap = computeSnapshot(
      { cashIn: "0", cashOut: "0", revenue: "0.00", cogs: "0.00", opex: "0.00", experimentCost: "0.00", llmCost: "0.00", drawdown: "0.00", capitalDeployed: "0.00" },
      "10000000.00",
    );
    expect(snap.grossMargin).toBeNull();
    expect(snap.roi).toBe("0.0000");
  });
});

describe("konsistensi angka spec §1 (modal Rp10jt)", () => {
  it("10jt → reserve 2jt → deployable 8jt → eksperimen maks 1jt", () => {
    const p = capitalPlan("10000000.00");
    expect(p.total).toBe("10000000.00");
    expect(p.reserve20).toBe("2000000.00");
    expect(p.deployable).toBe("8000000.00");
    expect(p.experimentCap).toBe("1000000.00");
    // invariant spec: eksperimen = 10% modal = 12,5% deployable
    expect(p.experimentCap).toBe(DEFAULT_GATES.maxSingleExperimentLoss);
  });
});

describe("capital gates (§17)", () => {
  it("budget eksperimen > 1.000.000 → BUDGET_EXCEEDED", () => {
    const r = checkExperimentBudget("1500000.00", DEFAULT_GATES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BUDGET_EXCEEDED");
  });
  it("budget dalam batas → ok", () => {
    expect(checkExperimentBudget("1000000.00", DEFAULT_GATES).ok).toBe(true);
  });
  it("deployment kumulatif > 8.000.000 → GATE_VIOLATION", () => {
    const r = checkDeployment("7500000.00", "1000000.00", DEFAULT_GATES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GATE_VIOLATION");
    expect(checkDeployment("7000000.00", "1000000.00", DEFAULT_GATES).ok).toBe(true);
  });
});

describe("T37 ACHIEVED — dari ledger, bukan klaim LLM", () => {
  it("profit ≥ target", () => {
    expect(achievedFromLedger("100000000.00", "100000000.00")).toBe(true);
    expect(achievedFromLedger("99999999.99", "100000000.00")).toBe(false);
    expect(achievedFromLedger("100000000.01", "100000000.00")).toBe(true);
  });
});
