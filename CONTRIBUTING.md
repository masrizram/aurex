# Berkontribusi pada AUREX

Terima kasih telah berkontribusi pada **AUREX**.

Dokumen ini menetapkan workflow engineering, quality gates, batas arsitektur, dan aturan perubahan repository agar setiap kontribusi tetap aman terhadap perilaku produksi yang telah diverifikasi.

> **Prinsip utama:** `main` harus selalu berada dalam kondisi deployable.

---

## 1. Setup Lokal

### Prasyarat

Pastikan environment pengembangan memiliki:

* Node.js sesuai versi yang digunakan repository
* npm
* PostgreSQL 16
* Git
* Docker atau PostgreSQL lokal untuk database development

### Instalasi

```bash
# Root workspaces (packages/*)
npm install

# Dashboard SPA
npm install --prefix apps/dashboard

# Landing page
npm install --prefix apps/landing

# Environment lokal
cp .env.example .env
```

Isi konfigurasi yang diperlukan di `.env`, termasuk:

```env
DATABASE_URL=
DATABASE_APP_URL=
AEE_DEV_DB_PASSWORD=
```

Jangan commit `.env`, credential, token, password, API key, atau secret lain ke repository.

### Database

Jalankan PostgreSQL 16 secara lokal atau melalui Docker, kemudian:

```bash
npm run migrate
```

Migrasi harus selesai tanpa error sebelum aplikasi dijalankan.

### Menjalankan development server

```bash
npx tsx scripts/serve.ts
```

Default development server:

```text
http://localhost:3000
```

Untuk konfigurasi environment lebih lengkap, lihat:

