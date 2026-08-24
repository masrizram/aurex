import { describe, expect, it } from "vitest";
import { Money, MoneyError, Ratio, determinismProof, sumMoney } from "@aee/money";

describe("Money (D5 — decimal, bukan float)", () => {
  it("bukti determinisme: 0.1+0.2 float ≠ decimal", () => {
    const p = determinismProof();
    expect(p.floatResult).not.toBe("0.30");            // 0.30000000000000004 — float rusak
    expect(p.decimalResult).toBe("0.30");              // decimal presis
    expect(Money.parse(0.1).add(Money.parse(0.2)).toDB()).toBe("0.30");
  });

  it("pembulatan HALF_UP ke 2 desimal", () => {
    expect(Money.parse("1.005").toDB()).toBe("1.01");
    expect(Money.parse("2.675").toDB()).toBe("2.68");
    expect(Money.parse("1.004").toDB()).toBe("1.00");
  });

  it("overflow NUMERIC(20,2) ditolak", () => {
    expect(() => Money.parse("999999999999999999.99")).not.toThrow(); // batas legal
    expect(() => Money.parse("1000000000000000000.00")).toThrow(MoneyError);
  });

  it("input rusak ditolak eksplisit", () => {
    expect(() => Money.parse(Number.NaN)).toThrow(MoneyError);
    expect(() => Money.parse(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => Money.parse(true as unknown as number)).toThrow(MoneyError);
  });

  it("string kanonik 2 desimal utk parameter pg", () => {
    expect(Money.parse("1000000").toDB()).toBe("1000000.00");
    expect(Money.parse(0).toDB()).toBe("0.00");
  });

  it("aritmetika & perbandingan", () => {
    const a = Money.parse("10.10");
    const b = Money.parse("0.20");
    expect(a.add(b).toDB()).toBe("10.30");
    expect(a.sub(b).toDB()).toBe("9.90");
    expect(a.gt(b)).toBe(true);
    expect(Money.parse("-5.00").isNegative()).toBe(true);
    expect(sumMoney([a, b, Money.parse("0.70")]).toDB()).toBe("11.00");
  });

  it("Ratio dp4 utk margin/roi", () => {
    expect(Ratio.dp4("0.8").toDB()).toBe("0.8000");
    expect(Ratio.dp4(0.12345).toDB()).toBe("0.1235"); // HALF_UP
  });
});
