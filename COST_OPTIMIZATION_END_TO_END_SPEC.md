# SSAT Cost Optimization Engine — Complete Product Specification

**Version:** 1.0.0  
**Date:** 2026-07-13  
**Status:** DRAFT — Implementation Ready  
**Scope:** End-to-end cost optimization for SQL Server → AWS RDS migrations

---

## 1. USER JOURNEY

### Step-by-Step Flow: Upload to Savings Report

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        USER JOURNEY TIMELINE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [1] COLLECT        [2] UPLOAD       [3] PROCESS      [4] ANALYZE       │
│  Customer runs      User uploads     Server parses    Engine runs        │
│  SSATcollector      ZIP via web UI   CSV files into   cost optimization  │
│  for 7+ days        or API           structured data  algorithms         │
│                                                                          │
│  [5] RECOMMEND      [6] PRESENT      [7] EXPORT       [8] ACT           │
│  Generate sized     Display report   PDF/Excel with   Customer applies   │
│  options with       with savings     detailed         changes to save    │
│  confidence         breakdown        breakdowns       money              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Detailed Step Breakdown:

**Step 1: Data Collection (Customer-Side, 7-14 days)**
- Customer installs SSATcollector.ps1 as SQL Agent job (every 60 seconds)
- Enhanced collector (v2) adds: per-file IO stats, wait stats, tempdb usage, database sizes
- Minimum collection period: 7 days (captures weekly patterns)
- Recommended: 14 days (captures bi-weekly batch jobs, month-end processing)
- Output: 4 CSV files per server (CPU, CPUINFO, MEM, IO) + NEW: WAITSTATS, TEMPDB, DBSIZES

**Step 2: Upload (SA/User Action)**
- User authenticates via SSO
- Uploads ZIP containing all server CSVs
- System validates: correct file naming, minimum 7 days of data, required columns present
- Returns uploadId for tracking

**Step 3: Processing (Automatic)**
- Parse all CSVs into structured time-series data
- NEW: Preserve per-database IO breakdown (do NOT aggregate to server-level)
- NEW: Calculate read/write ratios per database
- NEW: Derive IO latency from stall times
- Calculate statistical summaries: avg, P50, P75, P90, P95, P99, MAX per metric

**Step 4: Analysis (Cost Optimization Engine)**
- Run outlier detection to identify maintenance spikes vs baseline workload
- Classify workload patterns (OLTP, reporting, ETL, mixed)
- Per-database IO decomposition → identify hot databases and tempdb overhead
- Time-of-day decomposition → identify business hours vs maintenance windows

**Step 5: Recommendation Generation**
- Instance sizing with P95-based approach (not MAX)
- Storage type selection with cost-optimal IOPS provisioning
- BYOL/BYOM opportunity identification
- RI/Savings Plan recommendations for steady-state workloads
- Generate confidence scores based on data quality and outlier prevalence

**Step 6: Presentation**
- Interactive web report with expandable sections
- Executive summary: total monthly savings, confidence level
- Per-server breakdown with drill-down to per-database analysis
- Visual: time-series charts showing where outliers were excluded

**Step 7: Export**
- PDF summary for executive stakeholders
- Excel workbook with all calculations (auditable)
- JSON API response for programmatic consumption

**Step 8: Action Plan**
- Prioritized migration order (highest savings first)
- Risk-ranked changes (safe → moderate → aggressive)
- Step-by-step AWS CLI commands for implementation

---

## 2. DATA FLOW

### Complete Pipeline: Collection → Recommendation

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW ARCHITECTURE                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  COLLECT (on-prem)          UPLOAD            PROCESS             ANALYZE     │
│  ┌─────────────────┐       ┌──────┐         ┌─────────────┐    ┌──────────┐ │
│  │ CPU samples/min │──┐    │      │         │ Parse CSVs  │    │ Outlier  │ │
│  │ MEM samples/min │──┤    │ ZIP  │────────▶│ Validate    │───▶│ Detect   │ │
│  │ IO per-DB/min   │──┤───▶│ file │         │ Time-align  │    │ Classify │ │
│  │ CPUINFO (once)  │──┤    │      │         │ Delta calc  │    │ Baseline │ │
│  │ WAIT stats/min  │──┤    └──────┘         └─────────────┘    └──────────┘ │
│  │ TEMPDB usage/min│──┤                            │                  │      │
│  │ DB sizes (once) │──┘                            ▼                  ▼      │
│  └─────────────────┘                     ┌─────────────────┐  ┌───────────┐ │
│                                          │ Per-DB IO Matrix │  │ Workload  │ │
│                                          │ Read/Write split │  │ Classify  │ │
│                                          │ Latency metrics  │  │ Engine    │ │
│                                          │ Time-series kept │  └───────────┘ │
│                                          └─────────────────┘        │        │
│                                                   │                  │        │
│                                                   ▼                  ▼        │
│  RECOMMEND                              ┌──────────────────────────────────┐ │
│  ┌────────────────────────────┐         │    COST OPTIMIZATION ENGINE       │ │
│  │ Instance Optimizer         │◀────────│  • Storage Optimizer              │ │
│  │ Storage Optimizer          │         │  • Instance Optimizer             │ │
│  │ Savings Calculator         │         │  • Outlier-adjusted metrics       │ │
│  │ Risk Assessment            │         │  • Per-DB split recommendations   │ │
│  │ Confidence Scoring         │         │  • BYOL/RI opportunity detection  │ │
│  └────────────────────────────┘         └──────────────────────────────────┘ │
│              │                                                                 │
│              ▼                                                                 │
│  ┌────────────────────────────┐                                               │
│  │ OUTPUT: Report + API       │                                               │
│  │ • Executive summary        │                                               │
│  │ • Per-server detail        │                                               │
│  │ • Per-database breakdown   │                                               │
│  │ • Savings calculator       │                                               │
│  │ • Action plan              │                                               │
│  └────────────────────────────┘                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Transformation at Each Stage:

| Stage | Input | Output | Key Transformation |
|-------|-------|--------|-------------------|
| Collection | DMV queries | Raw CSV rows (1/min) | Cumulative → delta (IO only) |
| Upload | ZIP of CSVs | Validated file set | Schema validation, date range check |
| Parse | CSV rows | Typed arrays | String → number, timestamp alignment |
| Aggregate | Per-minute samples | Statistical profiles | avg/P50/P75/P90/P95/P99/MAX |
| Per-DB Split | IO rows with DBName | Per-database IO profiles | Group by DB, calculate per-DB stats |
| Outlier Detect | Time-series arrays | Cleaned arrays + outlier list | IQR/Z-score filtering, pattern matching |
| Baseline Extract | Full time-series | Business-hours subset | Time-of-day filtering |
| Workload Classify | IO patterns per DB | Workload type labels | Pattern matching algorithm |
| Instance Size | Cleaned metrics | Instance recommendations | Decision tree + capacity matching |
| Storage Size | IOPS/throughput profiles | Storage type + provisioning | Cost optimization decision tree |
| Cost Calculate | Current config + recommendations | Savings breakdown | Price lookup + formula application |
| Risk Score | All inputs + recommendation aggressiveness | Risk level (1-5) | Multi-factor risk model |

### NEW Data Points to Preserve (Currently Discarded):

| Data Point | Current State | New State | Used For |
|-----------|--------------|-----------|----------|
| Per-DB IOPS | Aggregated away | Preserved as array | Hot-DB detection, split recommendations |
| Per-DB Read/Write | Never separated | Calculated per DB | Workload classification |
| IO Latency (stall_ms) | Not collected | NEW collection | Storage tier validation |
| tempdb % of total IO | Not tracked | Calculated | Query optimization flag |
| Time-of-day pattern | Collapsed to scalars | Preserved as hourly buckets | Business-hours sizing |
| Wait statistics | Not collected | NEW collection | Bottleneck identification |
| Database sizes | Not collected | NEW collection | Storage provisioning |

---

## 3. COST MODEL

### 3.1 Total Monthly Cost Formula

```
TOTAL_MONTHLY_COST = COMPUTE + STORAGE + IOPS + THROUGHPUT + BACKUP + TRANSFER + EXTRAS

Where:
  COMPUTE = instance_hourly_rate × 730 × multi_az_multiplier
  STORAGE = storage_gb × storage_rate_per_gb × multi_az_multiplier
  IOPS    = max(0, provisioned_iops - baseline_free_iops) × iops_rate × multi_az_multiplier
  THROUGHPUT = max(0, provisioned_mbps - baseline_free_mbps) × throughput_rate × multi_az_multiplier
  BACKUP  = max(0, total_backup_gb - free_backup_gb) × $0.095
  TRANSFER = cross_az_gb × $0.02 + internet_out_gb × tiered_rate
  EXTRAS  = proxy_cost + monitoring_cost + ipv4_cost
```

### 3.2 Compute Cost Calculation

```javascript
function calculateComputeCost(instance, edition, multiAZ, commitment) {
  // Base rates (us-east-1, July 2026)
  const BASE_RATES = {
    'db.r6i.large':    0.250,  // 2 vCPU, 16 GB
    'db.r6i.xlarge':   0.500,  // 4 vCPU, 32 GB
    'db.r6i.2xlarge':  1.000,  // 8 vCPU, 64 GB
    'db.r6i.4xlarge':  2.000,  // 16 vCPU, 128 GB
    'db.r6i.8xlarge':  4.000,  // 32 vCPU, 256 GB
    'db.r6i.12xlarge': 6.000,  // 48 vCPU, 384 GB
    'db.r6i.16xlarge': 8.000,  // 64 vCPU, 512 GB
    'db.m6i.large':    0.218,  // 2 vCPU, 8 GB
    'db.m6i.xlarge':   0.436,  // 4 vCPU, 16 GB
    'db.m6i.2xlarge':  0.872,  // 8 vCPU, 32 GB
    'db.m6i.4xlarge':  1.744,  // 16 vCPU, 64 GB
    'db.m6i.8xlarge':  3.488,  // 32 vCPU, 128 GB
  };

  // SQL Server license adder per vCPU per hour
  const LICENSE_RATES = {
    'express':    0.00,
    'web':        0.06,
    'standard':   0.30,
    'enterprise': 0.87
  };

  // RI discount multipliers
  const RI_DISCOUNTS = {
    'on-demand':           1.00,
    '1yr-no-upfront':      0.66,
    '1yr-all-upfront':     0.60,
    '3yr-partial-upfront': 0.47,
    '3yr-all-upfront':     0.42
  };

  const vCPUs = INSTANCE_VCPU_MAP[instance];
  const baseRate = BASE_RATES[instance];
  const licenseRate = LICENSE_RATES[edition] * vCPUs;
  const hourlyRate = baseRate + licenseRate;
  const multiAZMultiplier = multiAZ ? 2.0 : 1.0;
  const riDiscount = RI_DISCOUNTS[commitment];

  const monthlyCompute = hourlyRate * 730 * multiAZMultiplier * riDiscount;
  return {
    hourly: hourlyRate * multiAZMultiplier,
    monthly: monthlyCompute,
    annual: monthlyCompute * 12,
    breakdown: {
      baseCompute: baseRate * 730 * multiAZMultiplier * riDiscount,
      license: licenseRate * 730 * multiAZMultiplier * riDiscount
    }
  };
}
```

### 3.3 Storage Cost Calculation

```javascript
function calculateStorageCost(storageType, sizeGB, iops, throughputMBps, multiAZ) {
  const azMult = multiAZ ? 2.0 : 1.0;

  switch (storageType) {
    case 'gp3': {
      const baseStorage = sizeGB * 0.115 * azMult;
      const freeIOPS = 3000;
      const freeThroughput = 125; // MB/s
      const extraIOPS = Math.max(0, iops - freeIOPS) * 0.20 * azMult;
      const extraThroughput = Math.max(0, throughputMBps - freeThroughput) * 0.08 * azMult;
      return {
        total: baseStorage + extraIOPS + extraThroughput,
        breakdown: { baseStorage, extraIOPS, extraThroughput },
        type: 'gp3'
      };
    }

    case 'io1': {
      const baseStorage = sizeGB * 0.125 * azMult;
      const iopsCharge = iops * 0.10 * azMult; // ALL IOPS charged (no free baseline)
      return {
        total: baseStorage + iopsCharge,
        breakdown: { baseStorage, iopsCharge },
        type: 'io1'
      };
    }

    case 'io2': {
      const baseStorage = sizeGB * 0.125 * azMult;
      // Tiered IOPS pricing
      const tier1 = Math.min(iops, 32000) * 0.065 * azMult;
      const tier2 = Math.max(0, Math.min(iops, 64000) - 32000) * 0.046 * azMult;
      const tier3 = Math.max(0, iops - 64000) * 0.032 * azMult;
      const iopsCharge = tier1 + tier2 + tier3;
      return {
        total: baseStorage + iopsCharge,
        breakdown: { baseStorage, tier1, tier2, tier3 },
        type: 'io2'
      };
    }
  }
}
```

### 3.4 Break-Even Analysis: gp3 vs io1 vs io2

```javascript
function findOptimalStorageType(sizeGB, requiredIOPS, requiredThroughputMBps, multiAZ) {
  const gp3Cost = calculateStorageCost('gp3', sizeGB, requiredIOPS, requiredThroughputMBps, multiAZ);
  const io1Cost = calculateStorageCost('io1', sizeGB, requiredIOPS, 0, multiAZ); // io1 no separate throughput
  const io2Cost = calculateStorageCost('io2', sizeGB, requiredIOPS, 0, multiAZ);

  // Constraints check
  const gp3Valid = requiredIOPS <= 64000 && requiredThroughputMBps <= 4000;
  const io1Valid = requiredIOPS <= 64000;
  const io2Valid = requiredIOPS <= 256000;

  const options = [];
  if (gp3Valid) options.push({ type: 'gp3', cost: gp3Cost.total, detail: gp3Cost });
  if (io1Valid) options.push({ type: 'io1', cost: io1Cost.total, detail: io1Cost });
  if (io2Valid) options.push({ type: 'io2', cost: io2Cost.total, detail: io2Cost });

  // Sort by cost ascending
  options.sort((a, b) => a.cost - b.cost);

  return {
    recommended: options[0],
    alternatives: options.slice(1),
    breakEvenIOPS: calculateBreakEven(sizeGB, multiAZ)
  };
}

function calculateBreakEven(sizeGB, multiAZ) {
  // gp3 cost = sizeGB*0.115 + max(0, iops-3000)*0.20
  // io2 cost = sizeGB*0.125 + min(iops,32000)*0.065 + ...
  // Solve: gp3_cost = io2_cost for iops
  // Simplified for tier 1 only (iops < 32000):
  // sizeGB*0.115 + (iops-3000)*0.20 = sizeGB*0.125 + iops*0.065
  // 0.115*sizeGB + 0.20*iops - 600 = 0.125*sizeGB + 0.065*iops
  // 0.135*iops = 0.010*sizeGB + 600
  // iops = (0.010*sizeGB + 600) / 0.135
  const breakEven = Math.round((0.010 * sizeGB + 600) / 0.135);
  return breakEven; // IOPS where io2 becomes cheaper than gp3
}
```

