// @vitest-environment jsdom
// ═════════════════════════════════════════════════════════════════
// Unit test product-layer helpers (§42 master prompt):
// value-state separation §5, formatter finansial, pemetaan event →
// bahasa produk §16, kategori timeline, dan intelligent empty §25.
// ═════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  fmtRp, fmtPctRatio, fmtRoi,
  tierToValueState, ValueStateBadge, valueStateDesc,
  eventProductLabel, eventCategory,
  IntelligentEmpty,
} from "@/components/aurex-primitives";

describe("formatter finansial", () => {
  it("fmtRp: nilai hilang → em-dash, BUKAN nol palsu (Rule 4)", () => {
    expect(fmtRp(null)).toBe("—");
    expect(fmtRp(undefined)).toBe("—");
    expect(fmtRp("")).toBe("—");
    expect(fmtRp("bukan-angka")).toBe("—");
  });
  it("fmtRp: grouping id-ID tanpa desimal", () => {
    expect(fmtRp(12450000)).toBe("Rp12.450.000");
    expect(fmtRp("1000.50")).toBe("Rp1.001"); // display rounding, presisi tetap di DB
  });
  it("fmtPctRatio: fraksi 0..1 → persen", () => {
    expect(fmtPctRatio(0.42)).toBe("42%");
    expect(fmtPctRatio("0.604", 1)).toBe("60.4%");
    expect(fmtPctRatio(null)).toBe("—");
  });
  it("fmtRoi: rasio engine → notasi ×", () => {
    expect(fmtRoi(2.44)).toBe("2.4×");
    expect(fmtRoi(0)).toBe("0.0×");
    expect(fmtRoi(null)).toBe("—");
  });
});

describe("value states §5 — projected vs observed vs attributed vs verified", () => {
  it("tier engine dipetakan eksklusif, tidak pernah digabung", () => {
    expect(tierToValueState("RECONCILED")).toBe("VERIFIED");
    expect(tierToValueState("EVIDENCED")).toBe("ATTRIBUTED");
    expect(tierToValueState("SELF_REPORTED")).toBe("OBSERVED");
    // Tanpa hasil terukur = belum ada nilai OBSERVED pun → null (bukan PROJECTED)
    expect(tierToValueState(null)).toBeNull();
    expect(tierToValueState("SIMULATED")).toBeNull();
    expect(tierToValueState("tier-ngawur")).toBeNull();
  });
  it("deskripsi tiap state menjelaskan status kebenaran", () => {
    expect(valueStateDesc("PROJECTED")).toMatch(/bukan uang nyata/i);
    expect(valueStateDesc("VERIFIED")).toMatch(/ledger double-entry/i);
    expect(valueStateDesc("OBSERVED")).toMatch(/belum diverifikasi/i);
    expect(valueStateDesc("ATTRIBUTED")).toMatch(/atribusi/i);
  });
  it("badge: tanpa state → 'Belum terukur', bukan angka karangan", () => {
    render(<ValueStateBadge state={null} />);
    expect(screen.getByText("Belum terukur")).toBeInTheDocument();
  });
  it("badge VERIFIED dirender dengan label eksplisit", () => {
    render(<ValueStateBadge state="VERIFIED" tooltip={false} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });
});

describe("event → bahasa produk & kategori (§16)", () => {
  it("label produk untuk event siklus utama", () => {
    expect(eventProductLabel("HUMAN_APPROVAL_REQUIRED")).toMatch(/persetujuan Anda/i);
    expect(eventProductLabel("OPPORTUNITIES_RANKED")).toMatch(/peringkat/i);
    expect(eventProductLabel("PAYMENT_RECONCILED")).toMatch(/ledger/i);
  });
  it("event tak dikenal tetap human-readable, bukan raw snake_case", () => {
    expect(eventProductLabel("WEIRD_NEW_EVENT")).toBe("weird new event");
  });
  it("kategori filter sesuai taxonomy §16", () => {
    expect(eventCategory("OPPORTUNITIES_RANKED")).toBe("intelligence");
    expect(eventCategory("DECISION_SCALE")).toBe("decision");
    expect(eventCategory("EXPERIMENT_DESIGNED")).toBe("experiment");
    expect(eventCategory("MISSION_DISPATCHED")).toBe("execution");
    expect(eventCategory("HUMAN_APPROVAL_REQUIRED")).toBe("approval");
    expect(eventCategory("SNAPSHOT_TAKEN")).toBe("economic");
    expect(eventCategory("SOMETHING_ELSE")).toBe("system");
  });
});

describe("IntelligentEmpty §25 — lifecycle, bukan 'kosong'", () => {
  it("menampilkan tahap, aktivitas berjalan, dan artefak berikutnya", () => {
    render(
      <IntelligentEmpty
        stageTitle='Research in progress'
        doing='AUREX meneliti sinyal pasar.'
        done={["business model parsed"]}
        waiting='opportunity discovery'
        next='Portofolio peluang muncul di sini.'
        needsUser={false}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Research in progress")).toBeInTheDocument();
    expect(screen.getByText("business model parsed")).toBeInTheDocument();
    expect(screen.getByText("opportunity discovery")).toBeInTheDocument();
    expect(screen.queryByText("Perlu tindakan Anda")).not.toBeInTheDocument();
  });
  it("menandai kebutuhan aksi user saat needsUser", () => {
    render(<IntelligentEmpty stageTitle='Menunggu persetujuan' needsUser />);
    expect(screen.getByText("Perlu tindakan Anda")).toBeInTheDocument();
  });
});
