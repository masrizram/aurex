Bisa. Kalau targetnya sekarang **100% seluruh AUREX**, jangan lagi audit parsial per halaman. Gunakan satu **master remediation prompt** yang memaksa agent mengaudit **SaaS layer + product layer + engine layer + repo hygiene**, lalu memperbaiki semuanya sampai canonical E2E benar-benar utuh.

Blueprint awal AEE memang sudah kuat pada orchestrator, economic engine, agent contracts, verification tier, ledger, FSM, dan provider abstraction.  Jadi prompt di bawah fokus pada **menyatukan itu menjadi produk SaaS AUREX 100%** tanpa membuang engine yang sudah benar.

# AUREX — 100% FULL PRODUCT COMPLETION

## CANONICAL SAAS REMEDIATION + REPOSITORY CLEANUP + FINAL VALIDATION

You are responsible for performing a **complete, adversarial, repository-wide remediation cycle** for AUREX.

Do NOT treat the current implementation as correct merely because:

* tests pass
* build passes
* typecheck passes
* E2E passes
* previous audits said READY
* previous implementation already exists
* a feature appears visually complete
* backend functionality exists

Assume the implementation may still contain:

* incorrect product flow
* wrong information architecture
* backend concepts leaking into customer UX
* dead code
* duplicate implementations
* obsolete files
* stale assets
* unused folders
* abandoned routes
* redundant components
* broken abstractions
* partial SaaS lifecycle
* missing edge cases
* incorrect data relationships
* unreachable code
* unused migrations
* legacy compatibility code
* stale documentation
* unreferenced scripts
* hidden security gaps
* inconsistent UI/API/DB contracts
* production deployment drift

Your objective is to bring the repository to a **single coherent canonical AUREX SaaS architecture**.

---

# 0. ABSOLUTE MISSION

Transform the repository into:

```text
AUREX SaaS Product
    │
    ├── SaaS Customer Layer
    │
    ├── Economic Product Layer
    │
    └── AEE Autonomous Engine
```

All three layers must work end-to-end.

The final system must NOT merely be:

```text
AEE ENGINE
+
some dashboard
```

It must be a complete SaaS product.

---

# 1. CANONICAL THREE-LAYER ARCHITECTURE

## LAYER A — SAAS CUSTOMER LAYER

Responsible for:

```text
Public website
Authentication
Email verification
Password recovery
Organizations
Tenancy
User accounts
Onboarding
Plans
Subscriptions
Billing
AI usage
Entitlements
Settings
Security
Customer lifecycle
```

## LAYER B — ECONOMIC PRODUCT LAYER

Responsible for:

```text
Businesses
Economic baseline
Goals
Objectives
Opportunities
Experiments
Missions
Approvals
Execution visibility
Results
Evidence
Economic impact
Decisions
Activity
Economic Control Center
```

## LAYER C — AEE AUTONOMOUS ENGINE

Responsible for:

```text
KIMI
GLM
Orchestrator
FSM
Queue
Economic Engine
Risk Engine
Capital gates
Experiment Engine
Mission Manager
Result Processor
Evidence verification
Ledger
Memory
Prompt Engine
Recovery
Observability
```

Do not collapse these layers.

---

# 2. FINAL CUSTOMER JOURNEY

The canonical AUREX user journey is:

```text
VISITOR
↓
LANDING PAGE
↓
UNDERSTAND VALUE
↓
SIGN UP
↓
VERIFY ACCOUNT
↓
LOGIN
↓
ONBOARDING
↓
ORGANIZATION
↓
BUSINESS
↓
ECONOMIC BASELINE
↓
BUSINESS GOAL
↓
EXECUTION PREFERENCE
↓
FIRST AUREX ANALYSIS
↓
VALUE PREVIEW
↓
PLAN / SUBSCRIPTION
↓
PAYMENT
↓
ACCOUNT ACTIVATED
↓
ECONOMIC CONTROL CENTER
↓
OBJECTIVE
↓
OPPORTUNITY
↓
EXPERIMENT
↓
MISSION
↓
APPROVAL
↓
EXECUTION
↓
VERIFICATION
↓
RESULT
↓
ECONOMIC IMPACT
↓
AUREX DECISION
↓
SCALE / ITERATE / PIVOT / KILL
↓
NEXT CYCLE
↓
OBJECTIVE ACHIEVED
↓
NEXT GOAL
↓
RETENTION
↓
UPGRADE / EXPANSION
```

