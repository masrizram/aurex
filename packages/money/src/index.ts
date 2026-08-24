/**
 * @aee/money — D5: uang = NUMERIC(20,2) di DB + Decimal.js di app.
 * Float DILARANG untuk nilai finansial (lint rule di fase berikutnya).
 */
import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** NUMERIC(20,2): 18 digit integer + 2 desimal. */
export const MONEY_MAX_ABS = new Decimal("999999999999999999.99");
export const SCALE = 2;

export class MoneyError extends Error {
  readonly detail: { value: string; rule: string };
  constructor(rule: string, value: unknown) {
    super(`money invariant violated: ${rule} (value=${String(value)})`);
    this.detail = { value: String(value), rule };
  }
}

/** Nilai uang immutable, selalu 2 desimal, non-zero dibulatkan HALF_UP. */
export class Money {
  private readonly raw: Decimal;

  private constructor(d: Decimal) {
    const q = d.toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP);
    if (q.abs().gt(MONEY_MAX_ABS)) throw new MoneyError("NUMERIC(20,2) overflow", q);
    if (!q.isFinite()) throw new MoneyError("non-finite", q);
    this.raw = q;
  }

  static from(value: number | string | Decimal | Money): Money {
    return new Money(value instanceof Money ? value.raw : new Decimal(value));
  }
  /** Dari input LLM/user: tolak non-finite & NaN secara eksplisit. */
  static parse(value: unknown): Money {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new MoneyError("float non-finite", value);
    if (typeof value !== "number" && typeof value !== "string")
      throw new MoneyError("unsupported type", typeof value);
    return Money.from(new Decimal(value));
  }

  add(o: Money): Money { return new Money(this.raw.add(o.raw)); }
  sub(o: Money): Money { return new Money(this.raw.sub(o.raw)); }
  /** Skala oleh rasio NUMERIC(8,4) → hasil tetap Money (2dp). */
  mulRatio(r: Ratio): Money { return new Money(this.raw.mul(r.toDecimal())); }
  cmp(o: Money): -1 | 0 | 1 { return this.raw.comparedTo(o.raw) as -1 | 0 | 1; }
  isZero(): boolean { return this.raw.isZero(); }
  isPositive(): boolean { return this.raw.gt(0); }
  isNegative(): boolean { return this.raw.lt(0); }
  gt(o: Money): boolean { return this.raw.gt(o.raw); }
  gte(o: Money): boolean { return this.raw.gte(o.raw); }
  lt(o: Money): boolean { return this.raw.lt(o.raw); }
  lte(o: Money): boolean { return this.raw.lte(o.raw); }
  neg(): Money { return new Money(this.raw.neg()); }

  /** Representasi string kanonik untuk NUMERIC(20,2) — dipakai sebagai parameter pg. */
  toDB(): string { return this.raw.toFixed(SCALE); }
  /** Decimal mentah (utk kalkulasi rasio di economics). */
  toDecimal(): Decimal { return this.raw; }
  toJSON(): string { return this.toDB(); }
  toString(): string { return this.toDB(); }
}

/** Rasio/skor presisi variabel (NUMERIC(4,2)..(10,4)). */
export class Ratio {
  private readonly raw: Decimal;
  private constructor(d: Decimal, private readonly dp: number, private readonly label: string) {
    const q = d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
    if (!q.isFinite()) throw new MoneyError(`ratio ${label} non-finite`, d);
    this.raw = q;
  }
  static dp2(v: number | string | Decimal, label = "ratio2"): Ratio { return new Ratio(new Decimal(v), 2, label); }
  static dp4(v: number | string | Decimal, label = "ratio4"): Ratio { return new Ratio(new Decimal(v), 4, label); }
  toDecimal(): Decimal { return this.raw; }
  toDB(): string { return this.raw.toFixed(this.dp); }
}

/** Penjumlahan deterministic — untuk rekonsiliasi ledger. */
export function sumMoney(items: readonly Money[]): Money {
  return items.reduce<Money>((acc, m) => acc.add(m), Money.from(0));
}

/**
 * Bukti aritmetika deterministik (anti-halusinasi):
 * float: 0.1+0.2 = 0.30000000000000004; decimal: = 0.30 persis.
 */
export function determinismProof(): { floatResult: number; decimalResult: string } {
  return {
    floatResult: 0.1 + 0.2,
    decimalResult: Money.from(0.1).add(Money.from(0.2)).toDB(),
  };
}
