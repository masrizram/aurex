// AEE Landing — single-file Vite app entry.
// Renders an SEO-optimized, McKinsey-positioned B2B SaaS landing page using
// the same design tokens as apps/dashboard. No framework — just the DOM.

import "./index.css";

document.documentElement.setAttribute("data-theme", "dark");

// ── Render landing page into #root ──────────────────────────────
const root = document.getElementById("root");
if (root) {
  root.innerHTML = `
  <!-- ── Nav ────────────────────────────────────────────────── -->
  <nav class="nav" role="navigation" aria-label="Main navigation">
    <div class="nav-inner">
      <a href="#" class="nav-brand">A<span>EE</span></a>
      <div class="nav-links">
        <a href="#modules">Platform</a>
        <a href="#how-it-works">How It Works</a>
        <a href="#industries">Industries</a>
        <a href="#pricing">Pricing</a>
        <a href="#insights">Insights</a>
        <a href="#request-access" class="nav-cta" id="hero-request-access">Request Access</a>
      </div>
    </div>
  </nav>

  <!-- ── Hero ──────────────────────────────────────────────── -->
  <header class="hero" id="hero">
    <div class="container">
      <h1>Make your next economic move <span class="accent">your best one.</span></h1>
      <p class="hero-sub">AEE combines economic intelligence, AI strategy, autonomous execution, and continuous learning to help organizations identify their highest-value opportunities and turn decisions into measurable results.</p>
      <div class="hero-ctas">
        <!-- CTA utama menuju app langsung (register/login ada di /app): journey homepage → app tanpa gap -->
  <a href="/app" class="btn-primary" id="hero-request-access">Request Access</a>
        <a href="#modules" class="btn-secondary">Explore Platform</a>
      </div>
    </div>
  </header>

  <!-- ── Trust bar ─────────────────────────────────────────── -->
  <div class="trust-bar">
    <div class="container">
      <p>AI-Powered Economic Intelligence &amp; Autonomous Execution Platform</p>
    </div>
  </div>

  <!-- ── 4 Modules ─────────────────────────────────────────── -->
  <section class="section" id="modules">
    <div class="container">
      <p class="section-eyebrow">Platform</p>
      <h2 class="section-title">Four modules. One economic operating system.</h2>
      <p class="section-subtitle">AEE unifies the entire economic decision lifecycle — from opportunity discovery to measured execution to organizational learning — into a single, AI-powered platform.</p>
      <div class="modules-grid">
        <div class="module-card">
          <div class="module-icon" aria-hidden="true">◈</div>
          <h3>Economic Intelligence</h3>
          <p>Discover and evaluate your highest-value opportunities with AI-powered market analysis, customer intelligence, and opportunity scoring.</p>
          <ul>
            <li>Market &amp; competitor intelligence</li>
            <li>Opportunity discovery &amp; scoring</li>
            <li>Business thesis generation</li>
            <li>Risk &amp; expected value analysis</li>
          </ul>
        </div>
        <div class="module-card">
          <div class="module-icon" aria-hidden="true">◆</div>
          <h3>Economic Strategy</h3>
          <p>Rank opportunities, design experiments, and allocate capital with confidence. Every decision backed by data, not guesswork.</p>
          <ul>
            <li>Opportunity ranking &amp; selection</li>
            <li>Experiment design with thresholds</li>
            <li>Unit economics &amp; scenario analysis</li>
            <li>Scale / pivot / kill decisions</li>
          </ul>
        </div>
        <div class="module-card">
          <div class="module-icon" aria-hidden="true">▸</div>
          <h3>Execution Control</h3>
          <p>Turn decisions into action. AI agents orchestrate missions, manage approvals, and execute experiments — with full audit trails.</p>
          <ul>
            <li>Mission creation &amp; orchestration</li>
            <li>Autonomous AI agent execution</li>
            <li>Approval gates &amp; autonomy levels</li>
            <li>Real-time execution monitoring</li>
          </ul>
        </div>
        <div class="module-card">
          <div class="module-icon" aria-hidden="true">∞</div>
          <h3>Economic Memory</h3>
          <p>Every decision, experiment, and result becomes organizational knowledge. AEE learns from every cycle to make better next decisions.</p>
          <ul>
            <li>Past objectives &amp; experiments</li>
            <li>Execution results &amp; measurements</li>
            <li>Assumption → fact promotion</li>
            <li>Successful playbook capture</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ── How It Works ─────────────────────────────────────── -->
  <section class="section" id="how-it-works" style="background: var(--color-surface-elevated);">
    <div class="container">
      <p class="section-eyebrow">How It Works</p>
      <h2 class="section-title">From objective to outcome — continuously.</h2>
      <p class="section-subtitle">AEE runs a continuous loop: understand, decide, execute, measure, adapt. Each cycle makes the next one smarter.</p>
      <div class="flow">
        <div class="flow-step">
          <div class="flow-step-num">01</div>
          <div class="flow-step-label">Objective</div>
          <div class="flow-step-desc">Define your economic goal</div>
        </div>
        <div class="flow-step">
          <div class="flow-step-num">02</div>
          <div class="flow-step-label">AUREX Analyzes</div>
          <div class="flow-step-desc">AI discovers opportunities</div>
        </div>
        <div class="flow-step">
          <div class="flow-step-num">03</div>
          <div class="flow-step-label">Strategy</div>
          <div class="flow-step-desc">Rank, select, design experiment</div>
        </div>
        <div class="flow-step">
          <div class="flow-step-num">04</div>
          <div class="flow-step-label">AUREX Executes</div>
          <div class="flow-step-desc">AI agent runs the mission</div>
        </div>
        <div class="flow-step">
          <div class="flow-step-num">05</div>
          <div class="flow-step-label">Measurement</div>
          <div class="flow-step-desc">Results captured &amp; verified</div>
        </div>
        <div class="flow-step">
          <div class="flow-step-num">06</div>
          <div class="flow-step-label">Adapt</div>
          <div class="flow-step-desc">Iterate, scale, pivot, or kill</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Industries ───────────────────────────────────────── -->
  <section class="section" id="industries">
    <div class="container" style="text-align: center;">
      <p class="section-eyebrow">Industries</p>
      <h2 class="section-title">Built for decision-makers across industries.</h2>
      <p class="section-subtitle" style="margin-inline: auto;">AEE adapts to your industry context — from financial services to manufacturing to professional services.</p>
      <div class="industries-grid">
        <div class="industry-chip">Financial Services</div>
        <div class="industry-chip">Retail</div>
        <div class="industry-chip">Technology</div>
        <div class="industry-chip">Manufacturing</div>
        <div class="industry-chip">Professional Services</div>
      </div>
    </div>
  </section>

  <!-- ── Capabilities ─────────────────────────────────────── -->
  <section class="section" style="background: var(--color-surface-elevated);">
    <div class="container">
      <p class="section-eyebrow">Capabilities</p>
      <h2 class="section-title">Everything you need to make better economic decisions.</h2>
      <div class="cap-grid">
        <div class="capability-card"><h4>Economic Intelligence</h4><p>Market analysis, competitor research, customer intelligence, and opportunity discovery powered by AI.</p></div>
        <div class="capability-card"><h4>Strategy</h4><p>Opportunity ranking, experiment design, capital allocation, and scale/pivot/kill decision frameworks.</p></div>
        <div class="capability-card"><h4>Business Building</h4><p>From thesis to venture. AEE helps you design, validate, and launch new business lines.</p></div>
        <div class="capability-card"><h4>Growth</h4><p>Identify growth paths, model unit economics, and optimize customer acquisition and retention.</p></div>
        <div class="capability-card"><h4>Capital Allocation</h4><p>Deploy capital where expected returns are highest. AEE ranks opportunities by risk-adjusted value.</p></div>
        <div class="capability-card"><h4>Autonomous Execution</h4><p>AI agents execute missions with approval gates, autonomy levels, and full audit trails.</p></div>
      </div>
    </div>
  </section>

  <!-- ── Solutions ────────────────────────────────────────── -->
  <section class="section">
    <div class="container">
      <p class="section-eyebrow">Solutions</p>
      <h2 class="section-title">Products that power the economic OS.</h2>
      <div class="solutions-grid">
        <div class="solution-card"><h4>Opportunity Engine</h4><p>AI-powered discovery and ranking of economic opportunities tailored to your business context and constraints.</p></div>
        <div class="solution-card"><h4>Economic Control Center</h4><p>Real-time dashboard for monitoring objectives, experiments, executions, and economic outcomes.</p></div>
        <div class="solution-card"><h4>AI Executive</h4><p>Autonomous AI agents that execute missions, manage workflows, and report results — with human oversight.</p></div>
        <div class="solution-card"><h4>Experiment Engine</h4><p>Design, run, and measure business experiments with clear hypotheses, budgets, and success/failure thresholds.</p></div>
        <div class="solution-card"><h4>Economic Memory</h4><p>Your organizational knowledge base of past decisions, results, assumptions, and proven playbooks.</p></div>
        <div class="solution-card"><h4>Capital Allocator</h4><p>Dynamic capital allocation across opportunities based on risk-adjusted expected returns and real-time performance.</p></div>
      </div>
    </div>
  </section>

  <!-- ── Pricing ──────────────────────────────────────────── -->
  <section class="section" id="pricing" style="background: var(--color-surface-elevated);">
    <div class="container">
      <p class="section-eyebrow">Pricing</p>
      <h2 class="section-title">Choose your economic intelligence tier.</h2>
      <p class="section-subtitle">From exploration to enterprise-scale economic orchestration. Start free, scale as you grow.</p>
      <div class="pricing-grid">
        <div class="pricing-card">
          <div class="pricing-tier">Free</div>
          <div class="pricing-name">Economic Explorer</div>
          <div class="pricing-price">Rp0</div>
          <div class="pricing-period">forever</div>
          <ul class="pricing-features">
            <li>1 active business</li>
            <li>1 objective at a time</li>
            <li>Basic economic analysis</li>
            <li>100 AI credits/month</li>
            <li>Community support</li>
          </ul>
        </div>
        <div class="pricing-card">
          <div class="pricing-tier">Starter</div>
          <div class="pricing-name">Solo Founder</div>
          <div class="pricing-price">Rp499K–999K</div>
          <div class="pricing-period">per month</div>
          <ul class="pricing-features">
            <li>5 objectives</li>
            <li>3 businesses</li>
            <li>Economic dashboard</li>
            <li>Strategy engine</li>
            <li>1,000 AI credits/month</li>
            <li>Email support</li>
          </ul>
        </div>
        <div class="pricing-card featured">
          <div class="pricing-tier">Growth</div>
          <div class="pricing-name">Growing SME</div>
          <div class="pricing-price">Rp2.5M–5M</div>
          <div class="pricing-period">per month</div>
          <ul class="pricing-features">
            <li>Unlimited objectives</li>
            <li>10 businesses</li>
            <li>Advanced economic modeling</li>
            <li>Real AI providers</li>
            <li>Agent orchestration</li>
            <li>10,000 AI credits/month</li>
            <li>Priority support</li>
          </ul>
        </div>
        <div class="pricing-card">
          <div class="pricing-tier">Enterprise</div>
          <div class="pricing-name">Corporation</div>
          <div class="pricing-price">Custom</div>
          <div class="pricing-period">from Rp100M/year</div>
          <ul class="pricing-features">
            <li>Unlimited everything</li>
            <li>Multiple entities &amp; teams</li>
            <li>Private models &amp; providers</li>
            <li>Custom agents</li>
            <li>SSO &amp; audit logs</li>
            <li>API access</li>
            <li>Dedicated infrastructure</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Insights ─────────────────────────────────────────── -->
  <section class="section" id="insights">
    <div class="container">
      <p class="section-eyebrow">Insights</p>
      <h2 class="section-title">Research-driven economic intelligence.</h2>
      <p class="section-subtitle">Explore our latest research on economic decision-making, AI-driven strategy, and autonomous business execution.</p>
      <div class="insights-grid">
        <div class="insight-card">
          <div class="tag">Research</div>
          <h4>The economics of AI-driven decision-making: a framework for measuring ROI</h4>
          <p>How to quantify the value of AI-powered economic intelligence in your organization.</p>
        </div>
        <div class="insight-card">
          <div class="tag">Case Study</div>
          <h4>From discovery to execution: a WhatsApp commerce automation case study</h4>
          <p>How AEE identified, ranked, and executed a WhatsApp commerce opportunity for Indonesian UMKM.</p>
        </div>
        <div class="insight-card">
          <div class="tag">Market Intelligence</div>
          <h4>Indonesian SME opportunities 2026: where capital meets growth</h4>
          <p>A data-driven analysis of high-growth opportunities in the Indonesian SME landscape.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ── CTA ──────────────────────────────────────────────── -->
  <section class="cta-section" id="request-access">
    <div class="container">
      <h2>Ready to make your next economic move?</h2>
      <p>Request access to AEE and start turning business decisions into measurable economic outcomes.</p>
      <a href="/app" class="btn-primary">Request Access</a>
    </div>
  </section>

  <!-- ── Footer ───────────────────────────────────────────── -->
  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="footer-brand">A<span>EE</span></div>
          <p class="footer-desc">AI-Powered Economic Intelligence &amp; Autonomous Execution Platform. Turn decisions into measurable results.</p>
        </div>
        <div class="footer-col">
          <h5>Platform</h5>
          <a href="#modules">Economic Intelligence</a>
          <a href="#modules">Economic Strategy</a>
          <a href="#modules">Execution Control</a>
          <a href="#modules">Economic Memory</a>
        </div>
        <div class="footer-col">
          <h5>Company</h5>
          <a href="#industries">Industries</a>
          <a href="#pricing">Pricing</a>
          <a href="#insights">Insights</a>
          <a href="#request-access">Request Access</a>
        </div>
        <div class="footer-col">
          <h5>Resources</h5>
          <a href="/app">Documentation</a>
          <a href="/app">API Reference</a>
          <a href="/app">Case Studies</a>
          <a href="/app">Research</a>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; <span id="current-year">2026</span> AEE. All rights reserved.</p>
      </div>
    </div>
  </footer>
  `;
}

// ── Smooth-scroll for in-page anchors ──────────────────────────
function smoothScroll(target: string): void {
  const node = document.querySelector(target);
  if (node) {
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    (node as HTMLElement).setAttribute("tabindex", "-1");
    (node as HTMLElement).focus({ preventScroll: true });
  }
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const a = t.closest("a[href^='#']") as HTMLAnchorElement | null;
  if (a) {
    const href = a.getAttribute("href");
    if (href && href.length > 1) {
      e.preventDefault();
      smoothScroll(href);
    }
  }
});

// ── Reveal-on-scroll for flow steps (progressive enhancement) ──
if ("IntersectionObserver" in window) {
  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.2, rootMargin: "0px 0px -60px 0px" },
  );
  for (const n of Array.from(document.querySelectorAll(".flow-step, .module-card, .capability-card, .solution-card, .pricing-card, .industry-chip, .insight-card"))) {
    n.classList.add("will-reveal");
    obs.observe(n);
  }
}

// ── Current year in footer ─────────────────────────────────────
const year = document.getElementById("current-year");
if (year) year.textContent = new Date().getFullYear().toString();