Every stage must either:

1. exist,
2. be intentionally deferred with evidence that it is nonessential,

or be implemented now.

No silent gaps.

---

# 3. ROOT ROUTING

The application entry point MUST be:

```text
/
```

and MUST show the public landing page.

Do NOT automatically open:

```text
/app
/dashboard
/dashboard.html
/auth
```

Canonical routes:

```text
/
├── /platform
├── /solutions
├── /pricing
├── /enterprise
├── /insights
│
├── /auth/signup
├── /auth/login
├── /auth/verify
├── /auth/forgot-password
├── /auth/reset-password
│
├── /onboarding/*
│
├── /app/*
│
└── /admin/*
```

---

# 4. ROUTE GUARDS

Implement deterministic route guards.

## Anonymous

```text
/app/*
→ /auth/login
```

## Authenticated but onboarding incomplete

```text
/app/*
→ /onboarding
```

## Authenticated + onboarding complete

```text
/app/*
→ allowed
```

## Admin

```text
/admin/*
→ admin authorization required
```

Do not expose admin functionality using only:

```text
#admin
flag
query parameter
hidden button
```

Use actual route-level authorization.

---

# 5. PUBLIC WEBSITE

Canonical public information architecture:

```text
Home
Platform
Solutions
Pricing
Enterprise
Insights
Login
Get Started
```

The marketing site must communicate:

```text
BUSINESS PROBLEM
↓
ECONOMIC OUTCOME
↓
HOW AUREX WORKS
↓
PROOF
↓
CTA
```

Do NOT lead with:

```text
KIMI
GLM
FSM
pg-boss
agent orchestration
model provider
token counts
```

AUREX sells:

```text
better decisions
economic intelligence
controlled execution
measurable outcomes
```

---

# 6. AUTHENTICATION LIFECYCLE

Implement and verify:

```text
Signup
Email verification
Login
Logout
Forgot password
Reset password
Session expiry
Session revocation
Production cookie security
CSRF protection where required
Rate limiting
Brute-force protection
```

No fake or placeholder auth routes.

---

# 7. ORGANIZATION & TENANCY

Canonical hierarchy:

```text
USER
↓
ORGANIZATION
↓
BUSINESS
↓
OBJECTIVE
```

Verify isolation across:

```text
organizations
businesses
objectives
opportunities
experiments
missions
approvals
executions
results
economics
events
billing
usage
settings
```

User A must never access User B / Organization B data.

Test BOLA/IDOR adversarially.

---

# 8. ONBOARDING

Canonical onboarding:

```text
STEP 1 — Organization

STEP 2 — Business

STEP 3 — Economic Baseline

STEP 4 — Goal

STEP 5 — Execution Preference

STEP 6 — First Analysis
```

Do NOT expose backend FSM terminology.

---

# 9. BUSINESS MODE

Support exactly two customer intents.

## EXISTING BUSINESS

Collect:

```text
business name
products/services
target customers
market
business model
revenue
cost structure
baseline economics
```

## BUSINESS DISCOVERY

Collect:

```text
available capital
target economic outcome
market
resources
constraints
risk
time horizon
```

KIMI may then discover the business opportunity.

Do not mix these flows.

---

# 10. ECONOMIC BASELINE

For existing businesses support:

```text
Revenue
COGS
Gross Profit
Operating Expenses
Operating Profit
Customers
AOV
CAC
Retention
```

Values may be:

```text
KNOWN
UNKNOWN
CONNECT_LATER
```

Derived metrics must be calculated by the Economic Engine:

```text
Gross Margin
ROI
LTV
LTV/CAC
Payback
```

Do not ask the user to calculate derived metrics manually.

---

# 11. GOAL SETUP

Customer-facing choices:

```text
Increase Profit
Increase Revenue
Reduce Cost
Improve Unit Economics
Find Growth Opportunities
Launch New Venture
```

Then:

```text
Target
Time Horizon
Capital Available
Risk Tolerance
```

Backend may create `EconomicObjective`.

Customer should not need to understand internal domain class names.

---

# 12. EXECUTION PREFERENCE