* [README.md](README.md#konfigurasi-environment)

---

## 2. Strategi Branch

Branch `main` adalah baseline produksi dan harus selalu deployable.

Jangan melakukan perubahan langsung ke `main` apabila perubahan belum melewati quality gates yang diwajibkan.

Gunakan pola branch:

```text
feat/<topik>
fix/<topik>
refactor/<topik>
chore/<topik>
docs/<topik>
test/<topik>
```

Contoh:

```text
feat/objective-approval
fix/capital-gate
refactor/economics-scoring
chore/remove-dead-script
docs/update-architecture
test/objective-transition
```

Branch harus dibuat dari `main` terbaru.

```bash
git checkout main
git pull
git checkout -b feat/<topik>
```

### Aturan PR

Satu Pull Request harus memiliki **satu concern utama**.

Hindari mencampurkan:

* perubahan perilaku;
* refactor struktural;
* perubahan database;
* cleanup besar;
* perubahan dokumentasi yang tidak terkait.

Pengecualian diperbolehkan apabila perubahan tersebut merupakan bagian langsung dari satu perubahan atomik yang sama.

---

## 3. Konvensi Commit

AUREX menggunakan **Conventional Commits**.

Format:

```text
<type>(<scope>): <description>
```

Contoh:

```text
fix(api): validasi capital gate pada POST /objectives
feat(orchestrator): tambah approval transition
refactor(economics): ekstrak scoring snapshot
test(worker): tambah regression test mission execution
docs(architecture): sinkronkan objective lifecycle
chore(cleanup): hapus script one-off
```

### Type

Gunakan type berikut bila sesuai:

```text
feat
fix
refactor
test
docs
chore
perf
build
ci
```

### Scope

Scope harus menunjuk area utama yang berubah.

Scope umum:

```text
api
economics
orchestrator
dashboard
landing
worker
db
contracts
money
auth
docs
cleanup
```

Commit harus cukup kecil untuk direview dan memiliki tujuan yang jelas.

---

## 4. Quality Gates Sebelum PR

Semua perubahan harus melewati gate berikut sebelum Pull Request dibuka:

```bash
npm run typecheck
npm run typecheck:ui
npm test
npm run test:ui
npm run build
```

Gate tersebut memverifikasi:

| Gate                   | Tujuan                                      |
| ---------------------- | ------------------------------------------- |
| `npm run typecheck`    | TypeScript strict untuk backend dan scripts |
| `npm run typecheck:ui` | TypeScript dashboard dan landing            |
| `npm test`             | Test backend/package melalui Vitest         |
| `npm run test:ui`      | Test dashboard melalui Vitest/jsdom         |
| `npm run build`        | Production build landing dan dashboard      |

Semua command wajib selesai dengan exit code `0`.

Jangan menganggap perubahan aman hanya karena aplikasi dapat dijalankan secara manual.

---

## 5. Canonical E2E

Perubahan yang memengaruhi alur produk, authentication, authorization, objective lifecycle, orchestrator, FSM, atau UI pelanggan wajib menjalankan canonical E2E.

```bash
BASE=<url> npx tsx scripts/e2e-canonical-cookie.ts
```

Contoh lokal:

```bash
BASE=http://localhost:3000 npx tsx scripts/e2e-canonical-cookie.ts
```

PR harus menyertakan hasil E2E yang relevan.

Jika canonical flow gagal, perubahan belum dianggap siap merge meskipun unit test dan build berhasil.

---

## 6. Aturan Arsitektur

Aturan berikut merupakan **architectural invariants** dan diperiksa saat review.

### 6.1 API harus tetap tipis

Route API bertanggung jawab atas:

```text
request
  ↓
validation
  ↓
authentication / authorization
  ↓
delegation
  ↓
response
```

Business logic tidak boleh dipindahkan ke route hanya untuk mempercepat implementasi.

Business logic harus berada di package/domain layer yang sesuai di `packages/*`.

---

### 6.2 Orchestrator adalah pemilik transisi FSM

Satu transisi FSM harus dilakukan sebagai satu operasi terkontrol melalui orchestrator.

```text
Current State
     ↓
Validate Transition
     ↓
Validate Preconditions
     ↓
Execute Transaction
     ↓
Persist State
     ↓
Emit Result
```

Route, worker, script, atau package lain tidak boleh menulis state engine secara langsung dengan melewati orchestrator.

Tidak diperbolehkan membuat shortcut state transition hanya untuk membuat test atau E2E lolos.

---

### 6.3 Semua operasi uang melalui `@aee/money`

Perhitungan dan mutasi nilai moneter harus menggunakan:

```text
@aee/money
```

Jangan membuat implementasi monetary arithmetic paralel di package lain.

Ledger bersifat **append-only**.

History transaksi tidak boleh:

* ditimpa;
* dimutasi;
* dihapus untuk mengubah hasil;
* direkonstruksi secara diam-diam.

Koreksi harus direpresentasikan sebagai entry baru yang dapat diaudit.

---

### 6.4 Kontrak harus terpusat

Kontrak lintas boundary baru harus dideklarasikan di:

```text
packages/contracts
```

Gunakan schema Zod strict.

Jangan menduplikasi schema request/response yang sama di beberapa package apabila schema tersebut merupakan kontrak bersama.

---

### 6.5 Pisahkan terminologi internal dari UX pelanggan

Terminologi engine internal seperti:

```text
RESULT_READY
HUMAN_APPROVAL_REQUIRED
MISSION_CREATED
DECISION_READY
token count
provider
model identifier
raw FSM state
```

tidak boleh bocor ke UX pelanggan di:

```text
/app/*
```

Informasi diagnostik/internal hanya boleh muncul pada surface yang memang ditujukan untuk operasi internal, misalnya:

```text
/admin/*
```

Customer-facing UI harus menggunakan bahasa produk yang dapat dipahami pengguna.

---

### 6.6 Migrasi database immutable

Migrasi yang telah masuk repository dianggap immutable.

Untuk perubahan schema:

```text
BENAR:
001_core_schema.sql
002_orchestrator_grants.sql
003_business_venture.sql

SALAH:
edit 001_core_schema.sql setelah migration berikutnya ada
```

Tambahkan migration baru dengan nomor berikutnya.

Jangan mengubah migration lama untuk memperbaiki production schema yang sudah pernah diterapkan.

---

### 6.7 Tidak ada secret di source

Dilarang menyimpan secara literal:

* password;
* API key;
* OAuth secret;
* access token;
* refresh token;
* database credential;
* private key;
* production credential lainnya.

Gunakan environment variable atau secret manager.

Environment variable baru yang diperlukan developer harus didokumentasikan di:

```text
.env.example
```

`.env.example` hanya berisi nama variabel dan nilai contoh yang aman, bukan secret nyata.

---

### 6.8 Dead code harus dihapus berdasarkan bukti

Jangan mempertahankan kode mati hanya karena mungkin dibutuhkan suatu hari nanti.

Sebelum menghapus kode, verifikasi bahwa tidak ada importer atau caller yang masih valid.

Gunakan repository history sebagai arsip:

```text
git log
git blame
git show
```

Bukan source tree aktif.

---

## 7. Aturan Perubahan FSM

Perubahan FSM memiliki blast radius tinggi.

Jika menambah atau mengubah state/transisi, contributor harus memeriksa minimal:

```text
contracts
    ↓
orchestrator
    ↓
persistence
    ↓
worker
    ↓
API
    ↓
dashboard/admin
    ↓
tests
    ↓
documentation
```

Perubahan FSM harus memiliki test yang membuktikan:

1. transisi valid diterima;
2. transisi ilegal ditolak;
3. precondition ditegakkan;
4. authorization tetap berlaku;
5. state tidak berubah jika transaksi gagal;
6. retry tidak menghasilkan state corruption atau duplicate side effect.

---

## 8. Database dan Transaction Safety

Operasi yang mengubah beberapa record sebagai satu business action harus bersifat atomik.

Jangan membuat flow seperti:

```text
update A
→ success
update B
→ failure
```

apabila kegagalan tersebut dapat meninggalkan state parsial.

Gunakan transaksi database ketika consistency invariant membutuhkannya.

Untuk operasi retryable, evaluasi idempotency.

Contributor harus mempertimbangkan:

```text
request retry
worker retry
network timeout
process crash
duplicate delivery
partial transaction
concurrent execution
```

---

## 9. Security

Semua input eksternal dianggap tidak terpercaya.

Validasi dilakukan pada trust boundary menggunakan schema yang sesuai.

Perubahan authorization harus diuji minimal terhadap:

```text
unauthenticated user
authenticated user
wrong owner
wrong organization
insufficient role
valid authorized actor
```

Jangan mengandalkan UI untuk security enforcement.

Authorization harus ditegakkan di server.

---

## 10. Gaya Kode

### TypeScript

Gunakan TypeScript strict.

Hindari:

```ts
any
as any
// @ts-ignore
// @ts-nocheck
```

Unsafe cast hanya diperbolehkan jika tidak dapat dihindari dan alasan teknisnya terdokumentasi.

Prefer:

```text
explicit type
schema validation
type narrowing
discriminated union
exhaustive handling
```

daripada bypass terhadap type system.

### Naming

Gunakan:

```text
file                → kebab-case
React component     → PascalCase
function/variable   → camelCase
constant            → UPPER_SNAKE_CASE
type/interface      → PascalCase
```

### Komentar

Komentar harus menjelaskan **WHY**, invariant, constraint, atau alasan keputusan.

Hindari komentar yang hanya mengulang kode.

---

## 11. Testing

Test ditempatkan sesuai struktur package yang berlaku, misalnya:

```text
<package>/test/*.test.ts
```

Nama test harus menjelaskan perilaku.

Prefer:

```ts
it("rejects objective transition when capital approval is missing", ...)
```

daripada:

```ts
it("works", ...)
```

### Regression Test

Setiap bug fix harus sebisa mungkin memiliki regression test yang:

1. gagal sebelum fix;
2. berhasil setelah fix;
3. membuktikan akar masalah yang diperbaiki.

Jangan menulis test yang hanya menyesuaikan expected value dengan implementasi yang salah.

---

## 12. Perubahan UI

Perubahan `/app/*` harus mempertahankan separation antara:

```text
customer product language
```

dan:

```text
internal engine implementation
```

Jangan mengekspos:

* raw FSM state;
* provider/model internal;
* prompt;
* token usage internal;
* stack trace;
* database identifier yang tidak diperlukan;
* diagnostic metadata.

Error pelanggan harus actionable tanpa membocorkan detail internal sistem.

---

## 13. Dokumentasi

Perubahan perilaku atau arsitektur harus diikuti perubahan dokumentasi yang relevan.

Periksa minimal:

```text
README.md
docs/*
.env.example
SECURITY.md
CONTRIBUTING.md
```

sesuai jenis perubahan.

Dokumentasi tidak boleh mendeskripsikan perilaku yang belum ada di source atau belum diverifikasi.

**Source + runtime behavior adalah sumber kebenaran. Dokumentasi harus mengikuti implementasi yang terbukti, bukan sebaliknya.**

---

## 14. Definition of Done

Perubahan dianggap selesai hanya jika seluruh kondisi yang relevan terpenuhi:

* [ ] Scope perubahan jelas.
* [ ] Tidak ada perubahan unrelated.
* [ ] Typecheck backend/scripts lulus.
* [ ] Typecheck UI lulus.
* [ ] Unit/integration test lulus.
* [ ] UI test lulus.
* [ ] Production build lulus.
* [ ] Canonical E2E lulus jika flow produk berubah.
* [ ] Authorization telah diverifikasi jika trust boundary berubah.
* [ ] Migration baru digunakan jika schema berubah.
* [ ] Regression test ditambahkan untuk bug fix yang relevan.
* [ ] Tidak ada secret atau credential baru di repository.
* [ ] Tidak ada bypass terhadap orchestrator/FSM invariant.
* [ ] Dokumentasi telah disinkronkan.
* [ ] Customer UX tidak membocorkan terminologi internal.
* [ ] Perubahan siap dijalankan dari clean checkout.

---

## 15. Pull Request

PR harus menjelaskan:

### Apa yang berubah

Ringkasan perubahan dan area yang terkena dampak.

### Mengapa

Masalah, kebutuhan, atau invariant yang menjadi alasan perubahan.

### Bagaimana diverifikasi

Cantumkan command dan hasil verifikasi.

Contoh:

```text
npm run typecheck     PASS
npm run typecheck:ui  PASS
npm test              PASS
npm run test:ui       PASS
npm run build         PASS
canonical E2E         PASS
```

Jika ada gate yang tidak dijalankan, jelaskan alasannya secara eksplisit.

### Risiko

Jelaskan kemungkinan regression atau blast radius, terutama untuk perubahan:

* authentication;
* authorization;
* FSM;
* orchestrator;
* worker;
* ledger/money;
* database;
* deployment/runtime.

---

## 16. Larangan

Jangan merge perubahan yang:

* membuat test gagal;
* membuat typecheck gagal;
* membuat production build gagal;
* melemahkan authorization;
* melewati orchestrator untuk mengubah FSM;
* mengubah ledger history;
* memasukkan secret ke repository;
* menyembunyikan error menggunakan unsafe cast;
* menghapus validation hanya agar request diterima;
* mengubah test hanya agar implementasi salah terlihat benar;
* mengedit migration lama yang sudah diterapkan;
* membuat dokumentasi mengklaim fitur yang belum terbukti;
* membuat `/app/*` mengekspos detail engine internal.

Jika sebuah workaround melanggar invariant arsitektur, workaround tersebut bukan fix.

---

## 17. Melaporkan Kerentanan

**Jangan membuka public issue untuk kerentanan keamanan.**

Ikuti prosedur responsible disclosure yang dijelaskan di:

[SECURITY.md](SECURITY.md)

Jangan memasukkan exploit detail, credential, token, atau data sensitif ke issue publik, discussion, commit message, atau Pull Request.

---

## Prinsip Akhir

Setiap kontribusi harus mempertahankan hubungan berikut:

```text
CORRECTNESS
    +
SECURITY
    +
ARCHITECTURAL INTEGRITY
    +
TEST EVIDENCE
    +
DOCUMENTATION ACCURACY
    ↓
DEPLOYABLE MAIN
```

Tujuan review bukan sekadar memastikan kode terlihat benar.

Tujuannya adalah memastikan perubahan **terbukti benar, tidak merusak invariant sistem, dapat diaudit, dapat diuji ulang, dan aman untuk dibawa ke produksi**.
