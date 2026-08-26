# Kebijakan Keamanan AUREX

Keamanan AUREX mencakup perlindungan terhadap authentication, authorization,
isolasi tenant, integritas data dan finansial, workflow engine, external
integrations, secrets, serta infrastructure boundary.

Dokumen ini menjelaskan versi yang didukung, cakupan keamanan, cara melaporkan
kerentanan, klasifikasi severitas, dan prinsip penanganan insiden.

> **Jangan membuka issue, discussion, atau Pull Request publik untuk kerentanan
> yang belum diperbaiki.**

---

## 1. Versi yang Didukung

Saat ini hanya versi terbaru pada branch:

```text
main
```

yang menerima security update.

`main` merepresentasikan baseline yang ditujukan untuk deployment produksi
setelah melewati quality gates repository.

AUREX saat ini belum memiliki:

* Long-Term Support (LTS) release;
* maintenance branch untuk versi lama;
* security backport guarantee.

| Versi                 | Dukungan keamanan |
| --------------------- | ----------------- |
| Latest `main`         | ✅ Didukung        |
| Commit/release lama   | ❌ Tidak dijamin   |
| Fork pihak ketiga     | ❌ Tidak didukung  |
| Modifikasi downstream | ❌ Tidak didukung  |

Jika deployment menggunakan commit lama, lakukan upgrade ke baseline terbaru
sebelum mengasumsikan bahwa security fix terbaru telah diterapkan.

---

## 2. Melaporkan Kerentanan

### Jangan membuat laporan publik

Jangan melaporkan kerentanan melalui:

* GitHub Issue publik;
* GitHub Discussion publik;
* Pull Request publik;
* commit message;
* social media;
* kanal publik lainnya.

Gunakan fitur **Private vulnerability reporting** GitHub pada repository ini:

```text
Repository
→ Security
→ Report a vulnerability
```

Kanal utama responsible disclosure AUREX adalah fitur tersebut.

---

## 3. Informasi yang Harus Disertakan

Laporan yang baik sebaiknya mencakup:

1. **Ringkasan kerentanan**
2. **Komponen yang terdampak**
3. **Prasyarat eksploitasi**
4. **Langkah reproduksi**
5. **Expected behavior**
6. **Actual behavior**
7. **Dampak keamanan**
8. **Versi/commit yang diuji**
9. **Environment yang digunakan**
10. **Proof of Concept minimal**, jika diperlukan

Jika memungkinkan, jelaskan kategori dampaknya:

```text
confidentiality
integrity
availability
authorization
tenant isolation
financial integrity
```

Jangan mengirim credential produksi, data pengguna nyata, private key, access
token, refresh token, atau secret lain yang tidak diperlukan untuk membuktikan
masalah.

---

## 4. Target Respons

Target awal penanganan laporan:

| Tahap                | Target                                 |
| -------------------- | -------------------------------------- |
| Konfirmasi penerimaan | ≤ 3×24 jam                            |
| Triage awal          | ≤ 7 hari                               |
| Penentuan severitas  | Setelah reproduksi                     |
| Remediasi            | Berdasarkan severitas dan kompleksitas |
| Disclosure           | Setelah mitigasi tersedia              |

Target tersebut merupakan target operasional dan bukan jaminan kontraktual.

Kerentanan kritis yang terbukti dapat dieksploitasi terhadap produksi akan
diprioritaskan dibanding laporan dengan dampak teoritis.

---

## 5. Cakupan Keamanan

Kerentanan berikut termasuk dalam cakupan apabila memiliki dampak keamanan yang
dapat dibuktikan.

### Authentication

Contoh:

```text
authentication bypass
session hijacking
session fixation
credential exposure
OAuth flow weakness
token validation bypass
```

### Authorization

Contoh:

```text
IDOR
privilege escalation
owner bypass
admin boundary bypass
organization boundary bypass
unauthorized state transition
```

Authorization harus ditegakkan di server.

Keberadaan pembatasan pada UI saja tidak dianggap sebagai security control yang
memadai.

### Tenant Isolation

AUREX harus mempertahankan isolasi data antar-user dan antar-organisasi sesuai
authorization model.

Termasuk:

```text
cross-tenant read
cross-tenant write
cross-tenant delete
cross-tenant execution
cross-tenant financial access
cross-tenant objective access
```

Kerentanan yang memungkinkan satu tenant mengakses atau memodifikasi resource
tenant lain dianggap material.

---

## 6. Integritas Finansial

Komponen finansial memiliki security sensitivity tinggi.

Termasuk:

```text
ledger manipulation
balance corruption
duplicate financial operation
unauthorized capital allocation
amount tampering
rounding exploit
currency handling error dengan dampak finansial
double spending
replay terhadap operasi finansial
```

Semua operasi uang harus mempertahankan invariant modul monetari AUREX
(`packages/money`, `@aee/money`): nilai uang direpresentasikan sebagai desimal
presisi tetap (NUMERIC(20,2) di DB, Decimal.js di aplikasi, pembulatan HALF_UP),
bukan floating point.

Ledger dirancang append-only dan double-entry
(`migrations/001_core_schema.sql`; penegakan pada level database melalui trigger
dan REVOKE). Ledger tidak boleh dapat dimodifikasi atau dihapus secara
retroaktif melalui jalur aplikasi biasa.

Koreksi harus direpresentasikan sebagai transaksi baru yang dapat diaudit.

Snapshot ekonomi dibangun ulang dari ledger — bukan dari output model AI.

---

## 7. Workflow dan FSM Integrity

State machine dan orchestrator merupakan security boundary apabila state
menentukan kemampuan sistem melakukan tindakan berikutnya.

Termasuk:

```text
illegal state transition
approval bypass
capital gate bypass
authorization bypass melalui state manipulation
direct state mutation
duplicate transition
replay transition
concurrent transition corruption
```

Contoh kelas masalah:

```text
HUMAN_APPROVAL_REQUIRED
          ↓
      [bypass]
          ↓
      EXECUTING
```

jika sistem seharusnya membutuhkan approval sebelum execution.

Transisi state orchestrator AUREX didefinisikan sebagai tabel transisi eksplisit
dengan guard (misalnya `capital_gate_or_irreversible_or_autonomy_le_2`,
`no_active_execution`); transisi hanya sah bila trigger dan guard-nya terpenuhi.
Route, worker, script, atau komponen lain tidak boleh memperoleh kemampuan untuk
melewati invariant orchestrator secara tidak sah.

---

## 8. Webhook, Replay, dan Idempotency

Integrasi eksternal harus mempertimbangkan:

```text
duplicate delivery
replay attack
forged webhook
invalid signature
out-of-order event
concurrent processing
network retry
partial failure
```

Laporan mengenai idempotency termasuk security issue apabila dapat menyebabkan
dampak seperti:

* duplicate financial mutation;
* duplicate execution;
* privilege change;
* state corruption;
* resource exhaustion material;
* tindakan eksternal berulang.

Webhook yang memiliki mekanisme signature **wajib** memverifikasi signature pada
server sebelum payload dipercaya. Implementasi referensi AUREX memverifikasi
HMAC webhook pembayaran **sebelum** validasi skema payload (authentication
first), dan callback duplikat ditangani secara idempoten.

---

## 9. Injection

Termasuk:

```text
SQL injection
command injection
template injection
path traversal
stored XSS
reflected XSS
unsafe HTML injection
server-side injection
```

Semua input eksternal dianggap tidak terpercaya sampai tervalidasi pada trust
boundary.

Parameterized query dan validation schema (zod) harus digunakan sesuai boundary
masing-masing.

---

## 10. Secret Exposure

Termasuk kebocoran:

```text
database credentials
API keys
OAuth client secrets
access tokens
refresh tokens
private keys
provider credentials
deployment secrets
production credentials
```

Secret tidak boleh disimpan secara literal dalam source code.

---

## 11. Kebijakan Secret

Credential runtime harus diberikan melalui environment variable atau secret
management infrastructure.

Template environment resmi:

```text
.env.example
```

`.env.example` hanya boleh berisi:

```text
VARIABLE_NAME=
```

atau nilai contoh yang tidak memiliki privilege nyata.

Pemisahan privilege koneksi database wajib dipertahankan:

* koneksi OWNER (`DATABASE_URL`) hanya untuk migrasi/DDL;
* koneksi runtime aplikasi (`DATABASE_APP_URL`) memakai role ber-privilege
  minimal, bukan superuser dan bukan owner.

Jangan pernah memasukkan secret produksi ke:

```text
source code
.env.example
tests
fixtures
README
docs
issue
PR
commit message
screenshots
logs
```

---

## 12. Secret yang Terlanjur Bocor

Menghapus secret dari source **tidak membuat secret tersebut aman kembali**.

Jika secret nyata pernah masuk repository atau log yang dapat diakses pihak
tidak berwenang, anggap secret tersebut telah terekspos.

Prosedur minimum:

```text
DETECT
  ↓
REVOKE / ROTATE
  ↓
UPDATE RUNTIME SECRET
  ↓
VERIFY OLD SECRET INVALID
  ↓
ASSESS EXPOSURE
  ↓
CLEAN REPOSITORY IF NECESSARY
```

Rotasi dilakukan pada provider/infrastructure terkait — misalnya secret manager,
hosting environment (Fly secrets / env var), database, atau OAuth provider.

Jangan hanya mengubah source code.

Jika secret ditemukan dalam Git history, laporkan melalui kanal keamanan privat.

Jangan mempublikasikan nilai secret dalam laporan publik.

---

## 13. AI dan External Provider Boundary

Output dari model AI atau external provider dianggap **untrusted input**.

Model AI tidak boleh secara implisit memperoleh privilege hanya karena output
berasal dari provider yang dipercaya.

Output AI yang dapat memengaruhi:

```text
execution
capital allocation
database mutation
state transition
authorization-sensitive action
external side effect
```

harus melewati control yang sesuai dengan arsitektur sistem.

Dalam arsitektur AUREX, snapshot ekonomi selalu dibangun ulang dari ledger —
tidak pernah dari output LLM — dan eksekusi agent melewati guard orchestrator
yang sama seperti jalur lainnya.

Kerentanan termasuk dalam cakupan apabila attacker dapat menggunakan
AI/provider boundary untuk melewati security control yang seharusnya
deterministik.

Prompt injection tanpa security impact yang dapat dibuktikan tidak otomatis
dianggap sebagai kerentanan.

---

## 14. Infrastructure dan Deployment

Kerentanan deployment termasuk dalam cakupan apabila berasal dari konfigurasi
atau artifact yang dikontrol repository dan dapat menyebabkan:

```text
secret exposure
public administrative access
authentication bypass
privilege escalation
data exposure
unsafe production configuration
```

Konfigurasi produksi harus menggunakan secret management infrastructure yang
sesuai (misalnya Fly secrets).

Production credential tidak boleh dikompilasi ke client bundle.

---

## 15. Client-Side Security Boundary

Data yang dikirim ke browser harus dianggap dapat dibaca dan dimodifikasi oleh
pengguna.

Karena itu:

> **Client-side enforcement bukan authorization boundary.**

Dashboard atau landing page tidak boleh menjadi satu-satunya tempat enforcement
terhadap operasi sensitif.

Server harus memverifikasi authorization secara independen.

Jangan memasukkan secret ke:

```text
JavaScript bundle
HTML
public environment variable
source map publik
browser storage
client-side configuration
```

jika nilai tersebut memberikan privilege server-side.

---

## 16. Logging dan Error Handling

Log tidak boleh secara sengaja menyimpan:

```text
password
access token
refresh token
OAuth secret
private key
raw authorization header
database password
```

Error yang dikirim kepada pelanggan tidak boleh mengekspos detail internal yang
tidak diperlukan seperti:

```text
stack trace
database credential
SQL internal
provider secret
filesystem path sensitif
raw internal prompt
```

Informasi diagnostik internal harus dipisahkan dari customer-facing error.

---

## 17. Dependency Security

Dependency baru harus memiliki alasan penggunaan yang jelas.

Hindari dependency apabila fungsi yang sama dapat dilakukan dengan aman tanpa
menambah attack surface yang tidak proporsional.

Security fix pada dependency harus diprioritaskan berdasarkan:

```text
exploitability
reachability
runtime exposure
privilege
data sensitivity
```

Bukan hanya berdasarkan angka CVE atau output scanner.

---

## 18. Di Luar Cakupan

Secara umum, berikut tidak dianggap sebagai laporan security yang actionable
tanpa bukti dampak tambahan:

* serangan yang membutuhkan akses fisik ke mesin korban;
* laporan scanner otomatis tanpa validasi;
* dependency CVE yang tidak reachable dan tidak memiliki jalur eksploitasi
  relevan;
* brute-force rate-limit report tanpa bukti dampak material;
* missing security header tanpa exploit scenario yang relevan;
* informasi versi software tanpa jalur eksploitasi;
* self-XSS;
* social engineering murni;
* denial-of-service teoritis tanpa bukti realistis;
* prompt injection yang tidak dapat melewati security boundary;
* best-practice recommendation tanpa kerentanan konkret.

Laporan tersebut tetap dapat dipertimbangkan sebagai hardening recommendation,
tetapi tidak otomatis diklasifikasikan sebagai vulnerability.

---

## 19. Aktivitas yang Dilarang

Security research tidak boleh:

* mengakses data pengguna lain tanpa izin;
* mengubah atau menghancurkan data produksi;
* melakukan denial-of-service;
* melakukan spam;
* melakukan social engineering terhadap pengguna atau operator;
* mempertahankan persistence setelah PoC terbukti;
* mengekstrak data lebih banyak dari minimum yang diperlukan;
* mempublikasikan vulnerability sebelum mitigasi tersedia;
* menggunakan credential yang ditemukan untuk aktivitas di luar validasi
  minimum.

Jika sebuah vulnerability dapat dibuktikan tanpa menyentuh data produksi,
gunakan metode tersebut.

---

## 20. Severity

Severity ditentukan berdasarkan kombinasi:

```text
IMPACT × EXPLOITABILITY × EXPOSURE
```

### Critical

Contoh:

* authentication bypass sistemik;
* remote code execution;
* cross-tenant compromise skala luas;
* administrative takeover;
* manipulasi finansial tanpa authorization;
* kebocoran production secret dengan privilege tinggi.

### High

Contoh:

* privilege escalation;
* cross-tenant data access;
* approval bypass dengan side effect material;
* stored XSS pada privileged surface;
* financial replay dengan dampak nyata.

### Medium

Contoh:

* limited authorization weakness;
* information disclosure terbatas;
* security control bypass dengan prasyarat signifikan.

### Low

Contoh:

* dampak terbatas;
* exploitability rendah;
* hardening issue dengan security consequence kecil.

Severity akhir ditentukan setelah reproduksi dan analisis attack path.

---

## 21. Security Fix Requirements

Security fix tidak dianggap selesai hanya karena exploit tidak lagi berhasil
pada satu test manual.

Perbaikan harus mempertimbangkan:

```text
ROOT CAUSE
    ↓
PATCH
    ↓
REGRESSION TEST
    ↓
AUTHORIZATION / INVARIANT TEST
    ↓
TYPECHECK
    ↓
TEST SUITE
    ↓
BUILD
    ↓
E2E WHEN RELEVANT
    ↓
DEPLOYMENT VERIFICATION
```

Fix tidak boleh:

* menyembunyikan vulnerability hanya pada UI;
* mengandalkan client-side validation;
* mengganti error message tanpa memperbaiki root cause;
* menonaktifkan test yang mendeteksi masalah;
* memperlemah invariant untuk membuat flow berhasil.

---

## 22. Incident Response

Jika kerentanan terkonfirmasi pada produksi, prioritas penanganannya adalah:

```text
DETECT
  ↓
CONTAIN
  ↓
REVOKE / ISOLATE
  ↓
REMEDIATE
  ↓
VERIFY
  ↓
RECOVER
  ↓
REVIEW
```

Containment dapat memiliki prioritas lebih tinggi daripada perubahan kode
permanen apabila exploit sedang aktif.

Contoh:

```text
rotate credential
disable compromised integration
revoke token
restrict endpoint
disable vulnerable capability
```

kemudian dilanjutkan dengan root-cause remediation.

---

## 23. Disclosure

Kami meminta reporter memberi waktu yang wajar untuk:

1. mereproduksi masalah;
2. menentukan dampak;
3. membuat perbaikan;
4. menambahkan regression test;
5. melakukan deployment;
6. memverifikasi mitigasi.

Public disclosure sebaiknya dilakukan setelah pengguna yang terdampak memiliki
kesempatan yang wajar untuk menerima mitigasi.

Detail disclosure dapat dikoordinasikan melalui laporan privat.

---

## 24. Prinsip Keamanan AUREX

Security boundary utama AUREX dapat diringkas sebagai:

```text
UNTRUSTED INPUT
      ↓
VALIDATION
      ↓
AUTHENTICATION
      ↓
AUTHORIZATION
      ↓
DOMAIN INVARIANTS
      ↓
ORCHESTRATOR / TRANSACTION
      ↓
CONTROLLED SIDE EFFECT
      ↓
AUDITABLE STATE
```

Untuk operasi finansial:

```text
AUTHORIZED ACTION
      ↓
@aee/money (packages/money)
      ↓
TRANSACTION
      ↓
APPEND-ONLY LEDGER
      ↓
AUDITABLE RESULT
```

Untuk AI/external provider:

```text
MODEL / PROVIDER OUTPUT
      ↓
UNTRUSTED
      ↓
VALIDATION
      ↓
POLICY / BUSINESS GATES
      ↓
AUTHORIZED EXECUTION
```

Tidak ada komponen yang boleh memperoleh privilege hanya karena berada lebih
dekat dengan database, worker, provider, atau model.

**Security control harus ditegakkan pada trust boundary yang benar dan
dibuktikan melalui test serta runtime behavior.**