Customer labels:

```text
Advisory

Approval Required

Controlled Autonomy
```

Internal levels may remain numeric.

Default for new customers:

```text
Approval Required
```

Do not expose:

```text
Autonomy 1
Autonomy 2
Autonomy 3
```

as the primary UX.

---

# 13. FIRST ANALYSIS

After onboarding do not show an empty dashboard.

Show:

```text
AUREX IS BUILDING YOUR ECONOMIC MODEL

✓ Understanding your business
✓ Calculating baseline economics
● Researching opportunities
○ Ranking opportunities
○ Preparing recommendations
```

Then show limited first economic value.

---

# 14. PAYMENT POSITION

Canonical early SaaS flow:

```text
Signup
↓
Onboarding
↓
Limited Analysis
↓
Value Preview
↓
Plan / Payment
↓
Full Execution
```

Do not require payment before the customer understands AUREX value unless the current commercial model explicitly requires it.

---

# 15. ECONOMIC CONTROL CENTER

Canonical `/app` homepage.

It must answer:

```text
How is the business performing?

What is the current objective?

What has AUREX discovered?

What requires attention?

What happens next?
```

Primary metrics:

```text
Operating Profit
Revenue
Verified Value Created
Capital Deployed
ROI
Active Objective
Current Recommendation
Pending Approval
Recent Economic Impact
```

Do not show raw FSM states.

---

# 16. CUSTOMER NAVIGATION

Canonical menu:

```text
OVERVIEW

BUSINESS
├── Businesses
└── Objectives

INTELLIGENCE
├── Opportunities
└── Experiments

EXECUTION
├── Missions
└── Approvals

PERFORMANCE
├── Results
└── Economics

SYSTEM
└── Activity

SETTINGS
```

---

# 17. BUSINESS → OBJECTIVE HIERARCHY

Customer mental model:

```text
Organization
↓
Business
↓
Objective
↓
Opportunity
↓
Experiment
↓
Mission
↓
Execution
↓
Result
↓
Decision
```

Do NOT make Objective appear to be the parent of Business.

If backend schema can support correct presentation:

do not perform unnecessary DB migration.

If schema fundamentally blocks this hierarchy:

migrate correctly.

---

# 18. OBJECTIVE PAGE

Each objective must show:

```text
Goal
Baseline
Current
Target
Progress
Capital Approved
Capital Used
Time Horizon
Risk
Current Strategy
Current Recommendation
Economic Impact
```

Tabs/subpages may include:

```text
Overview
Economics
Strategy
Experiments
Missions
Results
Activity
```

---

# 19. OPPORTUNITIES

Expose:

```text
Opportunity Name
Customer
Problem
Solution
Business Model
Expected Upside
Capital Required
Time to Revenue
Probability
Risk
Expected Value
Opportunity Score
Why Ranked
Evidence
Assumptions
Unknowns
```

Customer actions:

```text
Select
Reject
Save
```

or:

```text
Let AUREX Decide
```

depending on execution preference.

---

# 20. EXPERIMENTS

Expose:

```text
Hypothesis
Objective
Budget
Duration
Success Metric
Success Threshold
Failure Threshold
Kill Criteria
Scale Criteria
Information Gain
Status
Result
Decision
```

Do not hide experiments only in backend tables.

---

# 21. MISSIONS

Mission view must answer:

```text
What will AUREX do?

Why?

Expected result?

Cost?

Risk?

Tasks?

Required access?

Rollback?

Approval required?
```

Do not expose raw GLM prompts.

---

# 22. APPROVAL CENTER

Top-level approval center required.

Every approval must display:

```text
What will happen
Why
Expected result
Estimated cost
Capital at risk
Expected upside
Expected downside
Risk
Data accessed
External actions
Reversibility
Rollback plan
```

Actions:

```text
Reject
Modify
Approve & Execute
```

---

# 23. EXECUTION

Customer-friendly progress:

```text
✓ Preparation complete
✓ Tracking configured
● Execution running
○ Measuring result
○ Verifying economics
```

Technical execution details belong in:

```text
/admin
or
Advanced Details
```

---

# 24. RESULTS

Show:

```text
Revenue
Cost
Net Economic Result
Customers
Leads
Conversion
CAC
Retention
```

plus evidence quality:

```text
SELF_REPORTED
EVIDENCED
RECONCILED
VERIFIED
```

Do not treat self-reported agent metrics as financial truth.

---

# 25. ECONOMIC TRUTH

Maintain the existing verification principle:

```text
LLM CLAIM
≠
OBSERVED DATA
≠
VERIFIED FINANCIAL TRUTH
```

Only sufficiently verified/reconciled data may affect authoritative economic state.

Never weaken existing ledger integrity.

---

# 26. DECISION

Customer-facing decision output:

```text
AUREX RECOMMENDS

SCALE / ITERATE / PIVOT / KILL
```

Show:

```text
Why
What changed
What was learned
Evidence
Confidence
Next move
Next capital allocation
Expected upside
Expected downside
```

---

# 27. ECONOMICS

Dedicated Economics view must show:

```text
Baseline
Current
Target
```

and:

```text
Revenue
COGS
Gross Profit
Gross Margin
Opex
Operating Profit
Capital Deployed
ROI
CAC
LTV
LTV/CAC
Payback
```

Support filter:

```text
Organization
Business
Objective
Period
```

---

# 28. ACTIVITY

Do not expose:

```text
STATE_UPDATED
RESULT_READY
MISSION_CREATED
```

Translate internal events into human-readable activity.

Example:

```text
AUREX selected WhatsApp Commerce as the highest-ranked opportunity.

Validation experiment created.

Mission approved.

Execution started.

Execution completed.

Economic evidence verified.

AUREX recommends ITERATE.
```

---

# 29. BILLING & USAGE

Implement:

```text
Plan
Subscription
Invoices
Payment Method
Upgrade
Downgrade
Cancel
AI Usage
Included Credits
Overage / Top-up if applicable
```

Usage accounting:

```text
pre-check
↓
reserve
↓
execute
↓
calculate actual usage
↓
settle
```

Do not allow uncontrolled AI usage to exceed unit economics.

---

# 30. SETTINGS

Canonical:

```text
Account
Organization
Team
Billing & Plan
AI Usage
Integrations
Data Sources
Execution Policies
Notifications
Security
API
```

Only implement advanced integrations if they are actually required.

Do not create fake empty modules merely to satisfy menu completeness.

---

# 31. ADMIN SEPARATION

Internal route:

```text
/admin/*
```

Admin may expose:

```text
Customers
Organizations
Subscriptions
AI usage
Agents
Providers
Jobs
Executions
Failures
Model runs
System economics
Audit logs
```

Move all model/provider/internal-state detail out of customer primary UI.

---

# 32. PRESERVE THE VALID AEE ENGINE

Do NOT rewrite verified architecture without evidence.

Preserve:

```text
Postgres source-of-truth
Deterministic orchestrator
FSM
Structured outputs
KIMI strategic role
GLM execution role
Economic Engine
Risk Engine
Experiment Engine
Mission versioning
Result verification
Append-only ledger
Evidence hierarchy
Capital gates
Crash recovery
Idempotency
Queue semantics
Prompt versioning
Model-run audit trail
```

The existing engineering blueprint explicitly defines DB state as authoritative, deterministic calculations outside the LLM, orchestrator-controlled transitions, and provider abstraction. Preserve those principles.

---

# 33. REPOSITORY CLEANUP — MANDATORY

Audit EVERY repository-controlled file and directory.

Classify each as:

```text
REQUIRED
ACTIVE
GENERATED
LEGACY
DUPLICATE
DEAD
UNUSED
OBSOLETE
TEMPORARY
TEST_ONLY
```

Delete everything that is genuinely unused.

Examples:

```text
old dashboard implementations
old static landing pages
stale HTML copies
deprecated API assets
unused React components
unused hooks
unused utilities
unused CSS
dead routes
unused scripts
obsolete migrations
duplicate configs
old Docker files
legacy startup scripts
old provider adapters
unused mock providers
abandoned test fixtures
temporary debugging files
stale backup files
compiled output accidentally committed
obsolete docs
duplicate docs
unused env templates
dead feature flags
unused dependencies
```

---

# 34. SAFE DELETION RULE

Never delete solely because:

```text
grep found no import
```

Before deletion verify:

```text
imports
dynamic imports
runtime references
package.json scripts
Docker COPY paths
fly.toml
CI workflows
build tooling
migration loader
test loader
public assets
route handlers
deployment scripts
documentation links
```

If uncertain:

trace runtime dependency.

Delete only when proven unused.

---

# 35. DUPLICATE IMPLEMENTATION ELIMINATION

There must be exactly one source of truth for:

```text
Landing frontend
Customer app frontend
Admin frontend
Build output
API
Worker
DB migrations
Shared contracts
```

If both exist:

```text
apps/dashboard
packages/api/assets/dashboard.html
```

determine actual production source.

Migrate references.

Verify.

Then delete obsolete duplicate.

Same for landing implementations.

---

# 36. DEPENDENCY CLEANUP

Audit all package manifests.

Remove:

```text
unused dependencies
unused devDependencies
abandoned libraries
duplicate packages
obsolete polyfills
dead plugins
```

Then reinstall lockfile cleanly.

Verify build/test again.

---

# 37. DEAD CODE

Run static analysis and manual inspection for:

```text
unused exports
unused files
unreachable branches
dead feature flags
stale compatibility shims
obsolete fallback logic
old mock code
temporary diagnostic code
commented-out implementation
```

Remove if no longer required.

Do not keep code "just in case."

Git history is the archive.

---

# 38. DOCS CLEANUP

Docs must describe the current system.

Delete or update documents that describe:

```text
old architecture
old route structure
old FSM counts
old model names
obsolete deployment paths
dead features
superseded plans
duplicate audit reports
```

Maintain canonical docs only.

Recommended:

```text
README.md
docs/ARCHITECTURE.md
docs/PRODUCT-FLOW.md
docs/SAAS-LIFECYCLE.md
docs/AEE-ENGINE.md
docs/DEPLOYMENT.md
docs/SECURITY.md
docs/OPERATIONS.md
docs/DESIGN-PARTNER-ALPHA.md
```

Do not keep dozens of contradictory "final" reports.

---

# 39. DATABASE AUDIT

Verify:

```text
all tables used
all indexes justified
all columns used
all constraints valid
all migrations necessary
migration order deterministic
fresh install works
rollback/recovery understood
```

Do NOT delete applied production migrations merely because the schema can be consolidated.

Migration history is immutable after production use.

If pre-production and safe, consolidation may be considered only with explicit proof.

---

# 40. API AUDIT

Every endpoint must map to an actual product or internal operational need.

Classify:

```text
PUBLIC PRODUCT
AUTH
CUSTOMER APP
ADMIN
INTERNAL
WEBHOOK
DEPRECATED
UNUSED
```

Delete unused/deprecated endpoints after proving no client consumes them.

---

# 41. SECURITY AUDIT

Verify:

```text
Auth
Session
Tenant isolation
BOLA / IDOR
CSRF
Rate limits
Password storage
Email verification
Password reset
RBAC
Admin separation
Secret handling
Webhook signatures
Prompt injection controls
Tool authorization
Economic action authorization
Data exposure
Logging sensitivity
```

Fail closed.

---

# 42. ECONOMIC INTEGRITY AUDIT

Verify:

```text
LLM never writes authoritative money directly
economic metrics deterministic
ledger reconciles
duplicate execution cannot duplicate money
self-reported revenue cannot become verified
capital limits enforced
usage costs tracked
profit calculations correct
baseline/current/target coherent
```

Run invariant tests.

---

# 43. FAILURE RECOVERY

Verify:

```text
API crash
worker crash
DB disconnect
provider timeout
provider malformed output
job retry
duplicate job
partial execution
approval timeout
payment webhook replay
stale state
concurrent cycle
```

System must recover without:

```text
duplicate economic action
duplicate ledger entries
corrupt state
lost mission
lost model run
stuck objective
```

---

# 44. CANONICAL E2E TEST SUITE

Create or update a canonical suite that proves:

```text
01 / landing
02 signup
03 verify account
04 login
05 organization onboarding
06 business onboarding
07 baseline
08 goal
09 execution preference
10 first analysis
11 value preview
12 plan/payment/entitlement
13 control center
14 objective
15 opportunity
16 experiment
17 mission
18 approval
19 execution
20 evidence verification
21 result
22 economic impact
23 decision
24 next cycle
25 objective achieved / stopped
26 billing
27 returning user
28 tenant isolation
29 admin isolation
30 logout/session lifecycle
```