### 3.5 Full Cost Comparison Matrix

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  MONTHLY COST MATRIX — 1 TB Storage, Single-AZ, SQL Server Standard            │
├───────────────────┬──────────┬──────────┬──────────┬──────────┬────────────────┤
│ Instance          │ Compute  │ gp3@3K   │ gp3@10K  │ io2@10K  │ io2@50K        │
├───────────────────┼──────────┼──────────┼──────────┼──────────┼────────────────┤
│ db.r6i.xlarge     │ $1,095   │ $118     │ $1,518   │ $775     │ $3,305         │
│ db.r6i.2xlarge    │ $2,117   │ $118     │ $1,518   │ $775     │ $3,305         │
│ db.r6i.4xlarge    │ $3,942   │ $118     │ $1,518   │ $775     │ $3,305         │
│ db.r6i.8xlarge    │ $7,592   │ $118     │ $1,518   │ $775     │ $3,305         │
├───────────────────┼──────────┼──────────┼──────────┼──────────┼────────────────┤
│ Notes:            │ LI rate  │ baseline │ +7K IOPS │ tiered   │ tier1+tier2    │
│                   │ Std ed.  │ free     │ @$0.20ea │ pricing  │ pricing        │
└───────────────────┴──────────┴──────────┴──────────┴──────────┴────────────────┘
```


---

## 4. PER-DATABASE ANALYSIS

### 4.1 Data Structure: Per-Database IO Profile

```typescript
interface PerDatabaseIOProfile {
  dbName: string;
  databaseId: number;
  
  // Aggregated metrics
  totalReadIOPS: StatisticalProfile;    // avg, p50, p75, p90, p95, p99, max
  totalWriteIOPS: StatisticalProfile;
  totalReadMBps: StatisticalProfile;
  totalWriteMBps: StatisticalProfile;
  avgReadLatencyMs: StatisticalProfile;
  avgWriteLatencyMs: StatisticalProfile;
  
  // Derived
  readWriteRatio: number;              // reads / (reads + writes), 0.0-1.0
  avgIOSizeKB: number;                 // total_bytes / total_ios
  percentOfServerIOPS: number;         // this DB's avg IOPS / server total avg IOPS
  percentOfServerThroughput: number;
  
  // Classification
  workloadType: 'OLTP' | 'REPORTING' | 'ETL' | 'MIXED' | 'IDLE';
  isHotDatabase: boolean;              // >60% of server IO
  isTempdbHeavy: boolean;             // tempdb >30% of total
  
  // Time patterns
  hourlyIOPSProfile: number[];         // 24 values: avg IOPS per hour-of-day
  peakHours: number[];                 // hours where IOPS > P75
  maintenanceWindows: TimeWindow[];    // detected maintenance periods
}

interface StatisticalProfile {
  avg: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  sampleCount: number;
}

interface TimeWindow {
  startHour: number;  // 0-23
  endHour: number;
  dayOfWeek: number[];  // 0=Sun, 6=Sat
  avgIOPSDuringWindow: number;
  classification: 'BACKUP' | 'INDEX_REBUILD' | 'CHECKDB' | 'ETL' | 'UNKNOWN';
}
```

### 4.2 Per-Database Processing Algorithm

```javascript
function processPerDatabaseIO(ioRows) {
  // ioRows: array of { Sample_ID, Database_ID, DBName, Read, Written, 
  //                     BRead, BWritten, TotalIOPs, CollectionTime }
  
  // Step 1: Group by database
  const dbGroups = groupBy(ioRows, 'DBName');
  
  // Step 2: For each database, calculate time-series metrics
  const dbProfiles = {};
  let serverTotalIOPS = 0;
  
  for (const [dbName, rows] of Object.entries(dbGroups)) {
    // Sort by CollectionTime
    rows.sort((a, b) => new Date(a.CollectionTime) - new Date(b.CollectionTime));
    
    // Calculate per-sample rates (samples are 60-second intervals)
    const readIOPSSeries = rows.map(r => r.Read / 60);
    const writeIOPSSeries = rows.map(r => r.Written / 60);
    const readMBpsSeries = rows.map(r => r.BRead / 60 / 1048576);
    const writeMBpsSeries = rows.map(r => r.BWritten / 60 / 1048576);
    
    // Statistical profiles
    const profile = {
      dbName,
      databaseId: rows[0].Database_ID,
      totalReadIOPS: calculateStats(readIOPSSeries),
      totalWriteIOPS: calculateStats(writeIOPSSeries),
      totalReadMBps: calculateStats(readMBpsSeries),
      totalWriteMBps: calculateStats(writeMBpsSeries),
      readWriteRatio: sumArray(readIOPSSeries) / 
        (sumArray(readIOPSSeries) + sumArray(writeIOPSSeries) || 1),
      avgIOSizeKB: (sumArray(rows.map(r => r.BRead + r.BWritten))) / 
        (sumArray(rows.map(r => r.Read + r.Written)) || 1) / 1024,
      hourlyIOPSProfile: calculateHourlyProfile(rows),
    };
    
    dbProfiles[dbName] = profile;
    serverTotalIOPS += profile.totalReadIOPS.avg + profile.totalWriteIOPS.avg;
  }
  
  // Step 3: Calculate relative percentages
  for (const profile of Object.values(dbProfiles)) {
    const dbAvgIOPS = profile.totalReadIOPS.avg + profile.totalWriteIOPS.avg;
    profile.percentOfServerIOPS = (dbAvgIOPS / serverTotalIOPS) * 100;
    profile.isHotDatabase = profile.percentOfServerIOPS > 60;
  }
  
  // Step 4: Classify workload type per database
  for (const profile of Object.values(dbProfiles)) {
    profile.workloadType = classifyWorkload(profile);
  }
  
  // Step 5: Detect tempdb dominance (if tempdb included in collection)
  const tempdbProfile = dbProfiles['tempdb'];
  if (tempdbProfile) {
    const tempdbPct = tempdbProfile.percentOfServerIOPS;
    for (const profile of Object.values(dbProfiles)) {
      profile.isTempdbHeavy = tempdbPct > 30;
    }
  }
  
  return dbProfiles;
}

function classifyWorkload(profile) {
  const { readWriteRatio, avgIOSizeKB, totalReadIOPS, totalWriteIOPS } = profile;
  
  // IDLE: very low IO
  if (totalReadIOPS.avg + totalWriteIOPS.avg < 5) return 'IDLE';
  
  // OLTP: small random IO, balanced or read-heavy
  if (avgIOSizeKB < 16 && readWriteRatio > 0.4) return 'OLTP';
  
  // REPORTING: large sequential reads, few writes
  if (avgIOSizeKB > 64 && readWriteRatio > 0.8) return 'REPORTING';
  
  // ETL: write-heavy, large IO sizes
  if (readWriteRatio < 0.3 && avgIOSizeKB > 32) return 'ETL';
  
  // MIXED: everything else
  return 'MIXED';
}

function calculateHourlyProfile(rows) {
  const hourBuckets = Array(24).fill(null).map(() => []);
  for (const row of rows) {
    const hour = new Date(row.CollectionTime).getHours();
    hourBuckets[hour].push((row.Read + row.Written) / 60);
  }
  return hourBuckets.map(bucket => 
    bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) / bucket.length : 0
  );
}
```

### 4.3 Split/Consolidation Decision Algorithm

```javascript
function evaluateSplitOpportunity(dbProfiles, currentInstance, currentStorageCost) {
  const recommendations = [];
  
  // Identify hot database candidates
  const hotDbs = Object.values(dbProfiles)
    .filter(p => p.percentOfServerIOPS > 40 && p.workloadType !== 'IDLE');
  
  if (hotDbs.length === 0) {
    return { action: 'NO_SPLIT', reason: 'IO evenly distributed across databases' };
  }
  
  for (const hotDb of hotDbs) {
    // Calculate what the hot DB needs standalone
    const hotDbIOPS = hotDb.totalReadIOPS.p95 + hotDb.totalWriteIOPS.p95;
    const hotDbThroughput = hotDb.totalReadMBps.p95 + hotDb.totalWriteMBps.p95;
    
    // Calculate what remains if hot DB is removed
    const remainingIOPS = Object.values(dbProfiles)
      .filter(p => p.dbName !== hotDb.dbName)
      .reduce((sum, p) => sum + p.totalReadIOPS.p95 + p.totalWriteIOPS.p95, 0);
    
    // Size two separate instances
    const hotDbInstance = sizeInstance(hotDbIOPS, hotDbThroughput, hotDb.workloadType);
    const remainingInstance = sizeInstance(remainingIOPS, 0, 'MIXED');
    
    // Calculate split cost vs current cost
    const splitCost = hotDbInstance.monthlyCost + remainingInstance.monthlyCost;
    const currentCost = currentInstance.monthlyCost;
    
    if (splitCost < currentCost * 0.85) { // >15% savings threshold
      recommendations.push({
        action: 'SPLIT',
        hotDatabase: hotDb.dbName,
        savings: currentCost - splitCost,
        savingsPercent: ((currentCost - splitCost) / currentCost) * 100,
        hotDbInstance: hotDbInstance,
        remainingInstance: remainingInstance,
        confidence: calculateSplitConfidence(hotDb, dbProfiles)
      });
    }
  }
  
  return recommendations;
}
```

### 4.4 tempdb Analysis and Recommendations

```javascript
function analyzeTempdbImpact(dbProfiles, serverTotalIOPS) {
  const tempdb = dbProfiles['tempdb'];
  if (!tempdb) {
    return { 
      available: false, 
      note: 'tempdb not in collection — add database_id=2 to collector filter' 
    };
  }
  
  const tempdbPct = tempdb.percentOfServerIOPS;
  
  return {
    available: true,
    percentOfTotal: tempdbPct,
    classification: tempdbPct > 40 ? 'CRITICAL' : tempdbPct > 20 ? 'ELEVATED' : 'NORMAL',
    iopsConsumed: tempdb.totalReadIOPS.avg + tempdb.totalWriteIOPS.avg,
    recommendation: tempdbPct > 30 
      ? {
          action: 'QUERY_OPTIMIZATION',
          reason: `tempdb consumes ${tempdbPct.toFixed(1)}% of total IOPS — indicates spill-heavy queries`,
          potentialSavings: calculateTempdbSavings(tempdb, serverTotalIOPS),
          steps: [
            'Identify queries with high tempdb spills (dm_exec_query_stats.total_spills)',
            'Increase max memory grant for heavy queries',
            'Review cardinality estimates for hash/sort operators',
            'Consider increasing instance RAM to reduce buffer pool pressure',
            'If RCSI: check for long-running transactions bloating version store'
          ]
        }
      : { action: 'NONE', reason: 'tempdb IO within normal range' }
  };
}

function calculateTempdbSavings(tempdbProfile, serverTotalIOPS) {
  // If tempdb IO could be reduced by 50% through query optimization:
  const tempdbReduction = (tempdbProfile.totalReadIOPS.avg + tempdbProfile.totalWriteIOPS.avg) * 0.5;
  const newTotalIOPS = serverTotalIOPS - tempdbReduction;
  
  // This could allow provisioning fewer IOPS on gp3
  // Each 1000 IOPS saved on gp3 Single-AZ = $200/month
  const iopsSaved = Math.floor(tempdbReduction / 1000) * 1000;
  const monthlySavings = iopsSaved * 0.20; // gp3 rate
  
  return { iopsSaved, monthlySavings, assumption: '50% tempdb IO reduction through query tuning' };
}
```

---

## 5. OUTLIER DETECTION ENGINE

### 5.1 Overview

The outlier detection engine identifies and classifies IO spikes that should NOT drive permanent provisioning decisions. This is the single most impactful improvement over the current system (which uses MAX IOPS).

### 5.2 Algorithm: Multi-Method Outlier Detection

```javascript
class OutlierDetectionEngine {
  constructor(config = {}) {
    this.iqrMultiplier = config.iqrMultiplier || 1.5;     // Standard IQR fence
    this.zScoreThreshold = config.zScoreThreshold || 3.0;  // 3 sigma
    this.minOutlierDuration = config.minOutlierDuration || 1;   // minutes
    this.maxOutlierDuration = config.maxOutlierDuration || 120; // minutes
    this.minDataPoints = config.minDataPoints || 1440;     // 24 hours minimum
  }

  /**
   * Main entry point: detect and classify outliers in a time-series
   * @param {Array} timeSeries - [{timestamp, value}, ...]
   * @param {string} metricName - 'iops' | 'throughput' | 'cpu'
   * @returns {OutlierResult}
   */
  detectOutliers(timeSeries, metricName) {
    if (timeSeries.length < this.minDataPoints) {
      return { 
        success: false, 
        error: `Insufficient data: ${timeSeries.length} points (need ${this.minDataPoints})` 
      };
    }

    // Method 1: IQR-based detection
    const iqrOutliers = this._detectIQR(timeSeries);
    
    // Method 2: Z-score detection (for normally distributed data)
    const zOutliers = this._detectZScore(timeSeries);
    
    // Method 3: Time-pattern detection (recurring spikes)
    const patternOutliers = this._detectTimePatterns(timeSeries);
    
    // Consensus: a point is an outlier if flagged by ≥2 methods
    const consensusOutliers = this._buildConsensus(
      timeSeries, iqrOutliers, zOutliers, patternOutliers
    );
    
    // Classify each outlier group by probable cause
    const classifiedOutliers = this._classifyOutliers(consensusOutliers, metricName);
    
    // Calculate cleaned metrics (outliers removed)
    const cleanedSeries = timeSeries.filter(
      (_, i) => !consensusOutliers.outlierIndices.has(i)
    );
    const cleanedStats = this._calculateStats(cleanedSeries.map(s => s.value));
    const rawStats = this._calculateStats(timeSeries.map(s => s.value));
    
    return {
      success: true,
      raw: rawStats,
      cleaned: cleanedStats,
      outliers: classifiedOutliers,
      outlierCount: consensusOutliers.outlierIndices.size,
      outlierPercent: (consensusOutliers.outlierIndices.size / timeSeries.length) * 100,
      impactAssessment: {
        maxReduction: rawStats.max - cleanedStats.max,
        maxReductionPercent: ((rawStats.max - cleanedStats.max) / rawStats.max) * 100,
        p95Reduction: rawStats.p95 - cleanedStats.p95,
        p95ReductionPercent: ((rawStats.p95 - cleanedStats.p95) / rawStats.p95) * 100,
      }
    };
  }

