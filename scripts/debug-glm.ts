/**
 * Debug: panggil GLM REAL dengan mission package nyata dari DB,
 * validasi terhadap GlmResultSchema, cetak zod issues lengkap.
 */
import { Pool } from "pg";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GlmResultSchema } from "@aee/contracts";
import { fetchTransport, parseModelJson } from "@aee/agents";
import "dotenv/config";

// §24 secret safety: kredensial hanya dari env — tanpa fallback literal/IP.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[debug-glm] DATABASE_URL wajib diset (salin .env.example → .env).");
  process.exit(1);
}
const pool = new Pool({ connectionString: url });

const objId = process.argv[2] ?? "1c43ae94-184c-43d8-bef7-2ac76846ed4e";

const { rows } = await pool.query(
  `SELECT mv.package AS pkg, e.id AS exec_id, e.idempotency_key AS idem
   FROM missions m
   JOIN mission_versions mv ON mv.mission_id = m.id
   JOIN executions e ON e.mission_id = m.id
   WHERE m.objective_id = $1
   ORDER BY mv.version DESC LIMIT 1`, [objId]);
const { pkg, exec_id, idem } = rows[0];
await pool.end();

console.log(`exec_id=${exec_id}`);
console.log(`idem=${idem}`);
console.log(`pkg.mission_id=${pkg.mission_id} pkg.mission_version=${pkg.mission_version}`);

// Input PERSIS seperti GlmAdapter.executeMission (tanpa ctx — bug yang dicari)
const input = { mission: pkg, idempotency_key: idem };
const inputJson = JSON.stringify(input);
const schemaJson = JSON.stringify(zodToJsonSchema(GlmResultSchema, { target: "openApi3" }) as Record<string, unknown>);
const systemContent = `You are GLM, the execution agent. Respond with a single JSON object ONLY. No prose, no markdown fences. The output must validate against this JSON Schema:

${schemaJson}

Rules:
- Financial values (revenue, cost, profit, budget, price, etc.) are strings with 2 decimal places, e.g. "1500000.00".
- UUIDs are standard UUID v4 strings.
- All required fields must be present.
- Do NOT wrap the JSON in markdown code fences.`;

const transport = fetchTransport(
  process.env.GLM_BASE_URL ?? "http://localhost:20128/v1",
  process.env.GLM_API_KEY ?? "",
);
const t0 = Date.now();
const res = await transport({
  model: process.env.GLM_MODEL ?? "streamlake/glm-5.2",
  messages: [
    { role: "system", content: systemContent },
    { role: "user", content: `Context (JSON):\n${inputJson}\n\nProduce the JSON object that validates against the schema above.` },
  ],
  temperature: 1,
  max_tokens: 8192,
  response_format: { type: "json_object" },
});
console.log(`latency=${Date.now() - t0}ms usage=${JSON.stringify(res.usage)}`);

const text = res.choices[0]?.message.content ?? "";
const parsed = parseModelJson(text);
const check = GlmResultSchema.safeParse(parsed);
if (check.success) {
  console.log("SCHEMA VALID");
  console.log(`execution_id echoed: ${check.data.execution_id} (expect ${exec_id})`);
  console.log(`mission_id echoed: ${check.data.mission_id} (expect ${pkg.mission_id})`);
} else {
  console.log("SCHEMA INVALID — issues:");
  const flat = check.error.flatten();
  for (const [k, v] of Object.entries(flat.fieldErrors)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  console.log(`formErrors: ${JSON.stringify(flat.formErrors)}`);
  // Tampilkan potongan output mentah untuk konteks
  const raw = JSON.stringify(parsed);
  console.log(`raw output (${raw.length} chars): ${raw.slice(0, 1500)}`);
}