Target:

```text
30/30 PASS
```

If functionality is intentionally deferred, do NOT falsely mark PASS.

Implement required capability or explicitly revise canonical scope.

---

# 45. UI LEAK SCAN

Customer-served bundle must not expose internal terms unnecessarily.

Search for:

```text
RESULT_READY
MISSION_CREATED
OBJECTIVE_VALIDATED
RESEARCH_COMPLETE
KIMI k3
GLM 5.x
streamlake
pg-boss
model_run
token count
provider names
internal retry codes
```

Internal source may contain them.

Customer-facing rendered UX must not.

---

# 46. BUILD & RELEASE GATES

Required:

```text
TYPECHECK
PASS

LINT
PASS

UNIT TESTS
PASS

INTEGRATION TESTS
PASS

CONTRACT TESTS
PASS

STATE MACHINE TESTS
PASS

ECONOMIC INVARIANT TESTS
PASS

SECURITY TESTS
PASS

E2E CANONICAL
PASS

BUILD
PASS

BUNDLE LEAK SCAN
PASS

MIGRATION FROM ZERO
PASS

BACKUP
PASS

RESTORE
PASS
```

Do not declare completion if critical gate is skipped.

---

# 47. PRODUCT QUALITY GATE

A new customer must be able to answer from the UI:

```text
What does AUREX do?

What business is AUREX working on?

What is my baseline?

What goal are we pursuing?

What opportunity was identified?

Why was it selected?

What experiment are we running?

What action will AUREX take?

What needs my approval?

What happened?

How much economic value was created?

How strong is the evidence?

What does AUREX recommend next?
```

If any answer requires:

```text
database access
logs
admin panel
raw JSON
FSM knowledge
developer explanation
```

the product flow is incomplete.

---

# 48. NO PLACEHOLDER COMPLETION

Do not satisfy requirements with:

```text
empty pages
fake cards
hardcoded demo data
TODO labels
stub buttons
nonfunctional navigation
API calls with no backend
backend endpoints with no usable UX
```

All required product flows must function.

---

# 49. AUTONOMOUS GAP DISCOVERY

The requirements in this prompt are a baseline, not the boundary.

Inspect the entire repository independently.

If you discover any additional:

```text
bug
security weakness
UX contradiction
architectural gap
data integrity issue
business logic inconsistency
deployment issue
performance issue
dead code
redundancy
testing weakness
recovery flaw
access-control flaw
billing flaw
economic-integrity flaw
```

fix it.

Do not wait for permission.

---

# 50. DO NOT OVERBUILD

"100%" means:

```text
100% coherent
100% functional
100% consistent
100% required lifecycle
```

It does NOT mean:

```text
implement every imaginable enterprise feature
build hundreds of integrations
add speculative functionality
create unused abstractions
```

If a feature has no current canonical requirement or evidence:

do not implement it merely to inflate completeness.

---

# 51. FINAL SELF-AUDIT

Before finalizing, answer:

```text
Is / the landing page?

Can anonymous users access /app? They must not.

Can new users complete signup→onboarding→first analysis?

Is Organization the tenancy boundary?

Is Business parent of Objective in customer UX?

Does every Objective have economic context?

Are Opportunities understandable?

Are Experiments visible?

Are Missions understandable?

Are Approvals actionable?

Are Results evidence-aware?

Is economic impact explicit?

Does AUREX recommend the next move?

Can the full loop repeat?

Is billing connected to entitlement?

Is AI usage controlled?

Are customer and admin surfaces separated?

Are all dead/unused files removed?

Is there only one source for landing/customer/admin frontend?

Can a fresh clone install, migrate, build, test and run?

Can production recover after worker/API/provider/DB failure?

Can the repository be understood without historical context?
```

Any NO = continue remediation.

---

# 52. REQUIRED FINAL REPORT

Return:

```text
# AUREX FINAL COMPLETION REPORT

## 1. Executive Verdict

## 2. Canonical SaaS Flow
PASS/FAIL per stage

## 3. SaaS Customer Layer
score /100

## 4. Economic Product Layer
score /100

## 5. AEE Engine Layer
score /100

## 6. Security
score /100

## 7. Economic Integrity
score /100

## 8. Reliability & Recovery
score /100

## 9. Repository Cleanup

Files deleted:
[...]

Directories deleted:
[...]

Dependencies removed:
[...]

Legacy implementations removed:
[...]

Duplicate sources eliminated:
[...]

## 10. Files Modified

[...]

## 11. Database Changes

[...]

## 12. API Changes

[...]

## 13. UI Changes

[...]

## 14. Canonical E2E Results

[...]

## 15. Test Results

Typecheck:
Lint:
Unit:
Integration:
Security:
Economic invariants:
E2E:
Build:
Migration:
Backup:
Restore:

## 16. Remaining Known Limitations

Only real remaining limitations.

## 17. Deferred Features

Only intentionally deferred noncritical features.

## 18. Production Readiness Verdict

READY / NOT READY

## 19. Design Partner Readiness

READY / NOT READY

## 20. Git Status

Exact changed/deleted files.

## 21. Final Recommendation

FREEZE / CONTINUE REMEDIATION
```

---

# 53. COMPLETION STANDARD

Do NOT declare:

```text
100%
DONE
READY
PRODUCTION READY
```

unless:

```text
SaaS Layer             100%
Product Layer          100%
AEE Engine             100%
Canonical E2E          PASS
Security Gates         PASS
Economic Integrity     PASS
Repository Hygiene     PASS
No critical dead code
No duplicate implementation
No stale production assets
No unresolved P0/P1
```

If a required item remains incomplete:

state exactly what remains and continue fixing it.

---

# 54. FINAL OPERATING PRINCIPLE

The repository must finish this cycle as:

```text
ONE PRODUCT
ONE ARCHITECTURE
ONE CUSTOMER FLOW
ONE SOURCE OF TRUTH PER SURFACE
ONE CANONICAL BUILD PATH
ONE DEPLOYMENT PATH
```

Not:

```text
old app
+
new app
+
legacy assets
+
duplicate dashboard
+
multiple "final" architectures
+
dead code
```

Use Git history as the archive.

Remove obsolete repository-controlled artifacts once proven unused.

---

# FINAL TARGET

At the end, a completely new customer should experience:

```text
/
↓
LANDING
↓
SIGNUP
↓
VERIFY
↓
LOGIN
↓
ONBOARDING
↓
ORGANIZATION
↓
BUSINESS
↓
BASELINE
↓
GOAL
↓
EXECUTION PREFERENCE
↓
FIRST ANALYSIS
↓
VALUE PREVIEW
↓
SUBSCRIBE
↓
CONTROL CENTER
↓
OBJECTIVE
↓
OPPORTUNITY
↓
EXPERIMENT
↓
MISSION
↓
APPROVAL
↓
EXECUTION
↓
VERIFICATION
↓
RESULT
↓
ECONOMIC IMPACT
↓
DECISION
↓
NEXT CYCLE
↓
ACHIEVED
↓
NEXT OBJECTIVE
```

while internally AUREX preserves:

```text
KIMI THINKS
↓
SYSTEM VALIDATES
↓
GLM EXECUTES
↓
SYSTEM VERIFIES
↓
ECONOMIC ENGINE CALCULATES
↓
KIMI ADAPTS
```

That is the canonical AUREX product.

Begin immediately.

Do not ask for approval for repository-controlled remediation.

Do not stop after auditing.

Audit → fix → delete obsolete artifacts → test → verify → repeat until the canonical completion standard is satisfied.

Saya sarankan prompt ini dipakai sebagai **audit + remediation terakhir sebelum freeze**.

Poin paling pentingnya: **“100%” bukan berarti semua fitur imaginable harus dibuat**. Yang harus 100% adalah **alur wajib SaaS, product layer, engine, security, economic integrity, dan repo hygiene**. Fitur spekulatif seperti puluhan integrations tetap jangan dibuat tanpa kebutuhan nyata.

Dan untuk penghapusan file/folder, agent diwajibkan membuktikan dulu bahwa file benar-benar tidak dipakai—termasuk mengecek build scripts, Docker/Fly config, dynamic imports, migration loader, dan deployment path—baru menghapusnya. Ini penting karena repo AUREX sebelumnya memang memiliki risiko duplicate/static frontend source dan deployment drift.