  _detectIQR(timeSeries) {
    const values = timeSeries.map(s => s.value).sort((a, b) => a - b);
    const q1 = values[Math.floor(values.length * 0.25)];
    const q3 = values[Math.floor(values.length * 0.75)];
    const iqr = q3 - q1;
    const upperFence = q3 + (this.iqrMultiplier * iqr);
    const lowerFence = q1 - (this.iqrMultiplier * iqr);
    
    const outlierIndices = new Set();
    timeSeries.forEach((point, i) => {
      if (point.value > upperFence || point.value < lowerFence) {
        outlierIndices.add(i);
      }
    });
    
    return { outlierIndices, upperFence, lowerFence, q1, q3, iqr };
  }

  _detectZScore(timeSeries) {
    const values = timeSeries.map(s => s.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    );
    
    const outlierIndices = new Set();
    timeSeries.forEach((point, i) => {
      const zScore = Math.abs((point.value - mean) / (stdDev || 1));
      if (zScore > this.zScoreThreshold) {
        outlierIndices.add(i);
      }
    });
    
    return { outlierIndices, mean, stdDev };
  }

  _detectTimePatterns(timeSeries) {
    // Detect recurring spikes at same time-of-day across multiple days
    const hourDayBuckets = {}; // key: "hour-dayOfWeek"
    
    timeSeries.forEach((point, i) => {
      const date = new Date(point.timestamp);
      const key = `${date.getHours()}-${date.getDay()}`;
      if (!hourDayBuckets[key]) hourDayBuckets[key] = [];
      hourDayBuckets[key].push({ index: i, value: point.value });
    });
    
    // Calculate overall P75 as "normal" threshold
    const allValues = timeSeries.map(s => s.value).sort((a, b) => a - b);
    const p75 = allValues[Math.floor(allValues.length * 0.75)];
    const p95 = allValues[Math.floor(allValues.length * 0.95)];
    
    const outlierIndices = new Set();
    const patterns = [];
    
    for (const [key, points] of Object.entries(hourDayBuckets)) {
      const bucketAvg = points.reduce((s, p) => s + p.value, 0) / points.length;
      
      // If this time slot consistently exceeds P95, it's a recurring spike
      if (bucketAvg > p95 && points.length >= 3) { // seen at least 3 times
        const [hour, day] = key.split('-').map(Number);
        patterns.push({ hour, dayOfWeek: day, avgValue: bucketAvg });
        points.forEach(p => outlierIndices.add(p.index));
      }
    }
    
    return { outlierIndices, patterns };
  }

  _buildConsensus(timeSeries, iqr, zScore, patterns) {
    const outlierIndices = new Set();
    const outlierDetails = [];
    
    timeSeries.forEach((point, i) => {
      const methods = [];
      if (iqr.outlierIndices.has(i)) methods.push('IQR');
      if (zScore.outlierIndices.has(i)) methods.push('Z-SCORE');
      if (patterns.outlierIndices.has(i)) methods.push('TIME-PATTERN');
      
      // Consensus: flagged by 2+ methods, OR flagged by time-pattern alone
      // (time-patterns are high-confidence because they repeat)
      if (methods.length >= 2 || methods.includes('TIME-PATTERN')) {
        outlierIndices.add(i);
        outlierDetails.push({
          index: i,
          timestamp: point.timestamp,
          value: point.value,
          methods,
          confidence: methods.length / 3 // 0.33, 0.67, or 1.0
        });
      }
    });
    
    return { outlierIndices, outlierDetails };
  }

  _classifyOutliers(consensus, metricName) {
    // Group consecutive outlier points into "events"
    const events = [];
    let currentEvent = null;
    
    const sortedDetails = consensus.outlierDetails.sort((a, b) => a.index - b.index);
    
    for (const detail of sortedDetails) {
      if (currentEvent && detail.index - currentEvent.endIndex <= 5) {
        // Extend current event (allow 5-minute gaps)
        currentEvent.endIndex = detail.index;
        currentEvent.points.push(detail);
        currentEvent.peakValue = Math.max(currentEvent.peakValue, detail.value);
      } else {
        // Start new event
        if (currentEvent) events.push(currentEvent);
        currentEvent = {
          startIndex: detail.index,
          endIndex: detail.index,
          startTime: detail.timestamp,
          points: [detail],
          peakValue: detail.value
        };
      }
    }
    if (currentEvent) events.push(currentEvent);
    
    // Classify each event
    return events.map(event => ({
      ...event,
      durationMinutes: event.endIndex - event.startIndex + 1,
      endTime: event.points[event.points.length - 1].timestamp,
      classification: this._classifyEvent(event, metricName),
      shouldExcludeFromSizing: true
    }));
  }

  _classifyEvent(event, metricName) {
    const duration = event.endIndex - event.startIndex + 1;
    const hour = new Date(event.startTime).getHours();
    
    // Heuristic classification based on duration, timing, and metric
    if (duration <= 5 && metricName === 'iops') {
      return { type: 'TRANSIENT_SPIKE', confidence: 0.7, 
               description: 'Brief IOPS spike — likely autogrowth or single large query' };
    }
    
    if (duration >= 30 && duration <= 120 && hour >= 0 && hour <= 6) {
      return { type: 'MAINTENANCE_WINDOW', confidence: 0.85,
               description: 'Extended off-hours activity — likely backup/CHECKDB/index rebuild' };
    }
    
    if (duration >= 10 && duration <= 60) {
      return { type: 'BATCH_JOB', confidence: 0.6,
               description: 'Medium-duration spike — likely ETL or batch processing' };
    }
    
    return { type: 'UNCLASSIFIED', confidence: 0.5,
             description: 'Spike does not match known patterns — manual review recommended' };
  }

  _calculateStats(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.floor(sorted.length * 0.50)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
      p90: sorted[Math.floor(sorted.length * 0.90)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      max: sorted[sorted.length - 1],
      min: sorted[0],
      count: values.length
    };
  }
}
```

### 5.3 Validation Rules

```javascript
const OUTLIER_VALIDATION = {
  // Maximum percentage of data that can be classified as outliers
  MAX_OUTLIER_PERCENT: 15, // If >15% are outliers, data is too noisy — use raw
  
  // Minimum data duration for reliable outlier detection
  MIN_COLLECTION_DAYS: 7,
  
  // If outlier removal changes P95 by more than this, flag for review
  MAX_P95_CHANGE_PERCENT: 40,
  
  // Minimum samples per hour-of-day bucket for pattern detection
  MIN_PATTERN_SAMPLES: 3,
  
  // If cleaned MAX is still > instance capacity, outlier detection doesn't help
  // (the baseline itself exceeds capacity)
  BASELINE_EXCEEDS_CAPACITY_FLAG: true
};

function validateOutlierResults(result) {
  const warnings = [];
  
  if (result.outlierPercent > OUTLIER_VALIDATION.MAX_OUTLIER_PERCENT) {
    warnings.push({
      level: 'HIGH',
      message: `${result.outlierPercent.toFixed(1)}% of data flagged as outliers (>${OUTLIER_VALIDATION.MAX_OUTLIER_PERCENT}%). Using raw metrics instead.`,
      action: 'USE_RAW'
    });
  }
  
  if (result.impactAssessment.p95ReductionPercent > OUTLIER_VALIDATION.MAX_P95_CHANGE_PERCENT) {
    warnings.push({
      level: 'MEDIUM',
      message: `Outlier removal changes P95 by ${result.impactAssessment.p95ReductionPercent.toFixed(1)}%. Recommend manual review.`,
      action: 'FLAG_FOR_REVIEW'
    });
  }
  
  return { valid: warnings.filter(w => w.action === 'USE_RAW').length === 0, warnings };
}
```

### 5.4 Confidence Score Calculation

```javascript
function calculateConfidenceScore(outlierResult, collectionDays, sampleCount) {
  let score = 100;
  
  // Deductions for data quality issues
  if (collectionDays < 7) score -= 30;
  else if (collectionDays < 14) score -= 10;
  
  if (sampleCount < 5000) score -= 20;  // Less than ~3.5 days at 1/min
  
  if (outlierResult.outlierPercent > 10) score -= 15;
  if (outlierResult.outlierPercent > 5) score -= 5;
  
  // Deductions for high variability
  const cv = outlierResult.cleaned.avg > 0 
    ? (outlierResult.cleaned.p95 - outlierResult.cleaned.avg) / outlierResult.cleaned.avg 
    : 0;
  if (cv > 3.0) score -= 20;  // Highly variable workload
  else if (cv > 1.5) score -= 10;
  
  // Bonus for pattern detection (predictable workload)
  if (outlierResult.outliers.every(o => o.classification.confidence > 0.7)) {
    score += 5;
  }
  
  return {
    score: Math.max(10, Math.min(100, score)),
    level: score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW',
    factors: {
      collectionDays,
      sampleCount,
      outlierPercent: outlierResult.outlierPercent,
      coefficientOfVariation: cv,
      allOutliersClassified: outlierResult.outliers.every(o => o.classification.confidence > 0.7)
    }
  };
}
```


---

## 6. STORAGE OPTIMIZER

### 6.1 Decision Tree

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STORAGE TYPE DECISION TREE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  INPUT: cleaned_p95_iops, cleaned_p95_throughput_mbps, storage_size_gb   │
│                                                                          │
│  ┌──────────────────────────────────────┐                                │
│  │ IOPS > 64,000?                       │                                │
│  └──────────┬───────────────┬───────────┘                                │
│         YES │               │ NO                                         │
│             ▼               ▼                                            │
│  ┌──────────────┐  ┌──────────────────────────────┐                     │
│  │ io2 REQUIRED │  │ Throughput > 4,000 MB/s?      │                     │
│  │ (only option │  └──────────┬───────────┬────────┘                     │
│  │  >64K IOPS)  │         YES │           │ NO                           │
│  └──────────────┘             ▼           ▼                              │
│                    ┌──────────────┐  ┌─────────────────────┐            │
│                    │ io2 REQUIRED │  │ Calculate cost for   │            │
│                    │ (only option │  │ BOTH gp3 and io2,   │            │
│                    │  >4GB/s)     │  │ pick cheapest        │            │
│                    └──────────────┘  └──────────┬──────────┘            │
│                                                  ▼                       │
│                                     ┌─────────────────────────┐         │
│                                     │ gp3_cost vs io2_cost    │         │
│                                     │                         │         │
│                                     │ gp3 = size*0.115 +      │         │
│                                     │   max(0,iops-3000)*0.20 │         │
│                                     │   + max(0,mbps-125)*0.08│         │
│                                     │                         │         │
│                                     │ io2 = size*0.125 +      │         │
│                                     │   min(iops,32K)*0.065 + │         │
│                                     │   overflow*0.046        │         │
│                                     │                         │         │
│                                     │ IF gp3_cost <= io2_cost │         │
│                                     │   → RECOMMEND gp3       │         │
│                                     │ ELSE                    │         │
│                                     │   → RECOMMEND io2       │         │
│                                     └─────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Storage Optimizer Implementation

```javascript
class StorageOptimizer {
  constructor() {
    this.GP3_MAX_IOPS = 64000;
    this.GP3_MAX_THROUGHPUT = 4000;  // MB/s
    this.GP3_BASELINE_IOPS = 3000;
    this.GP3_BASELINE_THROUGHPUT = 125;  // MB/s
    this.IO2_MAX_IOPS = 256000;
    
    // Pricing (Single-AZ, us-east-1)
    this.PRICING = {
      gp3: { storage: 0.115, iops: 0.20, throughput: 0.08 },
      io1: { storage: 0.125, iops: 0.10 },
      io2: { storage: 0.125, iopsTier1: 0.065, iopsTier2: 0.046, iopsTier3: 0.032 }
    };
  }

  /**
   * Determine optimal storage configuration
   * @param {Object} params
   * @param {number} params.requiredIOPS - P95 IOPS after outlier removal
   * @param {number} params.requiredThroughputMBps - P95 throughput after outlier removal
   * @param {number} params.storageSizeGB - Required storage capacity
   * @param {boolean} params.multiAZ - Whether Multi-AZ deployment
   * @param {string} params.currentStorageType - Current storage type (for migration analysis)
   * @param {number} params.currentProvisionedIOPS - Currently provisioned IOPS
   * @param {number} params.headroomPercent - Buffer above P95 (default 20%)
   */
  optimize(params) {
    const {
      requiredIOPS,
      requiredThroughputMBps,
      storageSizeGB,
      multiAZ = false,
      currentStorageType = null,
      currentProvisionedIOPS = 0,
      headroomPercent = 20
    } = params;

    const azMult = multiAZ ? 2.0 : 1.0;
    
    // Add headroom buffer to P95 values
    const targetIOPS = Math.ceil(requiredIOPS * (1 + headroomPercent / 100));
    const targetThroughput = Math.ceil(requiredThroughputMBps * (1 + headroomPercent / 100));

    // Evaluate all viable options
    const options = [];

    // Option 1: gp3
    if (targetIOPS <= this.GP3_MAX_IOPS && targetThroughput <= this.GP3_MAX_THROUGHPUT) {
      const provisionedIOPS = Math.max(this.GP3_BASELINE_IOPS, targetIOPS);
      const provisionedThroughput = Math.max(this.GP3_BASELINE_THROUGHPUT, targetThroughput);
      
      const cost = this._calculateGP3Cost(storageSizeGB, provisionedIOPS, provisionedThroughput, azMult);
      options.push({
        type: 'gp3',
        provisionedIOPS,
        provisionedThroughput,
        storageSizeGB,
        monthlyCost: cost.total,
        costBreakdown: cost,
        capabilities: { maxIOPS: this.GP3_MAX_IOPS, maxThroughput: this.GP3_MAX_THROUGHPUT },
        migrationRisk: 'LOW',
        migrationDowntime: 'NONE (online modification)'
      });
    }

    // Option 2: io2
    if (targetIOPS <= this.IO2_MAX_IOPS) {
      const cost = this._calculateIO2Cost(storageSizeGB, targetIOPS, azMult);
      options.push({
        type: 'io2',
        provisionedIOPS: targetIOPS,
        provisionedThroughput: null,  // io2 throughput scales with IOPS
        storageSizeGB,
        monthlyCost: cost.total,
        costBreakdown: cost,
        capabilities: { maxIOPS: this.IO2_MAX_IOPS, maxThroughput: 4000 },
        migrationRisk: 'LOW',
        migrationDowntime: 'NONE (online modification)'
      });
    }

    // Sort by cost
    options.sort((a, b) => a.monthlyCost - b.monthlyCost);

    // Calculate savings vs current
    let currentCost = null;
    if (currentStorageType && currentProvisionedIOPS) {
      currentCost = this._calculateCurrentCost(
        currentStorageType, storageSizeGB, currentProvisionedIOPS, azMult
      );
    }

    const recommended = options[0];
    const savings = currentCost 
      ? { monthly: currentCost - recommended.monthlyCost,
          percent: ((currentCost - recommended.monthlyCost) / currentCost) * 100,
          annual: (currentCost - recommended.monthlyCost) * 12 }
      : null;

    return {
      recommended,
      alternatives: options.slice(1),
      currentMonthlyCost: currentCost,
      savings,
      inputMetrics: { requiredIOPS, requiredThroughputMBps, targetIOPS, targetThroughput },
      reasoning: this._generateReasoning(recommended, targetIOPS, targetThroughput)
    };
  }

