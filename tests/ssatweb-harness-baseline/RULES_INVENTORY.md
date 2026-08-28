# Engine Rule Inventory (extracted from lib/rdsRecommendationEngine.js source)
# Each rule maps to a harness oracle in test/validateSizing.js, or is marked UNVERIFIED.

## A. INSTANCE VALIDITY
- R1: Recommended instance must be a real AWS instance type (family+size resolvable).            → Oracle A
- R2: Recommended instance's memory ≥ source server memory.                                       → Oracle C
- R3: Recommended instance's AWS IOPS ≥ workload IOPS (p95||max).                                  → Oracle D
- R4: Recommended instance's AWS throughput ≥ workload throughput (p95||max).                      → Oracle E
- R5: Recommended vCPU ≥ post-scaling CPU target.                                                  → Oracle B

## B. EDITION FIXED INSTANCES (engine lines 98-114)
- R6: Express Edition → always db.t3.xlarge.                                                       → Oracle F
- R7: Developer Edition → db.r8i.xlarge if version starts "16", else db.r6i.xlarge.                → Oracle F

## C. EDITION CAPS (engine lines 181-186, 355-372)
- R8: Web Edition → vCPU ≤ 16 (4xlarge cap).                                                       → Oracle G
- R9: Standard Edition → physical cores ≤ 24.                                                      → Oracle G
- R10: Enterprise → no vCPU cap.                                                                   → Oracle G (implicit: never flagged)

## D. x2 GATING (engine lines 188-197, BUG-027; verified RDS describe-orderable)
- R11: x2m/x2iedn only on Enterprise/Standard (never Web/Express).                                 → Oracle H
- R12: Standard Edition caps x2 at 8xlarge.                                                        → Oracle I
- R13: Enterprise allows x2 up to 32xlarge.                                                        → Oracle I (SE-only check; EE unrestricted = no flag)

## E. FAMILY / GENERATION PREFERENCE
- R14: General-purpose (ratio≤4) → highest-gen m-family (m8i). Memory-opt (ratio>4) → highest-gen r (r8i). → Oracle M (m7i/r7i/m6i/r6i flagged if m8i/r8i fit)
- R15: x2m preferred over x2iedn (identical specs, ~50% licensing savings) unless x2m unavailable. → Oracle M (M-X2PREF)

## F. STORAGE TYPE (engine getStorageType, lines ~)
- R16: ebsType = io2 if IOPS>80000 OR throughput>2000 MB/s, else gp3.                              → Oracle J

## G. FALLBACK / WARNING BEHAVIOR
- R17: If workload can't be met within edition cap, pick largest-valid + WARNING note.             → Oracle L + edLimitFlagged
- R18: If pick under-provisions (mem/IOPS/tput below need), a WARNING must be present.             → Oracle L
- R19: x2iedn is an acceptable fallback ONLY when x2m absent at that size.                          → Oracle M exemption (awsSpecs('x2m',size) undefined)

## H. VERSION
- R20: Source SQL < v14 (2017) must note version upgrade (RDS floor).                              → Oracle N

## I. EFFICIENCY
- R21: No smaller size in the SAME family also meets CPU+mem+IOPS+tput (not over-provisioned).     → Oracle K

## POTENTIALLY UNVERIFIED — AUDIT RESULTS (evidence-based):
- U1: HT adjustment → ✅ COVERED. deriveTargetVcpu line 170 applies htStatus==='ON'?ceil(cores/2). Oracle B is HT-aware.
- U2: Estimated-cores string → ✅ NOT TRIGGERED. 0/74 samples have string cores (proven). deriveTargetVcpu would need Number() guard if it ever occurs — LATENT, add guard.
- U3: getLiftAndShiftSize ratio matrix → ✅ COVERED end-to-end. Harness liftAndShiftSize mirrors it; B/C/D/E validate the end-state instance.
- U4: 48xlarge sizes → ✅ COVERED. SIZE_ORDER, awsSpecs, VCPU, CORES tables all include 48xlarge.
- U5: ALTERNATIVES (non-primary cards) → ❌ REAL GAP. Harness validates only primary (line 206: isPrimary||[0]). rec[1..] unvalidated.
- U6: EC2 path → ❌ GAP (accepted). Harness runs 'RDS' only; SSATWeb is RDS-focused. Low priority.

## REMEDIATION — RESOLVED:
- GAP-1 (U5 alternatives): ✅ CLOSED. Harness ALT pass now validates every non-primary card against A,B(CPU),C,D,E,H,I,J (140 alt cards checked). Found real bug → BUG-039.
- Audit Finding 1 (family role): ✅ CLOSED. Oracle O added (role vs ratio, guarded against legit memory-driven switches). Found real issue → BUG-040.
- Audit Finding 2 (SE cap semantics): ✅ CLOSED as detection. Oracle G (24 physical cores=12xlarge) is authoritative-correct; engine over-caps SE to 4xlarge → logged BUG-039.
- Audit Finding 3 (ALT CPU floor): ✅ CLOSED. ALT:B-CPU check added.
- GAP-2 (U2 estimated cores): LATENT, 0/74 trigger. deriveTargetVcpu Number() guard still advisable.
- GAP-3/Finding 4 (EC2 + estimate path): OUT OF SCOPE (SSATWeb=RDS; no estimate-only samples). Documented, not covered.

## FINAL ORACLE SET (15): A,B,C,D,E,F,G,H,I,J,K,L,M,N,O + ALT pass (A,B,C,D,E,H,I,J per card).
## KNOWN OPEN BUGS mapped to harness: BUG-036(N), BUG-038(M-X2PREF), BUG-039(ALT:B-CPU), BUG-040(O-ROLE).
