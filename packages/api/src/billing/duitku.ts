/**
 * Duitku POP adapter (fase monetize) — spesifikasi dari library resmi
 * duitkupg/duitku-php (Duitku/Pop.php, Duitku/Config.php):
 *
 *   createInvoice : POST {base}/api/merchant/createInvoice
 *     header x-duitku-signature = sha256(merchantCode + timestampMs + apiKey)
 *     header x-duitku-timestamp = timestampMs (epoch ms)
 *     header x-duitku-merchantcode = merchantCode
 *   callback      : signature = md5(merchantCode + amount + merchantOrderId + apiKey)
 *   base          : sandbox https://api-sandbox.duitku.com | prod https://api-prod.duitku.com
 *
 * Adapter MURNI (tanpa I/O DB) dan fetch dapat disuntik untuk test.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export interface DuitkuConfig {
  readonly merchantCode: string;
  readonly apiKey: string;
  readonly sandbox: boolean;
}

export interface DuitkuInvoiceRequest {
  readonly amount: number;            // rupiah bulat
  readonly merchantOrderId: string;   // unik per invoice (idempotency key kita)
  readonly productDetails: string;
  readonly email: string;
  readonly customerName: string;
  readonly callbackUrl: string;
  readonly returnUrl: string;
  readonly expiryMinutes: number;
}

export interface DuitkuInvoiceResponse {
  readonly reference: string;
  readonly paymentUrl: string;
}

export interface DuitkuCallbackPayload {
  readonly merchantCode: string;
  readonly amount: string | number;
  readonly merchantOrderId: string;
  readonly signature: string;
  readonly resultCode: string;        // "00" sukses, "01" gagal, "02" expired/batal
  readonly reference: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

export function baseUrl(cfg: DuitkuConfig): string {
  return cfg.sandbox ? "https://api-sandbox.duitku.com" : "https://api-prod.duitku.com";
}

/** Signature callback sesuai spesifikasi POP (perbandingan constant-time). */
export function isCallbackSignatureValid(p: DuitkuCallbackPayload, cfg: DuitkuConfig): boolean {
  const expected = md5(`${p.merchantCode}${p.amount}${p.merchantOrderId}${cfg.apiKey}`);
  // P3→pre-freeze: pembandingan heksadesimal via timingSafeEqual (konstanta-waktu),
  // bukan `===` — mencegah timing side-channel pada payment callback boundary.
  // Cek panjang tetap diperlukan: timingSafeEqual throw bila buffer beda panjang.
  const a = Buffer.from(p.signature.toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type FetchLike = (url: string, init: unknown) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function makeDuitkuAdapter(
  cfg: DuitkuConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
) {
  return {
    async createInvoice(req: DuitkuInvoiceRequest): Promise<DuitkuInvoiceResponse> {
      const timestamp = Date.now().toString();
      const signature = sha256(`${cfg.merchantCode}${timestamp}${cfg.apiKey}`);
      const payload = {
        paymentAmount: req.amount,
        merchantOrderId: req.merchantOrderId,
        productDetails: req.productDetails,
        additionalParam: "",
        merchantUserInfo: req.customerName,
        customerVaName: req.customerName,
        email: req.email,
        phoneNumber: "",
        itemDetails: [{ name: req.productDetails, price: req.amount, quantity: 1 }],
        callbackUrl: req.callbackUrl,
        returnUrl: req.returnUrl,
        expiryPeriod: req.expiryMinutes,
      };
      const res = await fetchImpl(`${baseUrl(cfg)}/api/merchant/createInvoice`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-duitku-signature": signature,
          "x-duitku-timestamp": timestamp,
          "x-duitku-merchantcode": cfg.merchantCode,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`duitku createInvoice HTTP ${res.status}`);
      const body = (await res.json()) as { reference?: string; paymentUrl?: string; message?: string };
      if (!body.reference || !body.paymentUrl) {
        throw new Error(`duitku createInvoice respons tak lengkap: ${body.message ?? "?"}`);
      }
      return { reference: body.reference, paymentUrl: body.paymentUrl };
    },
  };
}

export type DuitkuAdapter = ReturnType<typeof makeDuitkuAdapter>;