  _calculateGP3Cost(sizeGB, iops, throughputMBps, azMult) {
    const storage = sizeGB * this.PRICING.gp3.storage * azMult;
    const extraIOPS = Math.max(0, iops - this.GP3_BASELINE_IOPS) * this.PRICING.gp3.iops * azMult;
    const extraThroughput = Math.max(0, throughputMBps - this.GP3_BASELINE_THROUGHPUT) 
      * this.PRICING.gp3.throughput * azMult;
    return { storage, extraIOPS, extraThroughput, total: storage + extraIOPS + extraThroughput };
  }

  _calculateIO2Cost(sizeGB, iops, azMult) {
    const storage = sizeGB * this.PRICING.io2.storage * azMult;
    const tier1 = Math.min(iops, 32000) * this.PRICING.io2.iopsTier1 * azMult;
    const tier2 = Math.max(0, Math.min(iops, 64000) - 32000) * this.PRICING.io2.iopsTier2 * azMult;
    const tier3 = Math.max(0, iops - 64000) * this.PRICING.io2.iopsTier3 * azMult;
    const totalIOPS = tier1 + tier2 + tier3;
    return { storage, tier1, tier2, tier3, totalIOPS, total: storage + totalIOPS };
  }

  _calculateCurrentCost(type, sizeGB, iops, azMult) {
    switch (type) {
      case 'io1':
        return (sizeGB * 0.125 + iops * 0.10) * azMult;
      case 'io2':
        return this._calculateIO2Cost(sizeGB, iops, azMult).total;
      case 'gp3':
        return this._calculateGP3Cost(sizeGB, iops, this.GP3_BASELINE_THROUGHPUT, azMult).total;
      default:
        return null;
    }
  }

  _generateReasoning(recommended, targetIOPS, targetThroughput) {
    if (recommended.type === 'gp3') {
      if (targetIOPS <= this.GP3_BASELINE_IOPS) {
        return 'gp3 baseline (3,000 IOPS free) exceeds requirements. No additional IOPS provisioning needed.';
      }
      return `gp3 with ${recommended.provisionedIOPS} provisioned IOPS is cost-optimal. ` +
        `Break-even with io2 occurs at ~${this._calculateBreakEven(recommended.storageSizeGB)} IOPS.`;
    }
    if (recommended.type === 'io2') {
      return `io2 is cheaper than gp3 at ${targetIOPS} IOPS due to tiered pricing. ` +
        `Also provides 99.999% durability and sub-ms latency.`;
    }
    return '';
  }

  _calculateBreakEven(sizeGB) {
    // Solve: gp3_cost = io2_cost for IOPS
    // sizeGB*0.115 + (iops-3000)*0.20 = sizeGB*0.125 + iops*0.065
    // 0.135*iops = 0.010*sizeGB + 600
    return Math.round((0.010 * sizeGB + 600) / 0.135);
  }
}
```

### 6.3 IOPS Right-Sizing Logic

```javascript
function rightSizeIOPS(outlierResult, currentProvisioned) {
  // Use P95 of cleaned data (outliers removed) + 20% headroom
  const targetIOPS = Math.ceil(outlierResult.cleaned.p95 * 1.20);
  
  // Never go below gp3 baseline (it's free)
  const provisionedIOPS = Math.max(3000, targetIOPS);
  
  // Calculate savings
  const currentExtraIOPS = Math.max(0, currentProvisioned - 3000);
  const newExtraIOPS = Math.max(0, provisionedIOPS - 3000);
  const savedIOPS = currentExtraIOPS - newExtraIOPS;
  const monthlySavings = savedIOPS * 0.20; // gp3 rate, Single-AZ
  
  return {
    currentProvisioned,
    recommendedProvisioned: provisionedIOPS,
    monthlySavings,
    reasoning: savedIOPS > 0
      ? `Reduce from ${currentProvisioned} to ${provisionedIOPS} IOPS. ` +
        `P95 workload is ${outlierResult.cleaned.p95.toFixed(0)} IOPS (after removing ` +
        `${outlierResult.outlierCount} outlier samples). 20% headroom applied.`
      : 'Current provisioning is at or below optimal level.'
  };
}
```


---

## 7. INSTANCE OPTIMIZER

### 7.1 Enhanced Decision Tree

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    INSTANCE OPTIMIZER DECISION TREE (v2)                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  INPUTS:                                                                         │
│    cpu_p95 (cleaned), mem_pressure_p95, iops_p95 (cleaned),                     │
│    throughput_p95 (cleaned), current_cores, current_memory_gb,                   │
│    sql_edition, ht_status, workload_type                                         │
│                                                                                  │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 1: Edition Shortcut                 │                                    │
│  │ Express → db.t3.xlarge (FIXED)           │                                    │
│  │ Developer → db.r6i.xlarge (FIXED)        │                                    │
│  └──────────────────┬──────────────────────┘                                    │
│                     │ (Web/Standard/Enterprise continue)                          │
│                     ▼                                                             │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 2: Core Adjustment                  │                                    │
│  │ IF ht_status == ON:                      │                                    │
│  │   physical_cores = logical_cores / 2     │                                    │
│  │ ELSE:                                    │                                    │
│  │   physical_cores = logical_cores         │                                    │
│  └──────────────────┬──────────────────────┘                                    │
│                     ▼                                                             │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 3: Memory/CPU Ratio → Family       │                                    │
│  │ ratio = current_memory_gb / physical_cores│                                   │
│  │ ratio ≤ 4 → M-family (general purpose)  │                                    │
│  │ ratio > 4 → R-family (memory optimized) │                                    │
│  └──────────────────┬──────────────────────┘                                    │
│                     ▼                                                             │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 4: Utilization-Based Scaling        │                                    │
│  │                                          │                                    │
│  │ CPU≥80 AND Mem≥80 → SCALE UP + R-family │                                    │
│  │ CPU≥80 AND Mem<80 → SCALE UP + keep fam │                                    │
│  │ CPU<80 AND Mem≥80 → NO SCALE + R-family │                                    │
│  │ CPU<50 AND Mem<50 → SCALE DOWN          │                                    │
│  │ OTHERWISE        → KEEP CURRENT SIZE    │  ← NEW (was missing)              │
│  └──────────────────┬──────────────────────┘                                    │
│                     ▼                                                             │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 5: Memory Floor Validation          │                                    │
│  │ IF instance_memory < source_memory_gb:   │                                    │
│  │   → Find next size up with enough memory │                                    │
│  └──────────────────┬──────────────────────┘                                    │
│                     ▼                                                             │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 6: IOPS/Throughput Capacity Match   │  ← CHANGED: uses P95 not MAX     │
│  │ Find smallest instance that provides:    │                                    │
│  │   instance_max_iops ≥ target_iops        │                                    │
│  │   instance_max_throughput ≥ target_mbps  │                                    │
│  │ AND meets CPU + Memory from above        │                                    │
│  └──────────────────┬──────────────────────┘                                    │
│                     ▼                                                             │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 7: Edition Caps                     │                                    │
│  │ Web → max db.*.4xlarge (16 vCPU)        │                                    │
│  │ Standard → max db.*.12xlarge (48 vCPU)  │                                    │
│  │ Enterprise → unlimited                   │                                    │
│  └──────────────────┬──────────────────────┘                                    │
│                     ▼                                                             │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 8: Generation Optimization (NEW)    │                                    │
│  │ Evaluate r7i/m7i vs r6i/m6i:            │                                    │
│  │   Same base price, better perf/vCPU     │                                    │
│  │ Evaluate Optimize CPU (≥2xlarge):        │                                    │
│  │   Disable 50% cores → 50% license saving│                                    │
│  └──────────────────┬──────────────────────┘                                    │
│                     ▼                                                             │
│  ┌─────────────────────────────────────────┐                                    │
│  │ STEP 9: BYOL/BYOM Opportunity (NEW)      │                                    │
│  │ Flag if license cost > 40% of total      │                                    │
│  │ Show BYOM pricing as alternative         │                                    │
│  └─────────────────────────────────────────┘                                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Instance Optimizer Implementation

```javascript
class InstanceOptimizer {
  constructor() {
    this.INSTANCE_CATALOG = [
      // R-family (memory optimized) - sorted by size
      { name: 'db.r6i.large',    vcpu: 2,  ram: 16,  maxIOPS: 12500,  maxMBps: 625,   family: 'r', gen: 6 },
      { name: 'db.r6i.xlarge',   vcpu: 4,  ram: 32,  maxIOPS: 20000,  maxMBps: 1250,  family: 'r', gen: 6 },
      { name: 'db.r6i.2xlarge',  vcpu: 8,  ram: 64,  maxIOPS: 40000,  maxMBps: 2500,  family: 'r', gen: 6 },
      { name: 'db.r6i.4xlarge',  vcpu: 16, ram: 128, maxIOPS: 64000,  maxMBps: 4000,  family: 'r', gen: 6 },
      { name: 'db.r6i.8xlarge',  vcpu: 32, ram: 256, maxIOPS: 64000,  maxMBps: 4000,  family: 'r', gen: 6 },
      { name: 'db.r6i.12xlarge', vcpu: 48, ram: 384, maxIOPS: 64000,  maxMBps: 4000,  family: 'r', gen: 6 },
      { name: 'db.r6i.16xlarge', vcpu: 64, ram: 512, maxIOPS: 64000,  maxMBps: 4000,  family: 'r', gen: 6 },
      { name: 'db.r7i.large',    vcpu: 2,  ram: 16,  maxIOPS: 12500,  maxMBps: 625,   family: 'r', gen: 7 },
      { name: 'db.r7i.xlarge',   vcpu: 4,  ram: 32,  maxIOPS: 20000,  maxMBps: 1250,  family: 'r', gen: 7 },
      { name: 'db.r7i.2xlarge',  vcpu: 8,  ram: 64,  maxIOPS: 40000,  maxMBps: 2500,  family: 'r', gen: 7 },
      { name: 'db.r7i.4xlarge',  vcpu: 16, ram: 128, maxIOPS: 64000,  maxMBps: 4000,  family: 'r', gen: 7 },
      { name: 'db.r7i.8xlarge',  vcpu: 32, ram: 256, maxIOPS: 64000,  maxMBps: 4000,  family: 'r', gen: 7 },
      // M-family (general purpose) - sorted by size
      { name: 'db.m6i.large',    vcpu: 2,  ram: 8,   maxIOPS: 12500,  maxMBps: 625,   family: 'm', gen: 6 },
      { name: 'db.m6i.xlarge',   vcpu: 4,  ram: 16,  maxIOPS: 20000,  maxMBps: 1250,  family: 'm', gen: 6 },
      { name: 'db.m6i.2xlarge',  vcpu: 8,  ram: 32,  maxIOPS: 40000,  maxMBps: 2500,  family: 'm', gen: 6 },
      { name: 'db.m6i.4xlarge',  vcpu: 16, ram: 64,  maxIOPS: 64000,  maxMBps: 4000,  family: 'm', gen: 6 },
      { name: 'db.m6i.8xlarge',  vcpu: 32, ram: 128, maxIOPS: 64000,  maxMBps: 4000,  family: 'm', gen: 6 },
    ];

    this.EDITION_CAPS = { 'web': 16, 'standard': 48, 'enterprise': Infinity };
    this.LICENSE_RATES = { 'express': 0, 'web': 0.06, 'standard': 0.30, 'enterprise': 0.87 };
  }

  /**
   * Generate instance recommendation
   */
  recommend(params) {
    const {
      cpuP95,              // cleaned CPU P95 (0-100)
      memPressureP95,      // memory pressure score P95 (0-100)
      iopsP95,             // cleaned IOPS P95
      throughputP95MBps,   // cleaned throughput P95 MB/s
      currentCores,        // source logical core count
      currentMemoryGB,     // source total RAM
      sqlEdition,          // 'express' | 'web' | 'standard' | 'enterprise'
      htStatus,            // 'ON' | 'OFF'
      workloadType         // 'OLTP' | 'REPORTING' | 'ETL' | 'MIXED'
    } = params;

    // Step 1: Edition shortcuts
    if (sqlEdition === 'express') {
      return this._fixedRecommendation('db.t3.xlarge', 'Express edition → fixed instance');
    }
    if (sqlEdition === 'developer') {
      return this._fixedRecommendation('db.r6i.xlarge', 'Developer edition → fixed instance');
    }

    // Step 2: Core adjustment
    const physicalCores = htStatus === 'ON' ? Math.ceil(currentCores / 2) : currentCores;

    // Step 3: Family selection
    const memCpuRatio = currentMemoryGB / physicalCores;
    let targetFamily = memCpuRatio > 4 ? 'r' : 'm';

    // Step 4: Scaling rules
    let scaleDirection = 'KEEP'; // NEW: explicit keep
    if (cpuP95 >= 80 && memPressureP95 >= 80) {
      scaleDirection = 'UP';
      targetFamily = 'r'; // Force memory-optimized
    } else if (cpuP95 >= 80 && memPressureP95 < 80) {
      scaleDirection = 'UP';
    } else if (cpuP95 < 80 && memPressureP95 >= 80) {
      scaleDirection = 'KEEP';
      targetFamily = 'r';
    } else if (cpuP95 < 50 && memPressureP95 < 50) {
      scaleDirection = 'DOWN';
    }

    // Step 5: Find baseline instance (lift-and-shift equivalent)
    let baselineInstance = this._findLiftAndShift(physicalCores, currentMemoryGB, targetFamily);

    // Apply scaling
    if (scaleDirection === 'UP') {
      baselineInstance = this._scaleUp(baselineInstance, targetFamily);
    } else if (scaleDirection === 'DOWN') {
      baselineInstance = this._scaleDown(baselineInstance, targetFamily);
    }

    // Step 6: Memory floor validation
    if (baselineInstance.ram < currentMemoryGB) {
      baselineInstance = this._findWithMinMemory(currentMemoryGB, targetFamily);
    }

    // Step 7: IOPS/Throughput capacity check (NOW uses P95, not MAX)
    const targetIOPS = Math.ceil(iopsP95 * 1.20);  // 20% headroom
    const targetMBps = Math.ceil(throughputP95MBps * 1.20);
    
    if (baselineInstance.maxIOPS < targetIOPS || baselineInstance.maxMBps < targetMBps) {
      baselineInstance = this._findWithIOCapacity(targetIOPS, targetMBps, targetFamily, currentMemoryGB);
    }

    // Step 8: Edition cap enforcement
    const maxVCPU = this.EDITION_CAPS[sqlEdition];
    if (baselineInstance.vcpu > maxVCPU) {
      baselineInstance = this._findLargestUnderCap(maxVCPU, targetFamily);
    }

    // Step 9: Generation optimization
    const genOptimized = this._evaluateGenerationUpgrade(baselineInstance, sqlEdition);

    // Step 10: Calculate costs and build recommendation
    return this._buildRecommendation(baselineInstance, genOptimized, sqlEdition, params);
  }

