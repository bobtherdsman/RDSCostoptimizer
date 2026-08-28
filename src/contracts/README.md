# Data Contracts

These contracts define the standalone Cost Optimization build boundary. They are intentionally independent from SSATWeb sizing logic.

## CurrentRdsConfig

The current RDS configuration is required to calculate actual current cost and validate legal target recommendations.

Required fields:
- `region`
- `instanceClass`
- `sqlServerEdition`
- `sqlServerVersion`
- `licenseModel`
- `storageType`
- `allocatedStorageGb`
- `multiAz`

Optional fields:
- `provisionedIops`
- `provisionedThroughputMbps`

## WorkloadProfile

The workload profile is derived from uploaded collector output. It must preserve both instance-level distributions and database-level attribution.

Required instance-level metrics:
- CPU percentage distribution
- IOPS distribution
- throughput distribution
- collection duration

Optional instance-level metrics:
- memory pressure distribution
- Page Life Expectancy distribution
- total database size

Required DB-level shape:
- database name
- IOPS distribution when available
- throughput distribution when available
- size when available
- tempdb share when available

DB-level CPU and memory attribution must be advisory only. They cannot be the sole basis for a recommendation.

## OptimizationResult

The optimizer result must make unsafe recommendations impossible to hide. If no valid optimized target exists, return a blocked result with blocker reasons.

Required output concepts:
- current config
- optional recommended config
- risk
- blockers
- top offending databases
- passed checks

Customer-facing cost fields are optional until pricing is verified by the cost harness.

## Fixture Envelope

Fixtures use this envelope:

```json
{
  "name": "case-name",
  "description": "What the fixture proves",
  "currentConfig": {},
  "workload": {},
  "expected": {
    "outcome": "recommendation | blocked",
    "primaryBlocker": "memory | iops | throughput | edition | orderability | storage | pricing | null",
    "topDatabase": "database name or null"
  }
}
```
## Single-Server And Multi-Server Uploads

Uploads may contain one server or multiple servers. The contracts support both:

- `ServerWorkloadInput` wraps one server name, current RDS config, and normalized workload profile.
- `OptimizationBatchInput` contains one or more `ServerWorkloadInput` objects.
- `OptimizationBatchResult` contains one `OptimizationResult` per server.

All optimization decisions are per-server first. Fleet summaries can aggregate savings and blockers, but must not hide individual server failures or database-level offenders.