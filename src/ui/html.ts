import type { ManualUploadResultsViewModel, ServerResultsCard } from "./index.js";

export interface ManualUploadPageViewModel {
  title: string;
  subtitle: string;
  uploadModeLabel: string;
  acceptedFiles: string[];
  requiredSpreadsheetColumns: string[];
  requiredCurrentConfigFields: string[];
  optionalFields: string[];
  safeguards: string[];
  submitLabel: string;
}

export function buildManualUploadPageView(): ManualUploadPageViewModel {
  return {
    title: "RDS SQL Server Cost Optimization",
    subtitle: "Find safe ways to reduce SQL Server cloud spend without putting production performance at risk.",
    uploadModeLabel: "Upload one or more collector ZIP packages",
    acceptedFiles: [".zip"],
    requiredSpreadsheetColumns: ["ServerName", "Login", "Password", "Database", "RDSSize"],
    requiredCurrentConfigFields: [
      "Derived from collector output only"
    ],
    optionalFields: [
      "VendorSupportsStandardEdition",
      "MigrationPathAccepted",
      "MigrationPath (native_backup_restore or aws_dms)"
    ],
    safeguards: [
      "Cost Optimization diagnostics must be explicitly enabled in RunMefirst.",
      "Passwords are collector-only and must not appear in normalized reports.",
      "Pricing is deferred; results show workload fit and evidence checks only.",
      "Recommendations must pass memory, instance IOPS, instance throughput, tempdb, edition, orderability, and independent harness checks.",
      "The current gp3/io1/io2 storage design is retained; storage provisioning optimization is outside this phase."
    ],
    submitLabel: "Analyze upload"
  };
}

export function renderManualUploadPageHtml(view: ManualUploadPageViewModel = buildManualUploadPageView()): string {
  return pageShell(view.title, `
    <main class="shell">
      <section class="guide-hero">
        <div>
          <p class="eyebrow">RDS SQL Server cost optimization</p>
          <h1>Reduce database spend with evidence, not guesswork.</h1>
          <p>${escapeHtml(view.subtitle)} We help decide whether an RDS SQL Server workload can safely move to a lower compute footprint, or whether the right business decision is to wait.</p>
        </div>
        <aside class="guide-summary" aria-label="Offering summary">
          <span class="value-label">Business decision</span>
          <strong>Recommended, Aggressive Optimization, or Stay As Is.</strong>
          <p class="muted">Each result explains confidence, evidence checks, and why a workload should scale down or stay as is.</p>
        </aside>
      </section>

      <section class="business-grid live-cards" aria-label="Offering summary">
        ${featurePanel(
          "Why It Matters",
          "RDS SQL Server costs combine cloud compute and SQL Server licensing. Oversized instances can quietly become a recurring business expense."
        )}
        ${featurePanel(
          "What We Do",
          "We use collector evidence to evaluate workload fit across CPU, memory, I/O, throughput, tempdb, edition, orderability, and evidence quality."
        )}
        ${featurePanel(
          "What You Get",
          "A concise decision package for leadership and engineering: recommendation, confidence, evidence checks, and exportable evidence."
        )}
      </section>

      <section class="process-panel panel" aria-labelledby="short-process-title">
        <div>
          <p class="section-kicker">How it works</p>
          <h2 id="short-process-title">Three steps, no sprawling page.</h2>
        </div>
        <div class="process-steps three-steps" aria-label="Assessment workflow">
          ${processStep("1", "Collect", "Run the standalone collector for the SQL Server workload.")}
          ${processStep("2", "Analyze", "Upload the collector package for workload-fit evaluation.")}
          ${processStep("3", "Decide", "Review the outcome, evidence checks, and next actions.")}
        </div>
      </section>

      <section class="proof-strip" aria-label="Offering principles">
        <span>SQL Server only</span>
        <span>Collector-first evidence</span>
        <span>No automatic RDS changes</span>
        <span>No pricing or storage redesign in this phase</span>
      </section>

      <section class="offering-services panel" aria-labelledby="overview-services-title">
        <div class="service-copy">
          <p class="section-kicker">Offering services</p>
          <h2 id="overview-services-title">Choose the service page when you are ready.</h2>
          <p class="muted">Start assessment and collector download actions live on their own page.</p>
        </div>
        <div class="service-actions">
          <a class="button-link success" href="/cost/services">View Offering Services</a>
        </div>
      </section>
    </main>
  `);
}

export function renderOfferingServicesPageHtml(view: ManualUploadPageViewModel = buildManualUploadPageView()): string {
  return pageShell(view.title, `
    <main class="shell">
      <section class="guide-hero">
        <div>
          <p class="eyebrow">Offering services</p>
          <h1>Start the RDS SQL Server cost optimization service.</h1>
          <p>Select how you want to begin. Download the collector for a customer environment, or open the assessment workspace when the collector package is ready.</p>
        </div>
        <aside class="guide-summary" aria-label="Service summary">
          <span class="value-label">Service scope</span>
          <strong>Collector-first workload optimization for RDS SQL Server.</strong>
          <p class="muted">The service produces a workload-fit outcome, confidence, evidence checks, and exportable evidence.</p>
        </aside>
      </section>

      <section class="service-grid" aria-label="Offering service actions">
        <article class="panel service-card" aria-labelledby="assessment-service-title">
          <p class="section-kicker">Assessment service</p>
          <h2 id="assessment-service-title">Start Assessment</h2>
          <p class="muted">Upload a completed collector ZIP and generate the workload optimization decision.</p>
          <a class="button-link success" href="/cost/assessment">Start Assessment</a>
        </article>
        <article class="panel service-card" aria-labelledby="collector-service-title">
          <p class="section-kicker">Collector package</p>
          <h2 id="collector-service-title">Download Collector</h2>
          <p class="muted">Download the standalone collector package used to gather the evidence for this service.</p>
          <a class="button-link secondary" href="/cost/collector" download="RDSCostOptimizationCollector.zip">Download Collector</a>
        </article>
      </section>

      <section class="process-panel panel" aria-labelledby="services-process-title">
        <div>
          <p class="section-kicker">Service flow</p>
          <h2 id="services-process-title">Download, collect, upload, decide.</h2>
        </div>
        <div class="process-steps three-steps" aria-label="Offering service flow">
          ${processStep("1", "Download", "Get the collector package for the customer environment.")}
          ${processStep("2", "Collect", "Run the collector and produce the customer ZIP package.")}
          ${processStep("3", "Assess", "Upload the ZIP and review the workload-fit decision.")}
        </div>
      </section>
    </main>
  `);
}

export function renderSimpleInfoPageHtml(title: string, eyebrow: string, heading: string, body: string): string {
  return pageShell(title, `
    <main class="shell">
      <section class="guide-hero">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h1>${escapeHtml(heading)}</h1>
          <p>${escapeHtml(body)}</p>
          <div class="hero-actions">
            <a class="button-link success" href="/cost/services">View Offering Services</a>
            <a class="button-link secondary" href="/cost">Back to Overview</a>
          </div>
        </div>
      </section>
    </main>
  `);
}