  _findLiftAndShift(cores, memoryGB, family) {
    const candidates = this.INSTANCE_CATALOG
      .filter(i => i.family === family)
      .filter(i => i.vcpu >= cores && i.ram >= memoryGB)
      .sort((a, b) => a.vcpu - b.vcpu || a.ram - b.ram);
    return candidates[0] || this.INSTANCE_CATALOG[this.INSTANCE_CATALOG.length - 1];
  }

  _scaleUp(instance, family) {
    const sameFamily = this.INSTANCE_CATALOG.filter(i => i.family === family);
    const idx = sameFamily.findIndex(i => i.name === instance.name);
    return idx < sameFamily.length - 1 ? sameFamily[idx + 1] : instance;
  }

  _scaleDown(instance, family) {
    const sameFamily = this.INSTANCE_CATALOG.filter(i => i.family === family);
    const idx = sameFamily.findIndex(i => i.name === instance.name);
    return idx > 0 ? sameFamily[idx - 1] : instance;
  }

  _findWithMinMemory(minMemGB, family) {
    return this.INSTANCE_CATALOG
      .filter(i => i.family === family && i.ram >= minMemGB)
      .sort((a, b) => a.ram - b.ram)[0];
  }

  _findWithIOCapacity(targetIOPS, targetMBps, family, minMemGB) {
    return this.INSTANCE_CATALOG
      .filter(i => i.family === family && i.maxIOPS >= targetIOPS && 
                   i.maxMBps >= targetMBps && i.ram >= minMemGB)
      .sort((a, b) => a.vcpu - b.vcpu)[0];
  }

  _findLargestUnderCap(maxVCPU, family) {
    return this.INSTANCE_CATALOG
      .filter(i => i.family === family && i.vcpu <= maxVCPU)
      .sort((a, b) => b.vcpu - a.vcpu)[0];
  }

  _evaluateGenerationUpgrade(instance, edition) {
    // Check if newer generation available at same size
    const gen7Equivalent = this.INSTANCE_CATALOG.find(
      i => i.vcpu === instance.vcpu && i.ram === instance.ram && 
           i.family === instance.family && i.gen === 7
    );
    
    const optimizeCPU = instance.vcpu >= 8; // Available on 2xlarge+
    const licenseRate = this.LICENSE_RATES[edition];
    
    let optimizeCPUSavings = 0;
    if (optimizeCPU && gen7Equivalent) {
      // Disable 50% of cores → 50% license savings
      optimizeCPUSavings = (instance.vcpu / 2) * licenseRate * 730;
    }

    return {
      currentGen: instance,
      newerGen: gen7Equivalent,
      optimizeCPUAvailable: optimizeCPU,
      optimizeCPUMonthlySavings: optimizeCPUSavings,
      recommendation: optimizeCPUSavings > 100 
        ? 'UPGRADE_WITH_OPTIMIZE_CPU' 
        : gen7Equivalent ? 'UPGRADE_GEN' : 'KEEP_CURRENT'
    };
  }

  _buildRecommendation(instance, genOpt, edition, params) {
    const licenseRate = this.LICENSE_RATES[edition];
    const baseRate = instance.vcpu * 0.125; // Approximate base compute per hour
    const hourlyRate = baseRate + (licenseRate * instance.vcpu);
    const monthlyCompute = hourlyRate * 730;

    return {
      primary: {
        instance: instance.name,
        vcpu: instance.vcpu,
        ram: instance.ram,
        maxIOPS: instance.maxIOPS,
        maxThroughputMBps: instance.maxMBps,
        hourlyRate,
        monthlyCompute,
        score: 100
      },
      generationOptimization: genOpt,
      byolOpportunity: {
        applicable: licenseRate * instance.vcpu * 730 > monthlyCompute * 0.4,
        currentLicenseCost: licenseRate * instance.vcpu * 730,
        byolMonthlyCost: baseRate * 730,
        potentialSavings: licenseRate * instance.vcpu * 730
      },
      scalingRationale: {
        cpuP95: params.cpuP95,
        memPressureP95: params.memPressureP95,
        iopsP95: params.iopsP95,
        throughputP95MBps: params.throughputP95MBps,
        decision: `CPU=${params.cpuP95}%, Mem=${params.memPressureP95}% → ` +
          `${params.cpuP95 >= 80 ? 'HIGH CPU' : 'OK CPU'}, ` +
          `${params.memPressureP95 >= 80 ? 'HIGH MEM PRESSURE' : 'OK MEM'}`
      }
    };
  }

  _fixedRecommendation(instanceName, reason) {
    const instance = this.INSTANCE_CATALOG.find(i => i.name === instanceName) || 
      { name: instanceName, vcpu: 4, ram: 32, maxIOPS: 20000, maxMBps: 1250 };
    return { primary: { instance: instanceName, ...instance, score: 100 }, reason };
  }
}
```


---

## 8. SAVINGS CALCULATOR

### 8.1 Comprehensive Savings Model

```javascript
class SavingsCalculator {
  /**
   * Calculate total savings: current estimated cost vs optimized recommendation
   * 
   * @param {Object} currentConfig - What the customer likely has today (estimated from source server)
   * @param {Object} optimizedConfig - What we recommend
   * @param {Object} options - Multi-AZ, RI commitment level, etc.
   * @returns {SavingsReport}
   */
  calculate(currentConfig, optimizedConfig, options = {}) {
    const { multiAZ = true, commitment = 'on-demand', region = 'us-east-1' } = options;
    const azMult = multiAZ ? 2.0 : 1.0;

    // --- CURRENT COST ESTIMATION ---
    // We estimate what this workload would cost on RDS "as-is" (lift-and-shift)
    const currentCompute = this._computeCost(
      currentConfig.instance, currentConfig.edition, azMult, 'on-demand'
    );
    const currentStorage = this._storageCost(
      currentConfig.storageType, currentConfig.storageGB,
      currentConfig.provisionedIOPS, currentConfig.provisionedThroughput, azMult
    );
    const currentTotal = currentCompute + currentStorage;

    // --- OPTIMIZED COST ---
    const optCompute = this._computeCost(
      optimizedConfig.instance, optimizedConfig.edition, azMult, commitment
    );
    const optStorage = this._storageCost(
      optimizedConfig.storageType, optimizedConfig.storageGB,
      optimizedConfig.provisionedIOPS, optimizedConfig.provisionedThroughput, azMult
    );
    const optTotal = optCompute + optStorage;

    // --- SAVINGS BREAKDOWN ---
    const computeSavings = currentCompute - optCompute;
    const storageSavings = currentStorage - optStorage;
    const totalSavings = currentTotal - optTotal;

    // --- CONFIDENCE INTERVAL ---
    const confidence = this._calculateConfidenceInterval(
      currentConfig, optimizedConfig, options
    );

    return {
      current: {
        monthly: currentTotal,
        annual: currentTotal * 12,
        breakdown: {
          compute: currentCompute,
          storage: currentStorage,
          instance: currentConfig.instance,
          storageType: currentConfig.storageType,
          iops: currentConfig.provisionedIOPS
        }
      },
      optimized: {
        monthly: optTotal,
        annual: optTotal * 12,
        breakdown: {
          compute: optCompute,
          storage: optStorage,
          instance: optimizedConfig.instance,
          storageType: optimizedConfig.storageType,
          iops: optimizedConfig.provisionedIOPS,
          commitment
        }
      },
      savings: {
        monthly: totalSavings,
        annual: totalSavings * 12,
        percent: (totalSavings / currentTotal) * 100,
        breakdown: {
          compute: { amount: computeSavings, percent: (computeSavings / currentCompute) * 100 },
          storage: { amount: storageSavings, percent: currentStorage > 0 ? (storageSavings / currentStorage) * 100 : 0 }
        }
      },
      confidence,
      threeYearTCO: {
        current: currentTotal * 36,
        optimized: optTotal * 36,
        savings: totalSavings * 36
      }
    };
  }

  _computeCost(instance, edition, azMult, commitment) {
    const BASE_RATES = {
      'db.r6i.large': 0.250, 'db.r6i.xlarge': 0.500, 'db.r6i.2xlarge': 1.000,
      'db.r6i.4xlarge': 2.000, 'db.r6i.8xlarge': 4.000, 'db.r6i.12xlarge': 6.000,
      'db.r7i.large': 0.250, 'db.r7i.xlarge': 0.500, 'db.r7i.2xlarge': 1.000,
      'db.r7i.4xlarge': 2.000, 'db.r7i.8xlarge': 4.000,
      'db.m6i.large': 0.218, 'db.m6i.xlarge': 0.436, 'db.m6i.2xlarge': 0.872,
      'db.m6i.4xlarge': 1.744, 'db.m6i.8xlarge': 3.488,
    };
    const LICENSE_RATES = { 'express': 0, 'web': 0.06, 'standard': 0.30, 'enterprise': 0.87 };
    const RI_DISCOUNTS = {
      'on-demand': 1.0, '1yr-no-upfront': 0.66, '1yr-all-upfront': 0.60,
      '3yr-partial-upfront': 0.47, '3yr-all-upfront': 0.42
    };

    const vcpus = this._getVCPUs(instance);
    const baseRate = BASE_RATES[instance] || 1.0;
    const licenseRate = (LICENSE_RATES[edition] || 0.30) * vcpus;
    const discount = RI_DISCOUNTS[commitment] || 1.0;

    return (baseRate + licenseRate) * 730 * azMult * discount;
  }

  _storageCost(type, sizeGB, iops, throughputMBps, azMult) {
    switch (type) {
      case 'gp3': {
        const base = sizeGB * 0.115 * azMult;
        const extraIOPS = Math.max(0, (iops || 3000) - 3000) * 0.20 * azMult;
        const extraTP = Math.max(0, (throughputMBps || 125) - 125) * 0.08 * azMult;
        return base + extraIOPS + extraTP;
      }
      case 'io1': {
        return (sizeGB * 0.125 + (iops || 3000) * 0.10) * azMult;
      }
      case 'io2': {
        const base = sizeGB * 0.125 * azMult;
        const t1 = Math.min(iops || 3000, 32000) * 0.065 * azMult;
        const t2 = Math.max(0, (iops || 3000) - 32000) * 0.046 * azMult;
        return base + t1 + t2;
      }
      default: return sizeGB * 0.115 * azMult;
    }
  }

  _calculateConfidenceInterval(currentConfig, optimizedConfig, options) {
    // Confidence is affected by:
    // 1. How much data we have (more days = higher confidence)
    // 2. How aggressive the recommendation is (bigger downsize = lower confidence)
    // 3. Workload variability
    
    const factors = [];
    
    // Data quality factor
    const collectionDays = options.collectionDays || 7;
    if (collectionDays >= 14) factors.push(1.0);
    else if (collectionDays >= 7) factors.push(0.85);
    else factors.push(0.6);

    // Aggressiveness factor (how far are we downsizing?)
    const currentVCPU = this._getVCPUs(currentConfig.instance);
    const optVCPU = this._getVCPUs(optimizedConfig.instance);
    const sizeRatio = optVCPU / currentVCPU;
    if (sizeRatio >= 0.75) factors.push(1.0);      // Conservative (same or 1 step down)
    else if (sizeRatio >= 0.5) factors.push(0.85);  // Moderate (2 steps down)
    else factors.push(0.65);                         // Aggressive (3+ steps down)

    // Outlier removal factor
    const outlierPercent = options.outlierPercent || 0;
    if (outlierPercent < 5) factors.push(1.0);
    else if (outlierPercent < 10) factors.push(0.9);
    else factors.push(0.75);

    const overallConfidence = factors.reduce((a, b) => a * b, 1.0);
    
    return {
      score: Math.round(overallConfidence * 100),
      level: overallConfidence >= 0.8 ? 'HIGH' : overallConfidence >= 0.6 ? 'MEDIUM' : 'LOW',
      factors: {
        dataQuality: factors[0],
        aggressiveness: factors[1],
        outlierImpact: factors[2]
      },
      // Savings range based on confidence
      savingsRange: {
        conservative: null,  // Filled by caller with low-end estimate
        expected: null,      // The calculated savings
        optimistic: null     // High-end estimate (if also apply RI)
      }
    };
  }