export function renderAssessmentPageHtml(view: ManualUploadPageViewModel = buildManualUploadPageView()): string {
  return pageShell(view.title, `
    <main class="shell">
      <section class="guide-hero">
        <div>
          <p class="eyebrow">Assessment workspace</p>
          <h1>Upload collector evidence and generate the workload decision.</h1>
          <p>Use this page when the collector package is ready. The analysis returns the recommendation, confidence, evidence checks, and exportable evidence for review.</p>
          <div class="hero-actions">
            <a class="button-link success" href="/cost/collector" download="RDSCostOptimizationCollector.zip">Download Collector</a>
            <a class="button-link secondary" href="/cost">Back to Overview</a>
          </div>
        </div>
        <aside class="guide-summary" aria-label="Assessment summary">
          <span class="value-label">Required input</span>
          <strong>Collector ZIP from the customer workload.</strong>
          <dl>
            <dt>Scope</dt><dd>RDS for SQL Server</dd>
            <dt>Input</dt><dd>Collector evidence</dd>
            <dt>Output</dt><dd>Outcome, confidence, evidence checks</dd>
            <dt>Excluded</dt><dd>Detailed pricing and storage redesign</dd>
          </dl>
        </aside>
      </section>

      <section class="workspace-grid" id="upload">
        <section class="panel action-panel download-panel" aria-labelledby="download-title">
          <div>
            <p class="section-kicker">Start the assessment</p>
            <h2 id="download-title">Download Collector</h2>
            <p class="muted">Use the collector to gather the evidence needed for an RDS SQL Server cost optimization review.</p>
          </div>
          <a class="button-link success" href="/cost/collector" download="RDSCostOptimizationCollector.zip">Download Collector</a>
        </section>

        <section class="panel action-panel upload-panel" aria-labelledby="upload-title">
          <div>
            <p class="section-kicker">Run the assessment</p>
            <h2 id="upload-title">Upload the completed collector package</h2>
            <p class="muted">The analysis returns the optimization outcome, confidence, evidence checks, and exportable business evidence.</p>
          </div>
          <form method="post" action="/cost/analyze" enctype="multipart/form-data" data-upload-form>
            <label class="field">
              <span>Customer name</span>
              <input name="customerName" type="text" placeholder="Customer or account name">
            </label>
            <label class="field file-field">
              <span>Collector output ZIP</span>
              <input name="collectorPackages" type="file" multiple accept=".zip">
            </label>
            <button type="submit" data-submit-label="${escapeAttribute(view.submitLabel)}">${escapeHtml(view.submitLabel)}</button>
            <p class="upload-status" role="status" aria-live="polite" data-upload-status hidden></p>
          </form>
        </section>
      </section>

      <section class="grid two compact-grid">
        ${listPanel("Information Needed", view.requiredSpreadsheetColumns)}
        ${listPanel("Safeguards", view.safeguards)}
      </section>
    </main>
  `);
}
export function renderManualUploadResultsHtml(view: ManualUploadResultsViewModel): string {
  return pageShell(view.title, `
    <main class="shell">
      <section class="page-header page-header-split">
        <div class="headline">
          <p class="eyebrow">Workload results</p>
          <h1>${escapeHtml(view.title)}</h1>
          <p>${escapeHtml(view.pricingNotice)}</p>
        </div>
        <div class="status-stack" aria-label="Exports available">
          <span>JSON</span>
          <span>CSV</span>
          <span>PDF</span>
        </div>
      </section>

      <section class="summary-grid" aria-label="Fleet summary">
        ${metricTile("Total servers", view.fleet.totalServers)}
        ${metricTile("Recommended", view.fleet.recommendedServers)}
        ${metricTile("Aggressive", view.fleet.aggressiveOptimizationServers)}
        ${metricTile("Stay as is", view.fleet.notOptimizedServers)}
      </section>

      ${view.fleet.totalServers > 1 ? renderFleetServerRows(view.servers) : `
      <section class="server-list">
        ${view.servers.map((server) => renderServerCard(server)).join("")}
      </section>`}

      <section class="export-row" aria-label="Exports">
        ${view.exportActions.map((action) => action.available && action.href
          ? `<a class="button-link" href="${escapeAttribute(action.href)}" download="${escapeAttribute(action.filename ?? "rds-cost-optimization")}">${escapeHtml(action.label)}</a>`
          : `<button type="button" disabled>${escapeHtml(action.label)}</button>`).join("")}
      </section>

      ${view.fleet.totalServers > 1 ? fleetOutcomeOverview(view) : ""}
    </main>
  `);
}

function fleetOutcomeOverview(view: ManualUploadResultsViewModel): string {
  const groups = view.fleet.outcomeGroups.filter((group) => group.count > 0);
  return `
    <details class="fleet-overview" aria-label="Multi-server fleet outcome">
      <summary>
        <span>Outcome groups</span>
        <strong>${escapeHtml(String(view.fleet.totalServers))} server${view.fleet.totalServers === 1 ? "" : "s"}</strong>
      </summary>
      <div class="fleet-outcome-grid">
        ${groups.map((group) => `
          <article class="fleet-outcome-card ${escapeAttribute(group.status)}">
            <div class="fleet-outcome-card-top">
              <strong>${escapeHtml(group.label)}</strong>
              <span>${escapeHtml(String(group.count))}</span>
            </div>
            <p>${escapeHtml(group.summary)}</p>
            <ul>${group.serverNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
          </article>
        `).join("")}
      </div>
    </details>
  `;
}

function renderFleetServerRows(servers: readonly ServerResultsCard[]): string {
  return `
    <section class="panel fleet-server-rows" aria-labelledby="server-decisions-title">
      <div class="fleet-list-header">
        <div>
          <p class="section-kicker">Multi-server assessment</p>
          <h2 id="server-decisions-title">Server Decisions</h2>
        </div>
        <span>${escapeHtml(String(servers.length))} server${servers.length === 1 ? "" : "s"}</span>
      </div>
      <div class="fleet-server-row fleet-server-heading" aria-hidden="true">
        <span>Action</span>
        <span>Server</span>
        <span>Current -> Target</span>
        <span>Confidence</span>
        <span>Top driver</span>
        <span>Reason</span>
        <span>Evidence</span>
      </div>
      ${servers.map(renderFleetServerRow).join("")}
    </section>
  `;
}

function renderFleetServerRow(server: ServerResultsCard): string {
  return `
    <details class="fleet-server-row-wrap ${server.outcome}" aria-labelledby="${domId(server.serverName)}-row-title">
      <summary class="fleet-server-row">
        <span class="fleet-row-outcome">${escapeHtml(server.statusLabel)}</span>
        <strong id="${domId(server.serverName)}-row-title">${escapeHtml(server.serverName)}</strong>
        <span>${escapeHtml(moveSummary(server))}</span>
        <span>${escapeHtml(server.evidenceWindow.confidence)}</span>
        <span>${escapeHtml(topDriverSummary(server))}</span>
        <span class="fleet-row-reason">${escapeHtml(shortScanNote(server))}</span>
        <span class="fleet-row-review">Open</span>
      </summary>
      <div class="fleet-row-detail-body">
        ${server.assessmentNotes.length > 0 ? assessmentNotesPanel(server) : ""}
        ${issuePanel(server)}
        ${server.resourceGates.length > 0 ? resourceGateMatrix(server) : ""}
        ${fullConfigurationComparison(server)}
        ${moreDetailsContent(server)}
      </div>
    </details>
  `;
}

function moveSummary(server: ServerResultsCard): string {
  if (server.current.instanceClass === server.optimized.instanceClass) {
    return `Keep ${server.current.instanceClass}`;
  }
  return `${server.current.instanceClass} -> ${server.optimized.instanceClass}`;
}

function shortScanNote(server: ServerResultsCard): string {
  const reasons = scanReasons(server).filter((reason) =>
    !/^outcome:/i.test(reason) &&
    !/^compute changes/i.test(reason)
  );
  const source = reasons[0] ?? server.actionPlan[0] ?? server.decisionSummary;
  return conciseText(source, 120);
}

function conciseText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength - 1).trimEnd();
  const lastBreak = clipped.lastIndexOf(" ");
  return `${(lastBreak > 80 ? clipped.slice(0, lastBreak) : clipped).trimEnd()}...`;
}
function renderServerCard(server: ServerResultsCard, collapsePerServerDetail = false): string {
  return `
    <article class="panel server-card ${server.outcome}${collapsePerServerDetail ? " compact-multi" : ""}" aria-labelledby="${domId(server.serverName)}-title">
      <header class="server-header compact-server-header">
        <div>
          <p class="eyebrow">${escapeHtml(server.statusLabel)}</p>
          <h2 id="${domId(server.serverName)}-title">${escapeHtml(server.serverName)}</h2>
        </div>
        <span class="outcome-pill">${escapeHtml(server.statusLabel)}</span>
      </header>

      <section class="assessment-board compact-assessment-board" aria-label="Assessment result summary">
        <div class="decision-panel">
          <span class="value-label">Outcome</span>
          <strong>${escapeHtml(server.statusLabel)}</strong>
          <p>${escapeHtml(server.assessmentDetail)}</p>
        </div>
        <div class="metric-strip compact-metric-strip">
          ${server.visualMetrics.map((metric) => `
            <div class="fit-metric">
              <span>${escapeHtml(metric.label)}</span>
              <strong>${escapeHtml(metric.value)}</strong>
              <small>${escapeHtml(metric.detail)}</small>
            </div>
          `).join("")}
        </div>
      </section>

      ${serverScanSummary(server)}

      ${collapsePerServerDetail ? serverDetailDisclosure(server) : moreDetails(server)}
    </article>
  `;
}