  _getVCPUs(instanceName) {
    const VCPU_MAP = {
      'db.r6i.large': 2, 'db.r6i.xlarge': 4, 'db.r6i.2xlarge': 8,
      'db.r6i.4xlarge': 16, 'db.r6i.8xlarge': 32, 'db.r6i.12xlarge': 48,
      'db.r7i.large': 2, 'db.r7i.xlarge': 4, 'db.r7i.2xlarge': 8,
      'db.r7i.4xlarge': 16, 'db.r7i.8xlarge': 32,
      'db.m6i.large': 2, 'db.m6i.xlarge': 4, 'db.m6i.2xlarge': 8,
      'db.m6i.4xlarge': 16, 'db.m6i.8xlarge': 32,
    };
    return VCPU_MAP[instanceName] || 4;
  }
}
```

### 8.2 Savings Scenarios (Conservative / Expected / Optimistic)

```javascript
function generateSavingsScenarios(currentConfig, optimizedConfig, outlierResult) {
  const calc = new SavingsCalculator();
  
  // Scenario 1: CONSERVATIVE (no RI, use P99 instead of P95, no outlier removal)
  const conservative = calc.calculate(
    currentConfig,
    { ...optimizedConfig, provisionedIOPS: Math.ceil(outlierResult.raw.p99 * 1.20) },
    { commitment: 'on-demand' }
  );

  // Scenario 2: EXPECTED (on-demand, P95 cleaned, outliers removed)
  const expected = calc.calculate(currentConfig, optimizedConfig, { commitment: 'on-demand' });

  // Scenario 3: OPTIMISTIC (1-yr RI, P95 cleaned, gen upgrade, optimize CPU)
  const optimistic = calc.calculate(
    currentConfig,
    optimizedConfig,
    { commitment: '1yr-all-upfront' }
  );

  return {
    conservative: { ...conservative, label: 'Conservative (no outlier removal, On-Demand)' },
    expected: { ...expected, label: 'Expected (outlier-adjusted, On-Demand)' },
    optimistic: { ...optimistic, label: 'Optimistic (outlier-adjusted + 1-yr RI)' },
    summary: {
      monthlySavingsRange: `$${conservative.savings.monthly.toFixed(0)} — $${optimistic.savings.monthly.toFixed(0)}`,
      annualSavingsRange: `$${conservative.savings.annual.toFixed(0)} — $${optimistic.savings.annual.toFixed(0)}`,
      percentRange: `${conservative.savings.percent.toFixed(0)}% — ${optimistic.savings.percent.toFixed(0)}%`
    }
  };
}
```


---

## 9. RISK ASSESSMENT

### 9.1 Risk Model

```javascript
class RiskAssessment {
  /**
   * Assess risk of implementing the recommendation
   * Returns risk level 1-5 and specific mitigation steps
   */
  assess(currentConfig, recommendation, outlierResult, workloadProfile) {
    const risks = [];

    // Risk 1: IOPS headroom too tight
    const iopsSizing = this._assessIOPSRisk(recommendation, outlierResult);
    if (iopsSizing.level > 1) risks.push(iopsSizing);

    // Risk 2: Memory downgrade
    const memoryRisk = this._assessMemoryRisk(currentConfig, recommendation);
    if (memoryRisk.level > 1) risks.push(memoryRisk);

    // Risk 3: CPU downgrade during peaks
    const cpuRisk = this._assessCPURisk(currentConfig, recommendation, workloadProfile);
    if (cpuRisk.level > 1) risks.push(cpuRisk);

    // Risk 4: Workload growth
    const growthRisk = this._assessGrowthRisk(workloadProfile);
    if (growthRisk.level > 1) risks.push(growthRisk);

    // Risk 5: Outlier misclassification
    const outlierRisk = this._assessOutlierRisk(outlierResult);
    if (outlierRisk.level > 1) risks.push(outlierRisk);

    // Risk 6: Edition downgrade feasibility
    const editionRisk = this._assessEditionRisk(currentConfig, recommendation);
    if (editionRisk.level > 1) risks.push(editionRisk);

    // Overall risk = highest individual risk
    const overallLevel = Math.max(...risks.map(r => r.level), 1);

    return {
      overallRisk: overallLevel,
      overallLabel: ['', 'MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL'][overallLevel],
      risks,
      mitigations: risks.flatMap(r => r.mitigations),
      proceedRecommendation: overallLevel <= 3 
        ? 'SAFE TO PROCEED' 
        : 'PROCEED WITH CAUTION — implement monitoring before/after'
    };
  }

  _assessIOPSRisk(recommendation, outlierResult) {
    const provisionedIOPS = recommendation.storageConfig.provisionedIOPS;
    const rawMax = outlierResult.raw.max;
    const cleanedP95 = outlierResult.cleaned.p95;
    
    // How much headroom between provisioned and raw max?
    const headroomVsMax = (provisionedIOPS - rawMax) / rawMax;
    
    if (headroomVsMax < -0.3) {
      // Provisioned is 30%+ below raw MAX — relying heavily on outlier removal
      return {
        category: 'IOPS_CAPACITY',
        level: 4,
        description: `Provisioned IOPS (${provisionedIOPS}) is ${Math.abs(headroomVsMax * 100).toFixed(0)}% below observed MAX (${rawMax.toFixed(0)}). Relies on outlier detection correctness.`,
        mitigations: [
          'Monitor ReadIOPS + WriteIOPS immediately after migration',
          'Set CloudWatch alarm at 80% of provisioned IOPS',
          'gp3 IOPS can be increased online with no downtime if needed',
          'Consider provisioning at P99 for first month, then reduce'
        ]
      };
    } else if (headroomVsMax < 0) {
      return {
        category: 'IOPS_CAPACITY',
        level: 3,
        description: `Provisioned IOPS (${provisionedIOPS}) is below raw MAX (${rawMax.toFixed(0)}) but within outlier-adjusted range.`,
        mitigations: [
          'Monitor IOPS utilization for first 2 weeks after migration',
          'Set CloudWatch alarm at 85% of provisioned IOPS'
        ]
      };
    }
    return { category: 'IOPS_CAPACITY', level: 1, description: 'Adequate headroom', mitigations: [] };
  }

  _assessMemoryRisk(currentConfig, recommendation) {
    const currentMemGB = currentConfig.currentMemoryGB;
    const recMemGB = recommendation.instanceConfig.ram;
    
    if (recMemGB < currentMemGB) {
      const reduction = ((currentMemGB - recMemGB) / currentMemGB) * 100;
      return {
        category: 'MEMORY_REDUCTION',
        level: reduction > 50 ? 4 : reduction > 25 ? 3 : 2,
        description: `Recommended instance has ${recMemGB} GB RAM vs source ${currentMemGB} GB (${reduction.toFixed(0)}% reduction).`,
        mitigations: [
          'SQL Server on RDS will use all available RAM for buffer pool',
          `Smaller buffer pool may increase physical reads — monitor PLE (target: >${(recMemGB / 4) * 300}s)`,
          'If PLE drops below threshold, scale up instance (online, brief outage)',
          'Consider: was source over-provisioned? Check if PLE was consistently high (>30min)'
        ]
      };
    }
    return { category: 'MEMORY_REDUCTION', level: 1, description: 'Memory maintained or increased', mitigations: [] };
  }

  _assessCPURisk(currentConfig, recommendation, workloadProfile) {
    const currentVCPU = currentConfig.currentCores;
    const recVCPU = recommendation.instanceConfig.vcpu;
    
    if (recVCPU < currentVCPU && workloadProfile.cpuP95 > 60) {
      return {
        category: 'CPU_CAPACITY',
        level: 3,
        description: `Downsizing from ${currentVCPU} to ${recVCPU} vCPUs with P95 CPU at ${workloadProfile.cpuP95}%. Limited headroom for spikes.`,
        mitigations: [
          'Monitor CPUUtilization closely after migration',
          'Set alarm at 80% CPU sustained for 5 minutes',
          'RDS instance resize is available but causes brief outage (~5-10 min)',
          'Consider: RDS vCPUs may outperform on-prem vCPUs (newer generation hardware)'
        ]
      };
    }
    return { category: 'CPU_CAPACITY', level: 1, description: 'CPU capacity adequate', mitigations: [] };
  }

  _assessGrowthRisk(workloadProfile) {
    // If we can detect growth trend in the data
    if (workloadProfile.iopsGrowthRatePerMonth > 5) {
      return {
        category: 'WORKLOAD_GROWTH',
        level: 3,
        description: `IOPS growing at ~${workloadProfile.iopsGrowthRatePerMonth.toFixed(0)}%/month. Recommendation may need revision within 3-6 months.`,
        mitigations: [
          'Re-run SSAT analysis in 3 months to validate sizing',
          'Provision 30% headroom instead of 20% for growing workloads',
          'Set up CloudWatch dashboard to track IOPS trend over time',
          'Consider: is growth organic or from a one-time data load?'
        ]
      };
    }
    return { category: 'WORKLOAD_GROWTH', level: 1, description: 'No significant growth detected', mitigations: [] };
  }

  _assessOutlierRisk(outlierResult) {
    if (outlierResult.outlierPercent > 10) {
      return {
        category: 'OUTLIER_RELIABILITY',
        level: 3,
        description: `${outlierResult.outlierPercent.toFixed(1)}% of samples classified as outliers. High outlier rate reduces confidence.`,
        mitigations: [
          'Review outlier classification manually before proceeding',
          'Consider using P99 instead of cleaned P95 for conservative sizing',
          'Some "outliers" may be legitimate recurring workload',
          'Extend collection period to 14+ days for better pattern detection'
        ]
      };
    }
    if (outlierResult.outliers.some(o => o.classification.type === 'UNCLASSIFIED')) {
      return {
        category: 'OUTLIER_RELIABILITY',
        level: 2,
        description: 'Some outlier spikes could not be automatically classified.',
        mitigations: [
          'Ask customer about maintenance schedules to validate outlier classification',
          'Unclassified spikes may be legitimate workload — consider including in sizing'
        ]
      };
    }
    return { category: 'OUTLIER_RELIABILITY', level: 1, description: 'Outlier detection reliable', mitigations: [] };
  }

  _assessEditionRisk(currentConfig, recommendation) {
    if (recommendation.suggestedEdition && 
        recommendation.suggestedEdition !== currentConfig.edition) {
      return {
        category: 'EDITION_CHANGE',
        level: 4,
        description: `Suggests edition change from ${currentConfig.edition} to ${recommendation.suggestedEdition}. Requires feature compatibility assessment.`,
        mitigations: [
          'Run Enterprise → Standard feature dependency check',
          'Key blockers: Online Index Ops, Readable Secondaries, Unlimited RAM, Batch Mode on Rowstore',
          'Test application against Standard edition in non-prod first',
          'BYOM may be better alternative (keep Enterprise features, reduce cost)'
        ]
      };
    }
    return { category: 'EDITION_CHANGE', level: 1, description: 'No edition change', mitigations: [] };
  }
}
```

### 9.2 Risk Summary Matrix

```
┌──────────────────────────────────────────────────────────────────────┐
│                    RISK LEVEL DEFINITIONS                              │
├────────┬─────────────────────────────────────────────────────────────┤
│ Level  │ Definition                                                   │
├────────┼─────────────────────────────────────────────────────────────┤
│ 1      │ MINIMAL — Change well within observed workload envelope      │
│ 2      │ LOW — Minor reduction in headroom, easily reversible         │
│ 3      │ MODERATE — Measurable risk, requires monitoring after change │
│ 4      │ HIGH — Significant change, manual review required            │
│ 5      │ CRITICAL — Not recommended without customer sign-off         │
└────────┴─────────────────────────────────────────────────────────────┘
```


---

## 10. OUTPUT FORMAT

### 10.1 Executive Summary (Customer-Facing)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     COST OPTIMIZATION REPORT                                  │
│                     Customer: Contoso Ltd                                     │
│                     Generated: 2026-07-13                                     │
│                     Servers Analyzed: 5                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  TOTAL ESTIMATED SAVINGS                                                │ │
│  │                                                                         │ │
│  │  Monthly:  $12,450 — $18,200    (35% — 52% reduction)                  │ │
│  │  Annual:   $149,400 — $218,400                                          │ │
│  │  3-Year:   $448,200 — $655,200                                          │ │
│  │                                                                         │ │
│  │  Confidence: ████████░░ 82% (HIGH)                                      │ │
│  │  Collection Period: 12 days | Outliers Detected: 4.2%                   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  SAVINGS BREAKDOWN BY SERVER:                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ Server              │ Current Est. │ Optimized │ Savings  │ Risk       │ │
│  ├─────────────────────┼──────────────┼───────────┼──────────┼────────────┤ │
│  │ SQLPROD-01          │ $8,200/mo    │ $4,450/mo │ $3,750   │ ●●○○○ LOW │ │
│  │ SQLPROD-02          │ $12,500/mo   │ $6,800/mo │ $5,700   │ ●●●○○ MOD │ │
│  │ SQLDEV-01           │ $4,200/mo    │ $1,100/mo │ $3,100   │ ●○○○○ MIN │ │
│  │ SQLRPT-01           │ $6,800/mo    │ $4,900/mo │ $1,900   │ ●●○○○ LOW │ │
│  │ SQLETL-01           │ $3,500/mo    │ $3,500/mo │ $0       │ — N/A     │ │
│  └─────────────────────┴──────────────┴───────────┴──────────┴────────────┘ │
│                                                                               │
│  TOP OPTIMIZATION ACTIONS:                                                   │
│  1. 🔴 SQLPROD-02: Downsize db.r6i.8xlarge → db.r6i.4xlarge (CPU P95=42%) │
│  2. 🟡 SQLPROD-01: Switch io1 → gp3 storage (saves $2,100/mo)             │
│  3. 🟢 SQLDEV-01: Use Developer BYOM + Single-AZ (non-prod)                │
│  4. 🟡 SQLRPT-01: Reduce provisioned IOPS 10K → 4K (P95=3,200)            │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Per-Server Detail View

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  SERVER: SQLPROD-01                                                           │
│  Source: 16 cores (HT ON = 8 physical), 128 GB RAM, SQL Server Standard      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  WORKLOAD PROFILE:                                                           │
│  ┌──────────────┬────────┬────────┬────────┬────────┬────────┐              │
│  │ Metric       │ Avg    │ P75    │ P95    │ P99    │ Max    │              │
│  ├──────────────┼────────┼────────┼────────┼────────┼────────┤              │
│  │ CPU %        │ 28%    │ 41%    │ 62%    │ 78%    │ 94%    │              │
│  │ Mem Pressure │ 12%    │ 18%    │ 35%    │ 52%    │ 68%    │              │
│  │ IOPS         │ 1,840  │ 2,650  │ 4,200  │ 8,100  │ 22,500 │              │
│  │ Throughput   │ 45 MB/s│ 82 MB/s│ 125MB/s│ 310MB/s│ 820MB/s│              │
│  └──────────────┴────────┴────────┴────────┴────────┴────────┘              │
│                                                                               │
│  OUTLIER ANALYSIS:                                                           │
│  ⚠ 3 spike events detected and excluded from sizing:                        │
│    • Mon/Wed/Fri 02:00-03:30: CHECKDB + Backup (avg 18,500 IOPS)           │
│    • Daily 23:00-23:15: Index statistics update (avg 8,200 IOPS)            │
│    • Tue 01:00-02:00: Weekly index rebuild (avg 14,000 IOPS)                │
│  After exclusion: MAX drops 22,500 → 6,800 IOPS | P95 drops 4,200 → 3,600 │
│                                                                               │
│  PER-DATABASE IO DISTRIBUTION:                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ SalesDB      ████████████████████████████████░░░░░░░░░  62% │ OLTP  │   │
│  │ ReportingDB  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  22% │ RPT   │   │
│  │ AuditDB      █████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  9%  │ WRITE │   │
│  │ ConfigDB     ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  4%  │ IDLE  │   │
│  │ TempDB       ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  3%  │ OK    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  RECOMMENDATION:                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Component    │ Current (Lift-Shift)     │ Optimized                    │  │
│  ├──────────────┼──────────────────────────┼──────────────────────────────┤  │
│  │ Instance     │ db.r6i.4xlarge (16v/128G)│ db.r6i.2xlarge (8v/64G)     │  │
│  │ Storage Type │ io1                      │ gp3                          │  │
│  │ Storage Size │ 500 GB                   │ 500 GB                       │  │
│  │ IOPS         │ 10,000 (io1)             │ 5,000 (gp3, 2K extra)       │  │
│  │ Throughput   │ N/A (io1)                │ 150 MB/s (25 extra)          │  │
│  │ Multi-AZ     │ Yes                      │ Yes                          │  │
│  │ Edition      │ Standard                 │ Standard                     │  │
│  ├──────────────┼──────────────────────────┼──────────────────────────────┤  │
│  │ Monthly Cost │ $8,200                   │ $4,450                       │  │
│  │ SAVINGS      │                          │ $3,750/month (46%)           │  │
│  └──────────────┴──────────────────────────┴──────────────────────────────┘  │
│                                                                               │
│  RISK ASSESSMENT: ●●○○○ LOW                                                  │
│  • IOPS: P95 (3,600) well within gp3 provisioned (5,000). 39% headroom.    │
│  • Memory: Source 128GB → 64GB. Pressure score only 35% — not memory-bound. │
│  • CPU: P95=62% on 16 cores. On 8 vCPU = estimated ~75-80% peak. Adequate. │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 10.3 API Response Schema

```typescript
interface CostOptimizationResponse {
  meta: {
    version: string;          // "2.0.0"
    generatedAt: string;      // ISO timestamp
    uploadId: string;
    customerName: string;
    collectionPeriodDays: number;
    serverCount: number;
  };