function serverScanSummary(server: ServerResultsCard): string {
  const reasons = scanReasons(server).slice(0, 3);
  const nextAction = server.actionPlan[0];
  return `
    <section class="customer-snapshot" aria-label="Customer decision snapshot">
      <div class="snapshot-grid">
        ${snapshotItem("Current", server.current.instanceClass)}
        ${snapshotItem(server.optimizedTitle, server.optimized.instanceClass)}
        ${snapshotItem("Confidence", server.evidenceWindow.confidence)}
        ${snapshotItem("Top driver", topDriverSummary(server))}
      </div>
      ${reasons.length > 0 ? `
        <div class="snapshot-notes">
          <h3>${server.outcome === "not_recommended" ? "Why As Is" : "Why Optimized"}</h3>
          <ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
        </div>
      ` : ""}
      ${nextAction ? `
        <div class="snapshot-next-action">
          <h3>Next Action</h3>
          <p>${escapeHtml(nextAction)}</p>
        </div>
      ` : ""}
    </section>
  `;
}

function snapshotItem(label: string, value: string): string {
  return `
    <div class="snapshot-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function scanReasons(server: ServerResultsCard): string[] {
  const outcomeReasons = server.outcome === "not_recommended" ? server.whyNotOptimized : server.whyOptimized;
  return unique([
    ...outcomeReasons,
    ...server.blockers,
    ...server.assessmentNotes
  ]).filter(Boolean);
}

function topDriverSummary(server: ServerResultsCard): string {
  const driver = server.topDatabaseDrivers[0];
  if (!driver) return "Server-level";
  return `${driver.databaseName}${driver.drivers === "none" ? "" : ` (${driver.drivers})`}`;
}
function assessmentNotesPanel(server: ServerResultsCard): string {
  return `
    <section class="assessment-note-panel" aria-label="Assessment notes">
      <h3>Assessment Notes</h3>
      <p>These items limit a full assessment or required fallback handling during analysis.</p>
      <ul>${server.assessmentNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    </section>
  `;
}

function issuePanel(server: ServerResultsCard): string {
  const issues = unique([...server.blockers, ...server.failedChecks]);
  if (issues.length === 0) return "";
  const title = server.outcome === "not_recommended" ? "Reasons to Stay As Is" : "Items to Review";
  return `
    <section class="detail-section issue-panel critical" aria-label="${escapeAttribute(title)}">
      <h3>${escapeHtml(title)}</h3>
      <ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
    </section>
  `;
}

function serverDetailDisclosure(server: ServerResultsCard): string {
  return `
    <details class="multi-server-details">
      <summary>Show server evidence, blockers, gates, and candidate history</summary>
      ${server.assessmentNotes.length > 0 ? assessmentNotesPanel(server) : ""}
      ${issuePanel(server)}
      ${server.resourceGates.length > 0 ? resourceGateMatrix(server) : ""}
      ${fullConfigurationComparison(server)}
      ${moreDetailsContent(server)}
    </details>
  `;
}

function moreDetails(server: ServerResultsCard): string {
  return `
    <details class="more-details">
      <summary>Show details and evidence</summary>
      ${server.assessmentNotes.length > 0 ? assessmentNotesPanel(server) : ""}
      ${issuePanel(server)}
      ${server.resourceGates.length > 0 ? resourceGateMatrix(server) : ""}
      ${fullConfigurationComparison(server)}
      ${moreDetailsContent(server)}
    </details>
  `;
}

function fullConfigurationComparison(server: ServerResultsCard): string {
  return `
    <section class="detail-section configuration-details" aria-label="Configuration details">
      <h3>Configuration Details</h3>
      <div class="comparison two-column">
        <div>
          <h4>Current</h4>
          ${definitionList([
            ["Instance", server.current.instanceClass],
            ["Edition", server.current.sqlServerEdition],
            ["Version", server.current.sqlServerVersion],
            ["License", server.current.licenseModel],
            ["Multi-AZ", server.current.multiAz],
            ["SQL-visible vCPU", server.currentVisibleVcpu],
            ["CPU P95", server.cpuP95Pct],
            [`CPU samples >=${server.highCpuThresholdPct}%`, server.highCpuSamplePct],
            [`Longest >=${server.highCpuThresholdPct}% streak`, `${server.longestHighCpuStreakMinutes} min`]
          ])}
        </div>
        <div>
          <h4>${escapeHtml(server.optimizedTitle)}</h4>
          ${definitionList([
            ["Instance", server.optimized.instanceClass],
            ["Edition", server.optimized.sqlServerEdition],
            ["Version", server.optimized.sqlServerVersion],
            ["License", server.optimized.licenseModel],
            ["Multi-AZ", server.optimized.multiAz],
            ["SQL-visible vCPU", server.candidateVisibleVcpu],
            ["CPU configuration", server.candidateCpuConfiguration]
          ])}
        </div>
      </div>
    </section>
  `;
}

function moreDetailsContent(server: ServerResultsCard): string {
  return `
      <section class="detail-section cpu-evidence">
        <h3>CPU Projection</h3>
        ${definitionList([
          ["Projected SQL CPU P95", server.projectedSqlCpuP95Pct],
          ["Projected SQL CPU P99", server.projectedSqlCpuP99Pct],
          ["Projected total CPU P99", server.projectedTotalCpuP99Pct],
          ["Observed Other CPU P95", server.observedOtherCpuP95Pct],
          ["Observed Other CPU P99", server.observedOtherCpuP99Pct],
          ["Projection confidence", server.cpuProjectionConfidence],
          ["Projection basis", server.cpuProjectionBasis],
          ["Samples above 90%", server.cpuExcursions]
        ])}
      </section>

      <section class="detail-section evidence-window">
        <h3>Evidence Window</h3>
        ${definitionList([
          ["Duration", server.evidenceWindow.duration],
          ["Classification", server.evidenceWindow.classification],
          ["Continuity", server.evidenceWindow.continuity],
          ["Confidence", server.evidenceWindow.confidence],
          ["Reason", server.evidenceWindow.reason],
          ["Customer confirmation", server.evidenceWindow.representativeness]
        ])}
      </section>

      ${server.editionAssessment.status !== "not applicable" ? `
      <section class="detail-section edition-assessment">
        <h3>Enterprise to Standard</h3>
        ${definitionList([
          ["Status", server.editionAssessment.status],
          ["Verdict", server.editionAssessment.verdict],
          ["Migration path", server.editionAssessment.migrationPath]
        ])}
        ${server.editionAssessment.blockers.length > 0
          ? listSection("Edition Items to Review", server.editionAssessment.blockers)
          : ""}
      </section>` : ""}

      ${server.memoryAssessment.length > 0 ? listSection("Memory Assessment", server.memoryAssessment) : ""}
      ${server.ioAssessment.length > 0 ? listSection("Instance IOPS and Throughput", server.ioAssessment) : ""}
      ${server.tempdbAssessment.length > 0 ? listSection("tempdb Placement and Capacity", server.tempdbAssessment) : ""}
      ${server.limitingResources.length > 0 ? listSection("Resource Gates and Limiting Resources", server.limitingResources) : ""}
      ${candidateHistoryDetails(server)}
      ${server.whyOptimized.length > 0 ? listSection("Why Optimized", server.whyOptimized) : ""}
      ${server.whyNotOptimized.length > 0 ? listSection("Why Stay As Is", server.whyNotOptimized) : ""}
      ${server.topDatabaseDrivers.length > 0 ? databaseTable(server) : ""}
      ${server.supportingEvidence.length > 0 ? supportingEvidenceDetails(server.supportingEvidence) : ""}
      ${server.actionPlan.length > 0 ? listSection("Action Plan", server.actionPlan) : ""}
  `;
}

function supportingEvidenceDetails(items: readonly string[]): string {
  return `
    <details class="supporting-evidence">
      <summary>Show supporting evidence</summary>
      <section class="detail-section">
        <h3>Supporting Evidence</h3>
        <p class="muted">Supporting evidence is retained for analyst review; it is not the recommendation.</p>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    </details>
  `;
}

function resourceGateMatrix(server: ServerResultsCard): string {
  return `
    <section class="detail-section resource-gate-matrix" aria-label="Workload fit checks">
      <h3>Workload Fit Checks</h3>
      <div class="gate-grid">
        ${server.resourceGates.map((gate) => `
          <article class="gate-card ${domId(gate.status)}">
            <div class="gate-card-top">
              <strong>${escapeHtml(gate.dimension)}</strong>
              <span>${escapeHtml(gate.statusLabel)}</span>
            </div>
            ${gate.details.length > 0
              ? definitionList(gate.details.map((detail) => [detail.label, detail.value]))
              : ""}
            <p>${escapeHtml(gate.reason)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function candidateHistoryDetails(server: ServerResultsCard): string {
  if (server.candidateSummary.length === 0 && server.candidateEvaluations.length === 0) return "";
  return `
    <details class="candidate-history-details">
      <summary>Show candidate summary and evaluation history</summary>
      ${server.candidateSummary.length > 0 ? candidateSummary(server) : ""}
      ${server.candidateEvaluations.length > 0 ? listSection("Candidate Evaluation History", server.candidateEvaluations) : ""}
    </details>
  `;
}

function candidateSummary(server: ServerResultsCard): string {
  return `
    <section class="detail-section candidate-summary" aria-label="Candidate summary">
      <h3>Candidate Summary</h3>
      <div class="candidate-grid">
        ${server.candidateSummary.map((candidate) => `
          <article class="candidate-card ${escapeAttribute(candidate.state)}">
            <div class="candidate-card-top">
              <strong>${escapeHtml(candidate.instanceClass)}</strong>
              <span>${escapeHtml(candidate.state)}</span>
            </div>
            ${definitionList([
              ["Result", candidate.decision],
              ["SQL-visible vCPU", candidate.visibleVcpu],
              ["CPU configuration", candidate.cpuConfiguration],
              ["Failed gates", candidate.failedGates]
            ])}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function artifactTable(title: string, artifacts: ServerResultsCard["assessmentArtifacts"]): string {
  return `
    <section class="table-wrap artifact-table" aria-label="${escapeAttribute(title)}">
      <h3>${escapeHtml(title)}</h3>
      <table>
        <thead>
          <tr>
            <th>Artifact</th>
            <th>Format</th>
            <th>Scope</th>
            <th>Includes</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${artifacts.map((artifact) => `
            <tr>
              <td>${escapeHtml(artifact.label)}</td>
              <td>${escapeHtml(artifact.format)}</td>
              <td>${escapeHtml(artifact.scope)}</td>
              <td>${escapeHtml(artifact.includedSections)}</td>
              <td>${escapeHtml(artifact.notes)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function databaseTable(server: ServerResultsCard): string {
  return `
    <section class="table-wrap" aria-label="Top database drivers">
      <h3>Top Database Drivers</h3>
      <table>
        <thead>
          <tr>
            <th>Database</th>
            <th>Drivers</th>
            <th>IOPS P95</th>
            <th>Throughput P95</th>
            <th>Size GB</th>
            <th>tempdb Share</th>
          </tr>
        </thead>
        <tbody>
          ${server.topDatabaseDrivers.map((driver) => `
            <tr>
              <td>${escapeHtml(driver.databaseName)}</td>
              <td>${escapeHtml(driver.drivers)}</td>
              <td>${escapeHtml(driver.iopsP95)}</td>
              <td>${escapeHtml(driver.throughputP95Mbps)}</td>
              <td>${escapeHtml(driver.sizeGb)}</td>
              <td>${escapeHtml(driver.tempdbSharePct)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17202a;
      --muted: #617080;
      --line: #d7dee8;
      --line-strong: #b8c3d1;
      --panel: #ffffff;
      --panel-soft: #f8fafc;
      --bg: #eef6fb;
      --accent: #0f9f8f;
      --accent-strong: #08786d;
      --info: #2563eb;
      --sky: #0ea5e9;
      --violet: #7c3aed;
      --gold: #d97706;
      --warn: #b45309;
      --danger: #b42318;
      --shadow: 0 20px 55px rgba(31, 42, 55, 0.11);
      --colorwash: linear-gradient(135deg, rgba(15, 159, 143, 0.18), rgba(37, 99, 235, 0.12) 45%, rgba(217, 119, 6, 0.14));
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, Helvetica, sans-serif;
      background:
        radial-gradient(circle at 15% 8%, rgba(14, 165, 233, 0.18), transparent 32%),
        radial-gradient(circle at 88% 18%, rgba(124, 58, 237, 0.14), transparent 30%),
        linear-gradient(180deg, #fbfdff 0, var(--bg) 420px),
        var(--bg);
      color: var(--ink);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0 0 auto;
      height: 4px;
      background: linear-gradient(90deg, var(--accent), var(--info), var(--violet), var(--gold));
      z-index: 1;
    }
    .site-header {
      position: sticky;
      top: 4px;
      z-index: 2;
      background:
        linear-gradient(90deg, rgba(255, 255, 255, 0.96), rgba(240, 249, 255, 0.94) 54%, rgba(255, 247, 237, 0.9)),
        rgba(255, 255, 255, 0.94);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(12px);
    }
    .nav-shell {
      width: min(1200px, calc(100vw - 32px));
      min-height: 72px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
      text-decoration: none;
      font-weight: 900;
      white-space: nowrap;
    }
    .brand-mark {
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--accent), var(--info) 56%, var(--violet));
      color: #ffffff;
      font-size: 13px;
      letter-spacing: 0;
      box-shadow: 0 12px 24px rgba(15, 159, 143, 0.24);
    }
    .site-nav {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      flex-wrap: wrap;
    }
    .site-nav a, .site-nav summary {
      color: var(--ink);
      text-decoration: none;
      font-size: 14px;
      font-weight: 800;
      border-radius: 8px;
      padding: 10px 11px;
      cursor: pointer;
      list-style: none;
    }
    .site-nav summary::-webkit-details-marker { display: none; }
    .site-nav a:hover, .site-nav details[open] summary, .site-nav summary:hover {
      background: var(--panel-soft);
    }
    .nav-dropdown {
      position: relative;
    }
    .dropdown-panel {
      position: absolute;
      right: 0;
      top: calc(100% + 10px);
      width: min(360px, calc(100vw - 32px));
      display: grid;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(240, 249, 255, 0.94)),
        #ffffff;
      padding: 10px;
      box-shadow: var(--shadow);
    }
    .dropdown-panel a {
      display: block;
      padding: 12px;
    }
    .dropdown-panel strong {
      display: block;
      margin-bottom: 4px;
      font-size: 14px;
    }
    .dropdown-panel span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.35;
    }
    .nav-login {
      border: 1px solid var(--line-strong);
      background: linear-gradient(135deg, #ffffff, rgba(240, 253, 250, 0.95));
    }
    .nav-cta {
      background: linear-gradient(135deg, var(--accent), var(--info));
      color: #ffffff !important;
      box-shadow: 0 10px 24px rgba(37, 99, 235, 0.18);
    }
    .nav-cta:hover { background: var(--accent-strong) !important; }
    .shell { width: min(1200px, calc(100vw - 32px)); margin: 0 auto; padding: 36px 0 56px; }
    .page-header, .offering-hero, .live-hero, .guide-hero {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
      margin-bottom: 22px;
    }
    .offering-hero, .live-hero, .guide-hero {
      align-items: stretch;
      padding: 30px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.72);
      box-shadow: var(--shadow);
    }
    .live-hero {
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(237, 246, 255, 0.82)),
        var(--panel);
    }
    .guide-hero {
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(236, 253, 245, 0.76) 38%, rgba(239, 246, 255, 0.9) 70%, rgba(255, 247, 237, 0.76)),
        var(--panel);
      position: relative;
      overflow: hidden;
    }
    .guide-hero::after {
      content: "";
      position: absolute;
      inset: auto 30px 0 30px;
      height: 4px;
      border-radius: 999px 999px 0 0;
      background: linear-gradient(90deg, var(--accent), var(--sky), var(--violet), var(--gold));
      opacity: 0.82;
    }
    .page-header h1, .offering-hero h1, .live-hero h1, .guide-hero h1 { margin: 0 0 8px; font-size: 44px; line-height: 1.02; letter-spacing: 0; max-width: 820px; }
    .page-header p, .offering-hero p, .live-hero p, .guide-hero p { margin: 0; color: var(--muted); max-width: 790px; font-size: 17px; line-height: 1.55; }
    .headline { min-width: 0; }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
    .value-card {
      flex: 0 0 min(390px, 40%);
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 10px;
      border: 1px solid var(--line);
      border-top: 4px solid var(--accent);
      border-radius: 8px;
      background: var(--panel);
      padding: 22px;
    }
    .value-card strong { font-size: 22px; line-height: 1.2; }
    .value-card p { font-size: 14px; }
    .value-label {
      color: var(--accent);
      font-size: 12px;
      font-weight: 850;
      text-transform: uppercase;
    }
    .guide-summary {
      flex: 0 0 min(390px, 38%);
      display: flex;
      flex-direction: column;
      gap: 14px;
      border: 1px solid var(--line);
      border-top: 4px solid var(--sky);
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(240, 253, 250, 0.88)),
        #ffffff;
      padding: 22px;
      box-shadow: 0 18px 44px rgba(31, 42, 55, 0.1);
    }
    .guide-summary strong { font-size: 22px; line-height: 1.18; }
    .guide-summary dl { grid-template-columns: minmax(80px, 34%) 1fr; }
    .article-layout {
      display: grid;
      grid-template-columns: minmax(190px, 240px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
      margin-bottom: 16px;
    }
    .article-nav {
      position: sticky;
      top: 18px;
      display: grid;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.96);
      padding: 12px;
    }
    .article-nav a {
      color: var(--ink);
      text-decoration: none;
      font-size: 13px;
      font-weight: 800;
      border-radius: 6px;
      padding: 9px 10px;
    }
    .article-nav a:hover { background: var(--panel-soft); }
    .article-body { display: grid; gap: 16px; }
    .article-section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.96);
      padding: 24px;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset;
    }
    .article-section h2 {
      margin: 0 0 12px;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .article-section > p:not(.section-kicker) {
      margin: 0 0 16px;
      color: var(--muted);
      line-height: 1.65;
      font-size: 16px;
    }
    .takeaway-grid, .driver-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .takeaway-card, .driver-card, .explain-item, .faq-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
      padding: 16px;
    }
    .takeaway-card {
      display: grid;
      grid-template-columns: 36px 1fr;
      gap: 12px;
      align-items: start;
    }
    .takeaway-card span {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--accent);
      color: #ffffff;
      font-weight: 850;
    }
    .takeaway-card p, .driver-card p, .explain-item p, .faq-item p {
      margin: 0;
      color: var(--muted);
      line-height: 1.52;
    }
    .explain-list {
      display: grid;
      gap: 12px;
    }
    .explain-item strong, .driver-card strong, .faq-item strong {
      display: block;
      margin-bottom: 7px;
      line-height: 1.25;
    }
    .driver-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .driver-card { background: #ffffff; }
    .strategy-timeline {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .faq-section { display: grid; gap: 12px; }
    .live-board {
      flex: 0 0 min(440px, 42%);
      display: flex;
      flex-direction: column;
      gap: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #111827;
      color: #f8fafc;
      padding: 22px;
      box-shadow: 0 24px 60px rgba(17, 24, 39, 0.2);
    }
    .board-topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: #cbd5e1;
      font-size: 13px;
      font-weight: 750;
    }
    .board-topline strong { color: #ffffff; }
    .board-meter {
      height: 12px;
      border-radius: 999px;
      background: #334155;
      overflow: hidden;
    }
    .board-meter span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #14b8a6, #60a5fa);
      animation: meterPulse 2.8s ease-in-out infinite;
    }
    @keyframes meterPulse {
      0%, 100% { opacity: 0.82; }
      50% { opacity: 1; }
    }
    .board-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .board-metric {
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.78);
      padding: 12px;
    }
    .board-metric span {
      display: block;
      color: #94a3b8;
      font-size: 12px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .board-metric strong {
      display: block;
      font-size: 15px;
      line-height: 1.2;
    }
    .signal-stack {
      display: grid;
      gap: 8px;
    }
    .signal-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
      color: #dbeafe;
      font-size: 13px;
    }
    .signal-row span:last-child {
      border-radius: 999px;
      padding: 4px 8px;
      color: #082f49;
      background: #bae6fd;
      font-weight: 850;
      text-transform: uppercase;
      font-size: 10px;
    }
    .signal-row.review span:last-child {
      color: #451a03;
      background: #fed7aa;
    }
    .eyebrow, .section-kicker {
      margin: 0 0 8px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .status-stack {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .status-stack span {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.82);
      border-radius: 999px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      padding: 7px 10px;
      white-space: nowrap;
    }
    .panel {
      background: rgba(255, 255, 255, 0.96);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset;
    }
    .business-grid, .outcome-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }
    .outcome-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .feature-panel {
      min-height: 190px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 16px;
    }
    .feature-panel h2 { margin-bottom: 0; }
    .feature-panel p { margin: 0; color: var(--muted); line-height: 1.55; }
    .live-cards .feature-panel {
      position: relative;
      overflow: hidden;
    }
    .live-cards .feature-panel::after {
      content: "";
      position: absolute;
      inset: auto 20px 18px 20px;
      height: 3px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent), var(--info), #d97706);
      opacity: 0.75;
    }
    .offering-services {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) auto;
      gap: 18px;
      align-items: center;
      border-top: 4px solid var(--accent);
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(236, 253, 245, 0.78) 52%, rgba(255, 247, 237, 0.72)),
        #ffffff;
    }
    .offering-services h2 { margin: 0 0 8px; }
    .offering-services p { margin: 0; }
    .service-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .service-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }
    .service-card {
      min-height: 250px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      border-top: 4px solid var(--accent);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(236, 253, 245, 0.62)),
        #ffffff;
      box-shadow: var(--shadow);
    }
    .service-card:nth-child(2) {
      border-top-color: var(--info);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(239, 246, 255, 0.72)),
        #ffffff;
    }
    .service-card h2 { margin: 0; }
    .service-card p.muted { margin: 0; line-height: 1.55; }
    .persona-panel {
      display: grid;
      grid-template-columns: minmax(260px, 0.8fr) minmax(0, 1.2fr);
      gap: 18px;
      align-items: stretch;
    }
    .persona-copy p { line-height: 1.55; }
    .persona-console {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
      padding: 16px;
    }
    .persona-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }
    .persona-tab {
      box-shadow: none;
      background: #ffffff;
      color: var(--ink);
      border: 1px solid var(--line-strong);
      margin: 0;
      padding: 9px 12px;
    }
    .persona-tab.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #ffffff;
    }
    .persona-output {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      padding: 18px;
      min-height: 170px;
    }
    .persona-output span {
      display: block;
      color: var(--accent);
      font-size: 12px;
      font-weight: 850;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .persona-output strong {
      display: block;
      font-size: 24px;
      line-height: 1.18;
      margin-bottom: 10px;
    }
    .persona-output p {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
    }
    .process-panel {
      display: grid;
      grid-template-columns: minmax(240px, 0.75fr) minmax(0, 1.25fr);
      gap: 18px;
      align-items: start;
    }
    .process-steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .process-steps.three-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .process-step {
      border: 1px solid var(--line);
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.92)),
        var(--panel-soft);
      padding: 14px;
    }
    .step-number {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), var(--info));
      color: #fff;
      font-weight: 850;
      margin-bottom: 12px;
    }
    .process-step strong { display: block; margin-bottom: 6px; }
    .process-step p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .proof-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .proof-strip span {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      padding: 13px;
      color: var(--ink);
      font-size: 13px;
      font-weight: 850;
      text-align: center;
    }
    .proof-strip span:nth-child(1) { background: linear-gradient(180deg, #ffffff, rgba(236, 253, 245, 0.86)); border-color: rgba(15, 159, 143, 0.28); }
    .proof-strip span:nth-child(2) { background: linear-gradient(180deg, #ffffff, rgba(239, 246, 255, 0.9)); border-color: rgba(37, 99, 235, 0.26); }
    .proof-strip span:nth-child(3) { background: linear-gradient(180deg, #ffffff, rgba(245, 243, 255, 0.86)); border-color: rgba(124, 58, 237, 0.24); }
    .proof-strip span:nth-child(4) { background: linear-gradient(180deg, #ffffff, rgba(255, 247, 237, 0.88)); border-color: rgba(217, 119, 6, 0.24); }
    .workspace-grid {
      display: grid;
      grid-template-columns: minmax(280px, 0.85fr) minmax(360px, 1.15fr);
      gap: 16px;
      align-items: stretch;
      margin-bottom: 16px;
    }
    .action-panel {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
      min-height: 260px;
      box-shadow: var(--shadow);
    }
    .download-panel {
      border-top: 4px solid var(--accent);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(236, 253, 245, 0.76)),
        #ffffff;
    }
    .upload-panel {
      border-top: 4px solid var(--info);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(239, 246, 255, 0.78)),
        #ffffff;
    }
    .grid, .summary-grid, .comparison { display: grid; gap: 16px; }
    .two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .compact-grid .panel { margin-bottom: 0; }
    .summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .comparison { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .comparison.two-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 12px 28px rgba(31, 42, 55, 0.07);
    }
    .metric span { color: var(--muted); font-size: 13px; font-weight: 750; }
    .metric strong { display: block; font-size: 32px; line-height: 1; margin-top: 8px; }
    .fleet-overview {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      margin-bottom: 16px;
      padding: 14px 16px;
    }
    .fleet-overview > summary,
    .fleet-list-header {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: start;
    }
    .fleet-overview > summary {
      cursor: pointer;
      font-weight: 850;
      list-style-position: inside;
    }
    .fleet-overview[open] > summary {
      margin-bottom: 14px;
    }
    .fleet-list-header {
      border-bottom: 1px solid var(--line);
      margin-bottom: 12px;
      padding-bottom: 12px;
    }
    .fleet-list-header h2 {
      margin: 0;
      font-size: 22px;
    }
    .fleet-overview > summary strong,
    .fleet-list-header > span {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel-soft);
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
      padding: 7px 10px;
      white-space: nowrap;
    }
    .fleet-server-rows {
      border-top: 4px solid var(--info);
    }
    .fleet-server-row {
      display: grid;
      grid-template-columns: minmax(125px, 0.85fr) minmax(180px, 1.5fr) minmax(145px, 1fr) minmax(78px, 0.55fr) minmax(120px, 0.95fr) minmax(180px, 1.55fr) minmax(72px, 82px);
      gap: 12px;
      align-items: center;
    }
    .fleet-server-heading {
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .fleet-server-row-wrap {
      border: 1px solid var(--line);
      border-left: 4px solid var(--line-strong);
      border-radius: 8px;
      background: #fff;
      display: block;
      margin-top: 8px;
      overflow: hidden;
    }
    .fleet-server-row-wrap.recommended {
      border-left-color: var(--accent);
    }
    .fleet-server-row-wrap.aggressive_optimization {
      border-left-color: var(--warn);
    }
    .fleet-server-row-wrap.not_recommended {
      border-left-color: var(--danger);
    }
    .fleet-server-row-wrap > summary {
      cursor: pointer;
      list-style: none;
      padding: 12px 14px;
    }
    .fleet-server-row-wrap > summary::-webkit-details-marker {
      display: none;
    }
    .fleet-server-row-wrap > summary strong {
      overflow-wrap: anywhere;
    }
    .fleet-row-outcome {
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel-soft);
      color: var(--ink);
      font-size: 12px;
      font-weight: 850;
      padding: 7px 10px;
      width: fit-content;
    }
    .fleet-server-row-wrap.not_recommended .fleet-row-outcome {
      color: var(--danger);
      background: #fff5f3;
      border-color: rgba(180, 35, 24, 0.38);
    }
    .fleet-row-reason {
      color: var(--muted);
      line-height: 1.35;
    }
    .fleet-row-review {
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      color: var(--ink);
      font-size: 12px;
      font-weight: 850;
      justify-self: stretch;
      min-width: 64px;
      padding: 7px 10px;
      text-align: center;
      white-space: nowrap;
    }
    .fleet-row-detail-body {
      border-top: 1px solid var(--line);
      padding: 0 14px 14px;
    }
    .fleet-outcome-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .fleet-outcome-card {
      border: 1px solid var(--line);
      border-left: 4px solid var(--line-strong);
      border-radius: 8px;
      background: #ffffff;
      padding: 14px;
    }
    .fleet-outcome-card.recommended {
      border-left-color: var(--accent);
    }
    .fleet-outcome-card.aggressive_optimization {
      border-left-color: var(--warn);
    }
    .fleet-outcome-card.not_recommended {
      border-left-color: var(--danger);
    }
    .fleet-outcome-card-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: start;
      margin-bottom: 10px;
    }
    .fleet-outcome-card-top strong {
      font-size: 16px;
      line-height: 1.2;
    }
    .fleet-outcome-card-top span {
      display: inline-grid;
      place-items: center;
      min-width: 30px;
      height: 30px;
      border-radius: 999px;
      background: var(--panel-soft);
      border: 1px solid var(--line);
      font-weight: 850;
    }
    .fleet-outcome-card p {
      color: var(--muted);
      line-height: 1.45;
      margin: 0 0 10px;
    }
    .fleet-outcome-card ul {
      padding-left: 18px;
    }
    .fleet-outcome-card li {
      overflow-wrap: anywhere;
      font-weight: 650;
    }
    .server-card {
      position: relative;
      overflow: hidden;
    }
    .server-card::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 4px;
      background: linear-gradient(135deg, var(--accent), var(--info));
    }
    .server-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: start;
      border-bottom: 1px solid var(--line);
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .server-header h2, .panel h2, .panel h3 { margin: 0 0 10px; letter-spacing: 0; }
    .server-header h2 { font-size: 24px; line-height: 1.16; overflow-wrap: anywhere; }
    .decision-summary {
      color: var(--muted);
      line-height: 1.5;
      margin: 4px 0 0;
      max-width: 860px;
    }
    .panel h2 { font-size: 22px; }
    .panel h3 { font-size: 15px; }
    .compare { border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; white-space: nowrap; color: var(--muted); }
    .not_recommended::before { background: var(--danger); }
    .recommended::before { background: var(--accent); }
    .aggressive_optimization::before { background: var(--warn); }
    .outcome-pill {
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel-soft);
      color: var(--ink);
      font-size: 12px;
      font-weight: 850;
      padding: 7px 10px;
      white-space: nowrap;
    }
    .server-card.not_recommended .outcome-pill,
    .server-card.not_recommended .decision-panel,
    .issue-panel.critical {
      border-color: rgba(180, 35, 24, 0.38);
      background: #fff5f3;
    }
    .server-card.not_recommended .outcome-pill,
    .server-card.not_recommended .decision-panel strong,
    .issue-panel.critical h3,
    .issue-panel.critical li,
    .gate-card.blocking .gate-card-top strong,
    .gate-card.blocking .gate-card-top span,
    .candidate-card.rejected .candidate-card-top strong,
    .candidate-card.rejected .candidate-card-top span {
      color: var(--danger);
    }
    .server-card.aggressive_optimization .outcome-pill,
    .server-card.aggressive_optimization .decision-panel {
      border-color: rgba(180, 83, 9, 0.34);
      background: #fffbeb;
    }
    .assessment-board {
      display: grid;
      grid-template-columns: minmax(220px, 0.34fr) minmax(0, 0.66fr);
      gap: 14px;
      margin-bottom: 16px;
    }
    .decision-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
      padding: 16px;
      min-height: 150px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .decision-panel strong {
      display: block;
      font-size: 26px;
      line-height: 1.12;
      margin: 6px 0 8px;
    }
    .decision-panel p {
      color: var(--muted);
      font-weight: 750;
      margin: 0;
    }
    .metric-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .fit-metric, .gate-card, .candidate-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      padding: 13px;
    }
    .fit-metric span, .fit-metric small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      line-height: 1.35;
    }
    .fit-metric strong {
      display: block;
      font-size: 18px;
      line-height: 1.18;
      margin: 8px 0 6px;
      overflow-wrap: anywhere;
    }
    .assessment-note-panel {
      border: 1px solid rgba(180, 83, 9, 0.34);
      border-left: 4px solid var(--warn);
      border-radius: 8px;
      background: #fffbeb;
      padding: 14px 16px;
      margin-bottom: 16px;
    }
    .assessment-note-panel h3 {
      color: var(--warn);
      margin: 0 0 6px;
    }
    .assessment-note-panel p {
      color: var(--muted);
      margin: 0 0 8px;
      line-height: 1.45;
      font-weight: 650;
    }
    .assessment-note-panel li {
      color: #78350f;
      font-weight: 700;
      line-height: 1.45;
    }
    .gate-grid, .candidate-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .gate-card {
      border-left: 4px solid var(--line-strong);
    }
    .gate-card.within-limit, .candidate-card.selected, .candidate-card.passed {
      border-left-color: var(--accent);
    }
    .gate-card.risk {
      border-left-color: var(--warn);
    }
    .gate-card.blocking, .candidate-card.rejected {
      border-left-color: var(--danger);
      background: #fffafa;
    }
    .gate-card.not-applicable {
      border-left-color: var(--muted);
    }
    .gate-card-top, .candidate-card-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: start;
      margin-bottom: 10px;
    }
    .gate-card-top strong, .candidate-card-top strong {
      font-size: 16px;
      line-height: 1.2;
    }
    .gate-card-top span, .candidate-card-top span {
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 850;
      padding: 5px 8px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .gate-card p {
      color: var(--muted);
      line-height: 1.45;
      margin: 12px 0 0;
    }
    .gate-card dl, .candidate-card dl {
      grid-template-columns: minmax(105px, 38%) 1fr;
      gap: 7px 10px;
      font-size: 13px;
    }
    .detail-section { border-top: 1px solid var(--line); padding-top: 14px; margin-top: 14px; }
    .detail-section h3 { margin: 0 0 10px; }
    .more-details, .multi-server-details {
      border-top: 1px solid var(--line);
      margin-top: 14px;
      padding-top: 14px;
    }
    .multi-server-details {
      background: var(--panel-soft);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 13px 14px;
    }
    .more-details summary, .multi-server-details summary {
      cursor: pointer;
      color: var(--ink);
      font-weight: 850;
      list-style-position: inside;
    }
    .more-details[open] summary, .multi-server-details[open] summary {
      margin-bottom: 4px;
    }
    .candidate-history-details,
    .supporting-evidence {
      border-top: 1px solid var(--line);
      margin-top: 14px;
      padding-top: 12px;
    }
    .candidate-history-details summary,
    .supporting-evidence summary {
      cursor: pointer;
      font-weight: 850;
    }
    .supporting-evidence p {
      line-height: 1.45;
      margin: 0 0 10px;
    }
    dl {
      display: grid;
      grid-template-columns: minmax(130px, 42%) 1fr;
      gap: 9px 12px;
      margin: 0;
      align-items: start;
    }
    dt { color: var(--muted); }
    dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 5px 0; }
    .field { display: block; margin-bottom: 12px; }
    .field span { display: block; font-weight: 700; margin-bottom: 6px; }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      padding: 11px 12px;
      background: #fff;
      font: inherit;
    }
    input:focus, textarea:focus {
      outline: 3px solid rgba(37, 99, 235, 0.18);
      border-color: var(--info);
    }
    input[type="file"] { background: var(--panel-soft); }
    textarea { resize: vertical; min-height: 96px; }
    button, .button-link {
      border: 0;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      font-weight: 800;
      padding: 11px 15px;
      margin-right: 8px;
      text-decoration: none;
      display: inline-block;
      cursor: pointer;
      box-shadow: 0 10px 24px rgba(15, 118, 110, 0.18);
    }
    button:hover, .button-link:hover { background: linear-gradient(135deg, var(--accent-strong), #1d4ed8); }
    .button-link.success { background: linear-gradient(135deg, var(--accent), var(--info)); }
    .button-link.secondary {
      background: linear-gradient(135deg, #ffffff, rgba(255, 247, 237, 0.92));
      color: var(--ink);
      border: 1px solid var(--line-strong);
      box-shadow: none;
    }
    .button-link.secondary:hover { background: var(--panel-soft); }
    .muted { color: var(--muted); }
    button:disabled { background: #a9b3bd; }
    .upload-status {
      margin: 12px 0 0;
      color: var(--ink);
      font-weight: 700;
    }
    form.is-submitting {
      opacity: 0.82;
    }
    .export-row { margin-bottom: 16px; }
    .table-wrap { overflow-x: auto; margin-top: 14px; }
    table { border-collapse: collapse; width: 100%; min-width: 720px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 10px; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0; }
    @media (max-width: 900px) {
      .workspace-grid, .business-grid, .outcome-grid, .process-panel, .process-steps, .proof-strip, .persona-panel, .article-layout, .takeaway-grid, .driver-grid, .strategy-timeline, .offering-services, .service-grid, .two, .summary-grid, .comparison, .assessment-board, .metric-strip, .gate-grid, .candidate-grid, .fleet-outcome-grid, .snapshot-grid, .fleet-server-row { grid-template-columns: 1fr; }
      .service-actions { justify-content: flex-start; }
      .article-nav { position: static; }
      .page-header, .offering-hero, .live-hero, .guide-hero { align-items: start; flex-direction: column; }
      .value-card { flex-basis: auto; width: 100%; }
      .live-board { flex-basis: auto; width: 100%; }
      .guide-summary { flex-basis: auto; width: 100%; }
      .status-stack { justify-content: flex-start; }
      .action-panel { min-height: 0; }
      .nav-shell { align-items: flex-start; flex-direction: column; padding: 14px 0; }
      .site-nav { justify-content: flex-start; }
      .dropdown-panel { left: 0; right: auto; }
    }
    @media (max-width: 560px) {
      .shell { width: min(100vw - 20px, 1200px); padding-top: 28px; }
      .page-header h1 { font-size: 28px; }
      .offering-hero, .live-hero, .guide-hero, .article-section { padding: 20px; }
      .offering-hero h1, .live-hero h1, .guide-hero h1 { font-size: 30px; }
      .live-hero p { font-size: 16px; }
      .article-section h2 { font-size: 24px; }
      .board-grid { grid-template-columns: 1fr; }
      .server-header { display: block; }
      .fleet-overview > summary, .fleet-list-header { display: block; }
      .fleet-overview > summary strong, .fleet-list-header > span { display: inline-block; margin-top: 10px; }
      .outcome-pill, .compare { display: inline-block; margin-top: 10px; }
      dl { grid-template-columns: 1fr; gap: 4px; }
      dd { margin-bottom: 8px; }
      button, .button-link { width: 100%; text-align: center; margin-right: 0; }
      .export-row { display: grid; gap: 8px; }
    }
  </style>
</head>
<body>${siteHeader()}${body}
  <script>
    document.querySelectorAll("[data-upload-form]").forEach((form) => {
      form.addEventListener("submit", () => {
        const button = form.querySelector("button[type='submit']");
        const status = form.querySelector("[data-upload-status]");
        const files = form.querySelector("input[type='file']")?.files?.length ?? 0;
        form.classList.add("is-submitting");
        if (button) {
          button.disabled = true;
          button.textContent = files > 1 ? "Analyzing uploads..." : "Analyzing upload...";
        }
        if (status) {
          status.hidden = false;
          status.textContent = files > 1
            ? "Uploading and analyzing collector evidence. Multi-server packages can take a short moment."
            : "Uploading and analyzing collector evidence.";
        }
      });
    });
  </script>
</body>
</html>`;
}

function siteHeader(): string {
  return `
    <header class="site-header">
      <div class="nav-shell">
        <a class="brand" href="/cost" aria-label="RDS Cost Optimization home">
          <span class="brand-mark">RDS</span>
          <span>Cost Optimization</span>
        </a>
        <nav class="site-nav" aria-label="Primary navigation">
          <details class="nav-dropdown">
            <summary>Solutions</summary>
            <div class="dropdown-panel">
              <a href="/cost/services"><strong>Offering Services</strong><span>Start assessment or download the collector.</span></a>
              <a href="/cost/assessment"><strong>Workload Assessment</strong><span>Upload collector evidence and generate the decision.</span></a>
              <a href="/cost/collector" download="RDSCostOptimizationCollector.zip"><strong>Collector Package</strong><span>Gather SQL Server workload evidence.</span></a>
            </div>
          </details>
          <details class="nav-dropdown">
            <summary>Resources</summary>
            <div class="dropdown-panel">
              <a href="/cost/resources"><strong>Optimization Guide</strong><span>Business context, evidence requirements, and guardrails.</span></a>
              <a href="/cost/assessment"><strong>Assessment Workspace</strong><span>Run the upload workflow when evidence is ready.</span></a>
            </div>
          </details>
          <a href="/cost/about">About Us</a>
          <a class="nav-login" href="/cost/login">Login</a>
          <a class="nav-cta" href="/cost/services">Offering Services</a>
        </nav>
      </div>
    </header>
  `;
}

function metricTile(label: string, value: number): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function boardMetric(label: string, value: string): string {
  return `
    <div class="board-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function signalRow(label: string, status: "pass" | "review"): string {
  return `
    <div class="signal-row ${escapeHtml(status)}">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(status)}</span>
    </div>
  `;
}

function featurePanel(title: string, body: string): string {
  return `
    <section class="panel feature-panel">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
    </section>
  `;
}

function takeawayCard(number: string, body: string): string {
  return `
    <div class="takeaway-card">
      <span>${escapeHtml(number)}</span>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function explainItem(title: string, body: string): string {
  return `
    <div class="explain-item">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function driverCard(title: string, body: string): string {
  return `
    <div class="driver-card">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function faqItem(question: string, answer: string): string {
  return `
    <div class="faq-item">
      <strong>${escapeHtml(question)}</strong>
      <p>${escapeHtml(answer)}</p>
    </div>
  `;
}

function processStep(number: string, title: string, body: string): string {
  return `
    <div class="process-step">
      <span class="step-number">${escapeHtml(number)}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function listPanel(title: string, items: readonly string[]): string {
  return `
    <section class="panel">
      <h3>${escapeHtml(title)}</h3>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function listSection(title: string, items: readonly string[]): string {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function definitionList(items: Array<[string, string]>): string {
  return `<dl>${items.map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function domId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}