  summary: {
    totalCurrentMonthlyCost: number;
    totalOptimizedMonthlyCost: number;
    totalMonthlySavings: number;
    totalSavingsPercent: number;
    overallConfidence: { score: number; level: 'HIGH' | 'MEDIUM' | 'LOW' };
    savingsRange: { conservative: number; expected: number; optimistic: number };
  };

  servers: Array<{
    serverName: string;
    sourceProfile: {
      cores: number;
      memoryGB: number;
      sqlEdition: string;
      sqlVersion: string;
      htStatus: string;
    };

    metrics: {
      cpu: StatisticalProfile;
      memoryPressure: StatisticalProfile;
      iops: { raw: StatisticalProfile; cleaned: StatisticalProfile };
      throughput: { raw: StatisticalProfile; cleaned: StatisticalProfile };
    };

    outlierAnalysis: {
      totalOutliers: number;
      outlierPercent: number;
      events: Array<{
        startTime: string;
        endTime: string;
        durationMinutes: number;
        peakIOPS: number;
        classification: string;
        confidence: number;
      }>;
      impact: { maxReduction: number; p95Reduction: number };
    };

    perDatabaseAnalysis: {
      databases: Array<{
        name: string;
        percentOfTotalIOPS: number;
        workloadType: string;
        readWriteRatio: number;
        avgIOSizeKB: number;
        hourlyProfile: number[];
      }>;
      tempdbAnalysis: { percentOfTotal: number; classification: string; recommendation: string };
      splitRecommendation: null | { hotDatabase: string; savings: number; confidence: number };
    };

    recommendation: {
      instance: {
        name: string;
        vcpu: number;
        ram: number;
        family: string;
        generation: number;
      };
      storage: {
        type: 'gp3' | 'io1' | 'io2';
        sizeGB: number;
        provisionedIOPS: number;
        provisionedThroughputMBps: number;
      };
      deployment: { multiAZ: boolean; edition: string };
      generationUpgrade: { recommended: boolean; savings: number };
      byolOpportunity: { applicable: boolean; savings: number };
    };

    costs: {
      current: { monthly: number; breakdown: CostBreakdown };
      optimized: { monthly: number; breakdown: CostBreakdown };
      savings: { monthly: number; annual: number; percent: number; breakdown: SavingsBreakdown };
      scenarios: {
        conservative: { monthly: number; percent: number };
        expected: { monthly: number; percent: number };
        optimistic: { monthly: number; percent: number };
      };
    };

    risk: {
      overallLevel: number;
      overallLabel: string;
      items: Array<{ category: string; level: number; description: string; mitigations: string[] }>;
    };
  }>;

  actionPlan: Array<{
    priority: number;
    serverName: string;
    action: string;
    savings: number;
    risk: string;
    implementation: string;
  }>;
}

interface CostBreakdown {
  compute: number;
  license: number;
  storage: number;
  iops: number;
  throughput: number;
  backup: number;
  total: number;
}

interface SavingsBreakdown {
  instanceRightSizing: number;
  storageOptimization: number;
  iopsRightSizing: number;
  generationUpgrade: number;
  byolOpportunity: number;
}
```


---

## 11. IMPLEMENTATION

### 11.1 New Module Architecture

```
src/
├── processors/
│   ├── ssatProcessor.js              ← MODIFY: preserve per-DB IO, add new CSV parsers
│   ├── perDatabaseProcessor.js       ← NEW: per-database IO analysis
│   └── outlierDetector.js            ← NEW: outlier detection engine
├── engines/
│   ├── rdsRecommendationEngine.js    ← MODIFY: use P95 for IOPS, accept cleaned metrics
│   ├── storageOptimizer.js           ← NEW: storage type decision engine
│   ├── instanceOptimizer.js          ← NEW: enhanced instance sizing (replaces parts of rdsRecommendationEngine)
│   └── savingsCalculator.js          ← NEW: cost calculation with scenarios
├── models/
│   ├── costModel.js                  ← NEW: pricing data, formulas, rate lookups
│   ├── instanceCatalog.js            ← NEW: full RDS instance specs
│   └── riskModel.js                  ← NEW: risk assessment logic
├── analyzers/
│   ├── workloadClassifier.js         ← NEW: OLTP/reporting/ETL/mixed classification
│   ├── tempdbAnalyzer.js             ← NEW: tempdb impact analysis
│   └── timePatternAnalyzer.js        ← NEW: time-of-day decomposition
└── output/
    ├── reportGenerator.js            ← NEW: generate formatted reports
    └── schemas/                      ← NEW: API response schemas (JSON Schema)
```

### 11.2 Key Code Changes to Existing Modules

#### ssatProcessor.js — Changes Required

```javascript
// CHANGE 1: Do NOT aggregate IO to server level. Preserve per-database breakdown.
// BEFORE (current):
function processIOData(ioRows) {
  const sampleGroups = groupBy(ioRows, 'Sample_ID');
  const iopsSeries = [];
  for (const [sampleId, rows] of Object.entries(sampleGroups)) {
    const totalIOPs = rows.reduce((sum, r) => sum + r.TotalIOPs, 0) / 60;
    iopsSeries.push(totalIOPs);
  }
  return { avg: average(iopsSeries), max: max(iopsSeries), p95: percentile(iopsSeries, 95) };
}

// AFTER (new):
function processIOData(ioRows) {
  // Still calculate server-level totals (backward compatible)
  const serverLevel = processServerLevelIO(ioRows);
  
  // NEW: Also calculate per-database breakdown
  const perDatabase = processPerDatabaseIO(ioRows);
  
  // NEW: Build time-series for outlier detection
  const timeSeries = buildIOTimeSeries(ioRows);
  
  return {
    server: serverLevel,           // {avg, max, p95} — same as before
    perDatabase: perDatabase,      // {dbName: {readIOPS, writeIOPS, ...}}
    timeSeries: timeSeries,        // [{timestamp, iops, throughput}, ...] for outlier engine
    readWriteRatio: calculateReadWriteRatio(ioRows)  // NEW
  };
}

// CHANGE 2: Parse new CSV file types (if collector enhanced)
function processWaitStats(waitRows) {
  // NEW: Parse WAITSTATS CSV
  const ioWaits = waitRows.filter(r => 
    ['PAGEIOLATCH_SH', 'PAGEIOLATCH_EX', 'WRITELOG', 'IO_COMPLETION'].includes(r.wait_type)
  );
  // Calculate delta-based wait rates
  return calculateWaitRates(ioWaits);
}

function processTempdbUsage(tempdbRows) {
  // NEW: Parse TEMPDB CSV
  return {
    userObjectsMB: calculateStats(tempdbRows.map(r => r.user_objects_MB)),
    internalObjectsMB: calculateStats(tempdbRows.map(r => r.internal_objects_MB)),
    versionStoreMB: calculateStats(tempdbRows.map(r => r.version_store_MB))
  };
}
```

#### rdsRecommendationEngine.js — Changes Required

```javascript
// CHANGE: Accept cleaned metrics instead of raw, use P95 for IOPS (not MAX)
// BEFORE:
function getRecommendations(cpuPercent, memoryPercent, iopsData, throughput, ...) {
  // Uses iopsData.max for instance IOPS capacity matching
  const requiredIOPS = iopsData.max;
  // ...
}

// AFTER:
function getRecommendations(analysisResult) {
  const {
    cpu,              // { raw, cleaned } statistical profiles
    memory,           // { raw, cleaned }
    iops,             // { raw, cleaned }
    throughput,       // { raw, cleaned }
    outlierResult,    // full outlier detection output
    perDatabase,      // per-DB analysis
    currentServer     // source server specs
  } = analysisResult;

  // KEY CHANGE: Use cleaned P95 for IOPS (not raw MAX)
  const targetIOPS = iops.cleaned.p95;        // Was: iops.raw.max
  const targetThroughput = throughput.cleaned.p95;  // Was: throughput.raw.max
  const cpuP95 = cpu.cleaned.p95;             // Same as before
  const memP95 = memory.cleaned.p95;          // Same as before

  // Run enhanced instance optimizer
  const instanceOpt = new InstanceOptimizer();
  const instanceRec = instanceOpt.recommend({
    cpuP95, memPressureP95: memP95,
    iopsP95: targetIOPS, throughputP95MBps: targetThroughput,
    currentCores: currentServer.cores,
    currentMemoryGB: currentServer.memoryGB,
    sqlEdition: currentServer.sqlEdition,
    htStatus: currentServer.htStatus
  });

  // Run storage optimizer
  const storageOpt = new StorageOptimizer();
  const storageRec = storageOpt.optimize({
    requiredIOPS: targetIOPS,
    requiredThroughputMBps: targetThroughput,
    storageSizeGB: currentServer.estimatedStorageGB || 500
  });

  // Calculate savings
  const savings = new SavingsCalculator().calculate(...);

  // Assess risk
  const risk = new RiskAssessment().assess(...);

  return { instance: instanceRec, storage: storageRec, savings, risk, outlierResult };
}
```

### 11.3 DynamoDB Schema Changes

```javascript
// CHANGE: Store additional analysis data in the compressed blob

// BEFORE (analysisGz contains):
{
  cpu: { avg, max, p95 },
  memory: { avg, max, p95 },
  iops: { avg, max, p95 },
  throughput: { avg, max, p95 },
  currentServer: { cores, memoryGB, sqlEdition, ... },
  recommendations: [...]
}

// AFTER (analysisGz contains — backward compatible, additive fields):
{
  // Existing fields (unchanged)
  cpu: { avg, max, p95 },
  memory: { avg, max, p95 },
  iops: { avg, max, p95 },
  throughput: { avg, max, p95 },
  currentServer: { cores, memoryGB, sqlEdition, ... },
  recommendations: [...],

  // NEW FIELDS
  version: "2.0",  // Schema version marker
  
  costOptimization: {
    outlierAnalysis: {
      iops: { raw: {...}, cleaned: {...}, outlierCount, outlierPercent, events: [...] },
      throughput: { raw: {...}, cleaned: {...}, ... }
    },
    perDatabaseIO: {
      databases: [{ name, percentOfTotal, workloadType, readWriteRatio, avgIOSizeKB }],
      tempdbPercent: number,
      hotDatabase: string | null
    },
    storageRecommendation: {
      type: 'gp3',
      provisionedIOPS: number,
      provisionedThroughput: number,
      monthlyCost: number,
      reasoning: string
    },
    savingsReport: {
      current: { monthly, breakdown },
      optimized: { monthly, breakdown },
      savings: { monthly, annual, percent },
      scenarios: { conservative, expected, optimistic },
      confidence: { score, level }
    },
    riskAssessment: {
      overallLevel: number,
      items: [...]
    },
    metadata: {
      collectionDays: number,
      sampleCount: number,
      analysisEngine: "v2.0",
      timestamp: string
    }
  }
}
```

### 11.4 Feature Flags for Rollout

```javascript
const FEATURE_FLAGS = {
  // Phase 1: Outlier detection (reduces over-sizing)
  ENABLE_OUTLIER_DETECTION: true,
  USE_P95_FOR_IOPS: true,        // false = use MAX (current behavior)
  
  // Phase 2: Per-database analysis
  ENABLE_PER_DB_ANALYSIS: true,
  ENABLE_SPLIT_RECOMMENDATIONS: false,  // Phase 2b
  
  // Phase 3: Enhanced cost model
  ENABLE_COST_OPTIMIZATION_REPORT: true,
  ENABLE_SAVINGS_SCENARIOS: true,
  ENABLE_RISK_ASSESSMENT: true,
  ENABLE_BYOL_RECOMMENDATIONS: true,
  
  // Phase 4: Collector enhancements (requires customer re-collection)
  ENABLE_WAIT_STATS_ANALYSIS: false,
  ENABLE_TEMPDB_ANALYSIS: false,
  ENABLE_LATENCY_ANALYSIS: false,
  
  // Safeguards
  OUTLIER_FALLBACK_TO_RAW: true,  // If outlier detection fails, fall back to current behavior
  MAX_OUTLIER_PERCENT_BEFORE_FALLBACK: 15,
  CONFIDENCE_THRESHOLD_FOR_DISPLAY: 50  // Don't show cost report if confidence < 50%
};
```

### 11.5 Migration Path (Backward Compatibility)

```javascript
function processUpload(files, featureFlags) {
  // Step 1: Always run existing pipeline (backward compatible)
  const legacyResult = legacyProcessor.process(files);
  
  // Step 2: If feature flags enabled, run enhanced pipeline
  let enhancedResult = null;
  if (featureFlags.ENABLE_OUTLIER_DETECTION || featureFlags.ENABLE_PER_DB_ANALYSIS) {
    try {
      enhancedResult = enhancedProcessor.process(files, featureFlags);
    } catch (error) {
      // Fallback to legacy result if enhanced pipeline fails
      console.error('Enhanced pipeline failed, using legacy:', error);
      enhancedResult = null;
    }
  }
  
  // Step 3: Merge results (enhanced augments legacy, never replaces)
  const finalResult = {
    ...legacyResult,
    ...(enhancedResult ? { costOptimization: enhancedResult } : {})
  };
  
  // Step 4: Persist (DynamoDB schema is additive — old clients ignore new fields)
  await persistAnalysis(finalResult);
  
  return finalResult;
}
```


---

## 12. COLLECTOR ENHANCEMENTS

### 12.1 Enhanced Collector v2 — New Data Points

#### Priority 1: Per-File IO Stats (Critical for per-DB analysis)

```powershell
# ADD TO SSATcollector.ps1 — New collection: IO_FILESTATS
# Captures per-database, per-file IO with latency data
# Interval: Every 60 seconds (same as existing IO collection)

$FileStatsQuery = @"
SELECT
    DB_NAME(vfs.database_id) AS DBName,
    vfs.database_id,
    vfs.file_id,
    mf.type_desc AS file_type,  -- 'ROWS' or 'LOG'
    mf.name AS logical_name,
    vfs.num_of_reads,
    vfs.num_of_bytes_read,
    vfs.io_stall_read_ms,
    vfs.num_of_writes,
    vfs.num_of_bytes_written,
    vfs.io_stall_write_ms,
    vfs.size_on_disk_bytes,
    GETDATE() AS CollectionTime
FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
JOIN sys.master_files mf ON vfs.database_id = mf.database_id AND vfs.file_id = mf.file_id
WHERE vfs.database_id > 4  -- Exclude system DBs (keep tempdb=2 as option)
   OR vfs.database_id = 2  -- Include tempdb for tempdb analysis
"@

# DELTA CALCULATION: Values are cumulative since restart.
# Store current snapshot; processor calculates deltas between consecutive snapshots.
# Output: *_FILESTATS_*.csv
```

**CSV Schema: FILESTATS**
| Column | Type | Description |
|--------|------|-------------|
| DBName | string | Database name |
| database_id | int | Database ID |
| file_id | int | File ID within database |
| file_type | string | 'ROWS' or 'LOG' |
| logical_name | string | Logical file name |
| num_of_reads | bigint | Cumulative reads (snapshot) |
| num_of_bytes_read | bigint | Cumulative bytes read |
| io_stall_read_ms | bigint | Cumulative read wait time |
| num_of_writes | bigint | Cumulative writes |
| num_of_bytes_written | bigint | Cumulative bytes written |
| io_stall_write_ms | bigint | Cumulative write wait time |
| size_on_disk_bytes | bigint | File size (detect autogrowth) |
| CollectionTime | datetime | Sample timestamp |

#### Priority 2: Wait Statistics

```powershell
# ADD TO SSATcollector.ps1 — New collection: WAITSTATS
# Interval: Every 60 seconds

$WaitStatsQuery = @"
SELECT
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    signal_wait_time_ms,
    GETDATE() AS CollectionTime
FROM sys.dm_os_wait_stats
WHERE wait_type IN (
    'PAGEIOLATCH_SH', 'PAGEIOLATCH_EX', 'PAGEIOLATCH_UP',
    'WRITELOG', 'IO_COMPLETION', 'ASYNC_IO_COMPLETION',
    'BACKUPIO', 'SLEEP_BPOOL_FLUSH',
    'SOS_SCHEDULER_YIELD', 'CXPACKET', 'CXCONSUMER',
    'LATCH_EX', 'LATCH_SH',
    'LCK_M_S', 'LCK_M_X', 'LCK_M_U',
    'MEMORY_ALLOCATION_EXT', 'RESOURCE_SEMAPHORE'
)
AND waiting_tasks_count > 0
"@
```

**CSV Schema: WAITSTATS**
| Column | Type | Description |
|--------|------|-------------|
| wait_type | string | Wait type name |
| waiting_tasks_count | bigint | Cumulative count |
| wait_time_ms | bigint | Cumulative wait time |
| signal_wait_time_ms | bigint | Cumulative signal wait |
| CollectionTime | datetime | Sample timestamp |

#### Priority 3: TempDB Usage

```powershell
# ADD TO SSATcollector.ps1 — New collection: TEMPDB
# Interval: Every 60 seconds

$TempdbQuery = @"
USE tempdb;
SELECT
    SUM(user_object_reserved_page_count) * 8 / 1024 AS user_objects_MB,
    SUM(internal_object_reserved_page_count) * 8 / 1024 AS internal_objects_MB,
    SUM(version_store_reserved_page_count) * 8 / 1024 AS version_store_MB,
    SUM(unallocated_extent_page_count) * 8 / 1024 AS free_space_MB,
    (SELECT cntr_value FROM sys.dm_os_performance_counters 
     WHERE counter_name = 'Version Store Size (KB)' 
     AND instance_name = '') / 1024 AS version_store_size_MB,
    GETDATE() AS CollectionTime
FROM sys.dm_db_file_space_usage;
"@
```

#### Priority 4: Database Sizes (One-Time Capture)

```powershell
# ADD TO SSATcollector.ps1 — New collection: DBSIZES
# Interval: Once at start of collection (or daily)

$DbSizesQuery = @"
SELECT
    DB_NAME(database_id) AS DBName,
    database_id,
    type_desc,
    SUM(size) * 8 / 1024 AS size_MB,
    SUM(FILEPROPERTY(name, 'SpaceUsed')) * 8 / 1024 AS used_MB,
    GETDATE() AS CollectionTime
FROM sys.master_files
WHERE database_id > 4
GROUP BY database_id, type_desc
"@
```

#### Priority 5: Performance Counters

```powershell
# ADD TO SSATcollector.ps1 — New collection: PERFCOUNTERS
# Interval: Every 60 seconds

$PerfCountersQuery = @"
SELECT
    object_name,
    counter_name,
    instance_name,
    cntr_value,
    GETDATE() AS CollectionTime
FROM sys.dm_os_performance_counters
WHERE counter_name IN (
    'Page life expectancy',
    'Checkpoint pages/sec',
    'Background writer pages/sec',
    'Lazy writes/sec',
    'Free list stalls/sec',
    'Page reads/sec',
    'Page writes/sec',
    'Buffer cache hit ratio',
    'Buffer cache hit ratio base',
    'Batch Requests/sec',
    'SQL Compilations/sec',
    'SQL Re-Compilations/sec',
    'Total Server Memory (KB)',
    'Target Server Memory (KB)'
)
"@
```

### 12.2 Collector Version Compatibility

```javascript
// Processor must handle both v1 (existing) and v2 (enhanced) collector output

function detectCollectorVersion(files) {
  const hasFileStats = files.some(f => f.name.includes('_FILESTATS_'));
  const hasWaitStats = files.some(f => f.name.includes('_WAITSTATS_'));
  const hasTempdb = files.some(f => f.name.includes('_TEMPDB_'));
  const hasDbSizes = files.some(f => f.name.includes('_DBSIZES_'));
  
  if (hasFileStats && hasWaitStats && hasTempdb) return 'v2-full';
  if (hasFileStats) return 'v2-partial';
  return 'v1';  // Original collector — use existing IO CSV for per-DB (already has DBName!)
}

function processBasedOnVersion(files, version) {
  switch (version) {
    case 'v1':
      // Use existing IO CSV — it already has per-DB data (DBName field)!
      // The per-DB info is there, it was just being aggregated away
      return {
        perDbAvailable: true,   // From existing IO CSV
        latencyAvailable: false, // Not in v1
        waitStatsAvailable: false,
        tempdbDetailAvailable: false,
        note: 'Per-DB IOPS available from existing IO CSV. Latency/waits require collector v2.'
      };
    
    case 'v2-partial':
      return {
        perDbAvailable: true,
        latencyAvailable: true,  // From FILESTATS io_stall columns
        waitStatsAvailable: false,
        tempdbDetailAvailable: false
      };
    
    case 'v2-full':
      return {
        perDbAvailable: true,
        latencyAvailable: true,
        waitStatsAvailable: true,
        tempdbDetailAvailable: true
      };
  }
}
```

### 12.3 CRITICAL INSIGHT: Per-DB Analysis Available TODAY

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ⚠️  IMPORTANT: The existing IO CSV already contains per-database data!      │
│                                                                               │
│  The current collector captures: DBName, Read, Written, BRead, BWritten      │
│  per database per sample. This data is DISCARDED during processing           │
│  (aggregated to server totals in ssatProcessor.js).                          │
│                                                                               │
│  FIX: Simply STOP aggregating in ssatProcessor.js and preserve per-DB.       │
│  NO COLLECTOR CHANGE NEEDED for basic per-database IOPS analysis.            │
│                                                                               │
│  What requires collector v2:                                                  │
│  - IO latency (needs io_stall_ms columns — not in current CSV)              │
│  - Data vs Log file separation (needs file_type column)                      │
│  - Wait statistics (entirely new DMV)                                        │
│  - TempDB space breakdown (entirely new DMV)                                 │
│  - Autogrowth detection (needs size_on_disk_bytes tracking)                  │
│                                                                               │
│  PHASED APPROACH:                                                             │
│  Phase 1: Use existing IO CSV for per-DB analysis (code change only)         │
│  Phase 2: Deploy collector v2 for latency, waits, tempdb detail              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 12.4 Data Volume Estimates

| Collection | Rows/minute | Rows/day | 7-day CSV Size | 14-day CSV Size |
|-----------|------------|----------|----------------|-----------------|
| CPU (existing) | 1 | 1,440 | ~100 KB | ~200 KB |
| MEM (existing) | 1 | 1,440 | ~200 KB | ~400 KB |
| IO (existing) | N databases | 14,400 (10 DBs) | ~2 MB | ~4 MB |
| CPUINFO (existing) | 1 (once) | 1 | <1 KB | <1 KB |
| FILESTATS (new) | N files | 28,800 (20 files) | ~4 MB | ~8 MB |
| WAITSTATS (new) | ~15 rows | 21,600 | ~2 MB | ~4 MB |
| TEMPDB (new) | 1 | 1,440 | ~100 KB | ~200 KB |
| DBSIZES (new) | N databases (daily) | 10 | <10 KB | <10 KB |
| PERFCOUNTERS (new) | ~15 rows | 21,600 | ~2 MB | ~4 MB |
| **TOTAL** | | | **~10 MB** | **~21 MB** |

ZIP compression reduces this to approximately 1-3 MB upload for a 14-day collection with 10 databases.

### 12.5 Existing IO CSV — Hidden Treasure

The current IO CSV already gives us what we need for Phase 1:

```csv
Sample_ID,Database_ID,DBName,Read,Written,BRead,BWritten,TotalB,TotalIOPs,Throuput,Netpackets,CollectionTime
1,5,SalesDB,450,120,3686400,983040,4669440,570,0,0,2026-07-01 08:00:00
1,6,ReportingDB,200,10,13107200,81920,13189120,210,0,0,2026-07-01 08:00:00
1,7,AuditDB,5,85,40960,696320,737280,90,0,0,2026-07-01 08:00:00
2,5,SalesDB,480,130,3932160,1064960,4997120,610,0,0,2026-07-01 08:01:00
2,6,ReportingDB,180,8,11796480,65536,11862016,188,0,0,2026-07-01 08:01:00
2,7,AuditDB,3,90,24576,737280,761856,93,0,0,2026-07-01 08:01:00
```

From this EXISTING data, without any collector changes, we can derive:
- Per-database IOPS (Read + Written / 60)
- Per-database throughput ((BRead + BWritten) / 60 / 1048576)
- Read/Write ratio per database
- Average IO size per database (BRead+BWritten / Read+Written)
- Percentage of total IO per database
- Hourly profile per database
- Hot database detection
- Workload classification per database

**The only code change needed is in `ssatProcessor.js` — stop discarding the per-DB breakdown.**

---

## APPENDIX A: IMPLEMENTATION PRIORITY & TIMELINE

| Phase | Scope | Effort | Impact | Dependencies |
|-------|-------|--------|--------|-------------|
| **1a** | Stop aggregating per-DB IO in processor | 1 day | HIGH | None — code change only |
| **1b** | Outlier detection engine | 3-5 days | HIGH | None |
| **1c** | Switch IOPS sizing from MAX to cleaned P95 | 1 day | HIGH | Phase 1b |
| **2a** | Storage optimizer (gp3/io1/io2 decision) | 2-3 days | HIGH | None |
| **2b** | Savings calculator with scenarios | 2-3 days | MEDIUM | Phase 2a |
| **2c** | Risk assessment model | 2 days | MEDIUM | Phase 1c |
| **3a** | Enhanced cost optimization report UI | 3-5 days | HIGH | Phases 2a-2c |
| **3b** | Per-database visualization | 2-3 days | MEDIUM | Phase 1a |
| **3c** | API schema + export formats | 2 days | LOW | Phase 3a |
| **4a** | Collector v2: FILESTATS | 2 days | MEDIUM | Customer re-collection |
| **4b** | Collector v2: WAITSTATS + TEMPDB | 2 days | MEDIUM | Customer re-collection |
| **4c** | Latency-based analysis | 2-3 days | MEDIUM | Phase 4a |
| **5** | Instance split/consolidation recommendations | 3-5 days | HIGH | Phase 1a + customer validation |

**Total estimated effort:** 25-38 days for full implementation  
**Phase 1 alone (highest ROI):** 5-7 days — delivers outlier detection + per-DB analysis + P95-based sizing

---

## APPENDIX B: KEY METRICS — BEFORE vs AFTER

| Aspect | Current System | Enhanced System |
|--------|---------------|-----------------|
| IOPS sizing metric | Raw MAX (single spike) | Cleaned P95 (outliers removed) |
| Typical over-provisioning | 2-5x actual need | 1.2x actual need (20% headroom) |
| Storage type logic | Simple threshold (16K/64K) | Cost-optimized comparison |
| Per-DB visibility | None (aggregated away) | Full breakdown with classification |
| Savings estimate | Not provided | Conservative/Expected/Optimistic ranges |
| Confidence score | None | Data-quality-based scoring |
| Risk assessment | None | 5-level model with mitigations |
| Workload classification | None | OLTP/Reporting/ETL/Mixed/Idle |
| Time pattern awareness | None | Hourly profiles, maintenance windows |
| tempdb impact | Hidden in totals | Separated with optimization guidance |
| Cost model components | Compute only | Compute + Storage + IOPS + Throughput + Extras |
| Collection coverage | 4 CSVs | 4 existing + 5 new (optional) |
