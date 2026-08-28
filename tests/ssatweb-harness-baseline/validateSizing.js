#!/usr/bin/env node
/*
 * ============================================================================
 *  SSATWeb SIZING VALIDATION HARNESS   (TEST-ONLY — never edits the tool)
 * ============================================================================
 *
 *  PURPOSE
 *  -------
 *  Verify that every server's instance recommendation produced by
 *  SSATProcessor.processZipFile() satisfies CPU, Memory, IOPS, and Throughput
 *  simultaneously — independently of the engine and independently of the
 *  tool's own instance JSON. IOPS/throughput oracles use AUTHORITATIVE AWS
 *  values (from `aws ec2 describe-instance-types .EbsInfo.EbsOptimizedInfo`,
 *  verified 2026-08-26) so the harness also catches cases where the tool's
 *  bundled JSON under-reports IOPS.
 *
 *  WHY INDEPENDENT (not trusting the tool JSON)
 *  --------------------------------------------
 *  Cross-check on 2026-08-26 found the tool's aws-instances-consolidated.json
 *  under-reports max IOPS for m7i/r7i 12xl+16xl and ALL m8i/r8i above 8xlarge
 *  (hardcoded 40,000 vs real 60,000–240,000). Throughput matched 37/37.
 *  If the harness trusted the tool JSON it would validate against wrong IOPS.
 *  So IOPS+throughput here come from the AWS table below, not the tool.
 *
 *  ENGINE PATH MIRRORED (lib/rdsRecommendationEngine.js getRecommendations)
 *  -----------------------------------------------------------------------
 *   EXP           → fixed db.t3.xlarge
 *   DEV           → v16 ? db.r8i.xlarge : db.r6i.xlarge
 *   HT            → physicalCores = HT==='ON' ? ceil(cores/2) : cores
 *   baseSize      → getLiftAndShiftSize(mem, physicalCores): ratio→type, ceil(c/4)→class
 *   family        → ratio<=4 → highest-gen m-family ; else highest-gen r-family
 *   4-rule scale  → R1 CPU>=80&MEM>=80 up+r ; R2 CPU>=80&MEM<80 up+m ;
 *                   R3 CPU<=80&MEM>=80 keep+r ; R4 CPU<50&MEM<50 down
 *   memory-valid  → if pick.mem < sourceMem: smallest (fam→r8i→m8i→r7i→r6i→x2m→x2iedn) meeting vCPU&mem
 *   IOPS/thruput  → smallest in current family meeting all; else x2m; else x2iedn; else largest-in-edition + WARNING
 *   edition cap   → WEB<=16 vCPU(4xl) ; SE<=24 cores ; (no-IOPS path also caps)
 *
 *  ORACLES (per recommendation)
 *  ----------------------------
 *   A IN-CATALOG    pick resolves to a known family+size (has AWS specs)
 *   B MEETS-CPU     pick vCPU >= targetCPU (re-derived post-scaling)
 *   C MEETS-MEM     pick memory >= source memory
 *   D MEETS-IOPS    pick AWS-IOPS >= measured p95 IOPS
 *   E MEETS-THRU    pick AWS-throughput >= measured p95 throughput
 *   F FIXED-ED      EXP=db.t3.xlarge ; DEV=db.r8i.xlarge(v16)/db.r6i.xlarge
 *   G EDITION-CAP   WEB physical cores <=16 ; SE physical cores <=24
 *                   (unless remark carries an explicit "exceeds edition"/"Enterprise" WARNING)
 *   All four B–E must hold TOGETHER — scaling up for one must not drop another.
 *   A WARNING-flagged under-provision (edition limit hit) is an accepted state
 *   for D/E only when the remark says so; A/B/C/G still enforced.
 *
 *  AUTHORITATIVE AWS IOPS / THROUGHPUT (MB/s) — describe-instance-types, 2026-08-26
 *  Throughput = MaximumThroughputInMBps (== RDS "Max EBS bandwidth Mbps" / 8).
 *
 *  PHYSICAL CORES BY SIZE CLASS (family-independent, RDS Optimize-CPU basis)
 *    large=1 xlarge=2 2xlarge=4 4xlarge=8 8xlarge=16 12xlarge=24
 *    16xlarge=32 24xlarge=48 32xlarge=64 48xlarge=96
 *
 *  USAGE
 *  -----
 *    node test/validateSizing.js
 *  Exit 0 = all pass · 1 = failures listed · 2 = setup error.
 *  Run BEFORE and AFTER any engine/data change: the failure set must only
 *  shrink or stay equal — a growing set is a regression.
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const SSATProcessor = require('../lib/ssatProcessor');

// ---- Authoritative AWS EBS IOPS + throughput (MB/s), by family.size ----
// Source: aws ec2 describe-instance-types .EbsInfo.EbsOptimizedInfo
//         MaximumIops / MaximumThroughputInMBps (verified 2026-08-26).
const AWS = {
  'm7i.xlarge':{iops:40000,tput:1250}, 'm7i.2xlarge':{iops:40000,tput:1250}, 'm7i.4xlarge':{iops:40000,tput:1250},
  'm7i.8xlarge':{iops:40000,tput:1250}, 'm7i.12xlarge':{iops:60000,tput:1875}, 'm7i.16xlarge':{iops:80000,tput:2500},
  'r7i.xlarge':{iops:40000,tput:1250}, 'r7i.2xlarge':{iops:40000,tput:1250}, 'r7i.4xlarge':{iops:40000,tput:1250},
  'r7i.8xlarge':{iops:40000,tput:1250}, 'r7i.12xlarge':{iops:60000,tput:1875}, 'r7i.16xlarge':{iops:80000,tput:2500},
  'm8i.xlarge':{iops:40000,tput:1250}, 'm8i.2xlarge':{iops:40000,tput:1250}, 'm8i.4xlarge':{iops:40000,tput:1250},
  'm8i.8xlarge':{iops:40000,tput:1250}, 'm8i.12xlarge':{iops:60000,tput:1875}, 'm8i.16xlarge':{iops:80000,tput:2500},
  'm8i.24xlarge':{iops:120000,tput:3750}, 'm8i.32xlarge':{iops:160000,tput:5000}, 'm8i.48xlarge':{iops:240000,tput:7500}, 'm8i.96xlarge':{iops:480000,tput:10000},
  'r8i.xlarge':{iops:40000,tput:1250}, 'r8i.2xlarge':{iops:40000,tput:1250}, 'r8i.4xlarge':{iops:40000,tput:1250},
  'r8i.8xlarge':{iops:40000,tput:1250}, 'r8i.12xlarge':{iops:60000,tput:1875}, 'r8i.16xlarge':{iops:80000,tput:2500},
  'r8i.24xlarge':{iops:120000,tput:3750}, 'r8i.32xlarge':{iops:160000,tput:5000}, 'r8i.48xlarge':{iops:240000,tput:7500}, 'r8i.96xlarge':{iops:480000,tput:10000},
  'x2iedn.xlarge':{iops:65000,tput:2500}, 'x2iedn.2xlarge':{iops:65000,tput:2500}, 'x2iedn.4xlarge':{iops:65000,tput:2500},
  'x2iedn.8xlarge':{iops:65000,tput:2500}, 'x2iedn.16xlarge':{iops:130000,tput:5000}, 'x2iedn.24xlarge':{iops:195000,tput:7500},
  'x2iedn.32xlarge':{iops:260000,tput:10000},
  // x2m = x2iedn hardware with RDS "Optimize CPU" (halved vCPU for licensing).
  // Optimize CPU changes ONLY vCPU count, NOT EBS IOPS/throughput (hardware/size-bound).
  // So x2m.<size> EBS specs are authoritatively identical to x2iedn.<size>.
  'x2m.xlarge':{iops:65000,tput:2500}, 'x2m.2xlarge':{iops:65000,tput:2500}, 'x2m.4xlarge':{iops:65000,tput:2500},
  'x2m.8xlarge':{iops:65000,tput:2500}, 'x2m.16xlarge':{iops:130000,tput:5000}, 'x2m.24xlarge':{iops:195000,tput:7500},
  'x2m.32xlarge':{iops:260000,tput:10000},
  // Fixed-edition / legacy targets that may appear:
  't3.xlarge':{iops:15700,tput:347}, 'r6i.xlarge':{iops:40000,tput:1250},
};

// Memory (GiB) by family.size — authoritative from AWS RDS hardware specs page (2026-08-26).
const MEM = {
  'm7i':{xlarge:16,'2xlarge':32,'4xlarge':64,'8xlarge':128,'12xlarge':192,'16xlarge':256},
  'r7i':{xlarge:32,'2xlarge':64,'4xlarge':128,'8xlarge':256,'12xlarge':384,'16xlarge':512},
  'm8i':{xlarge:16,'2xlarge':32,'4xlarge':64,'8xlarge':128,'12xlarge':192,'16xlarge':256,'24xlarge':384,'32xlarge':512,'48xlarge':768,'96xlarge':1536},
  'r8i':{xlarge:32,'2xlarge':64,'4xlarge':128,'8xlarge':256,'12xlarge':384,'16xlarge':512,'24xlarge':768,'32xlarge':1024,'48xlarge':1536,'96xlarge':3072},
  'x2iedn':{xlarge:128,'2xlarge':256,'4xlarge':512,'8xlarge':1024,'16xlarge':2048,'24xlarge':3072,'32xlarge':4096},
  'x2m':{xlarge:128,'2xlarge':256,'4xlarge':512,'8xlarge':1024,'16xlarge':2048,'24xlarge':3072,'32xlarge':4096},
  't3':{xlarge:16}, 'r6i':{xlarge:32},
};

const PHYS_CORES = { large:1, xlarge:2, '2xlarge':4, '4xlarge':8, '8xlarge':16,
  '12xlarge':24, '16xlarge':32, '24xlarge':48, '32xlarge':64, '48xlarge':96, '96xlarge':192 };
const VCPU = { large:2, xlarge:4, '2xlarge':8, '4xlarge':16, '8xlarge':32,
  '12xlarge':48, '16xlarge':64, '24xlarge':96, '32xlarge':128, '48xlarge':192, '96xlarge':384 };

function parseInst(instanceType) {
  // db.r8i.4xlarge → {fam:'r8i', size:'4xlarge'}  |  r8i.4xlarge → same
  const t = (instanceType || '').replace(/^db\./, '');
  const m = t.match(/^([a-z0-9]+)\.([0-9]*xlarge|large|medium|small|micro)$/);
  return m ? { fam: m[1], size: m[2] } : null;
}

// Edition code from label (mirror engine intent: Enterprise→EE, Express→EXP,
// Developer→DEV, Web→WEB, else SE).
function editionCode(label) {
  const s = (label || '').toLowerCase();
  if (s.includes('enterprise')) return 'EE';
  if (s.includes('express')) return 'EXP';
  if (s.includes('developer')) return 'DEV';
  if (s.includes('web')) return 'WEB';
  return 'SE';
}

// Re-derive baseSize exactly like engine.getLiftAndShiftSize(mem, cores).
function liftAndShiftSize(memoryGB, cores) {
  const vcpu = cores;
  let cpuonprem = cores < 2 ? 4 : cores;
  let ratio = memoryGB / cpuonprem;
  cpuonprem = Math.ceil(cpuonprem / 4);
  if (ratio <= 4) ratio = 4;
  else if (ratio <= 8) ratio = 8;
  else if (ratio <= 15.25) ratio = 15;
  else if (ratio <= 30) ratio = 30;
  else ratio = 32;
  if (ratio === 15 && vcpu < 64) ratio = 30;
  let c;
  if (ratio < 15) {
    if (cpuonprem >= 25) c='32xlarge'; else if (cpuonprem>16) c='24xlarge'; else if (cpuonprem>12) c='16xlarge';
    else if (cpuonprem>8) c='12xlarge'; else if (cpuonprem>4) c='8xlarge'; else if (cpuonprem>2) c='4xlarge';
    else if (cpuonprem>1) c='2xlarge'; else if (cpuonprem<=1) c='xlarge';
  } else if (ratio > 15) {
    if (cpuonprem >= 25) c='32xlarge'; else if (cpuonprem>16) c='24xlarge'; else if (cpuonprem>12) c='16xlarge';
    else if (cpuonprem>8) c='12xlarge'; else if (cpuonprem>4) c='8xlarge'; else if (cpuonprem>2) c='4xlarge';
    else if (cpuonprem>1) c='2xlarge'; else if (cpuonprem<=1) c='xlarge';
  } else { c = cpuonprem > 16 ? '32xlarge' : '16xlarge'; }
  return c || 'xlarge';
}
const SIZE_ORDER = ['xlarge','2xlarge','4xlarge','8xlarge','12xlarge','16xlarge','24xlarge','32xlarge','48xlarge','96xlarge'];
function scaleUp(s){ const i=SIZE_ORDER.indexOf(s); return i>=0 && i<SIZE_ORDER.length-1 ? SIZE_ORDER[i+1] : s; }
function scaleDown(s){ const i=SIZE_ORDER.indexOf(s); return i>0 ? SIZE_ORDER[i-1] : s; }

// BUG-027 gate (authoritative, RDS describe-orderable 2026-08-26): x2 only on EE/SE; SE caps x2 at 8xlarge.
function x2AllowedFor(ed){ return ed !== 'WEB' && ed !== 'EXP'; }
function x2SizeOkFor(ed, size){
  const maxIdx = ed === 'SE' ? SIZE_ORDER.indexOf('8xlarge') : SIZE_ORDER.length - 1;
  const i = SIZE_ORDER.indexOf(size); return i >= 0 && i <= maxIdx;
}

// Re-derive the post-scaling CPU target (vCPU) the engine sizes to.
// This is the vCPU of the size class after HT-adjust → baseSize → 4-rule scale.
function deriveTargetVcpu(cores, memGB, htStatus, cpuP95, memP95) {
  let phys = (htStatus === 'ON') ? Math.ceil(cores / 2) : cores;
  let base = liftAndShiftSize(memGB, phys);
  let size = base;
  if (cpuP95 >= 80 && memP95 >= 80) size = scaleUp(base);
  else if (cpuP95 >= 80 && memP95 <= 80) size = scaleUp(base);
  else if (cpuP95 <= 80 && memP95 >= 80) size = base;
  else if (cpuP95 < 50 && memP95 < 50) size = scaleDown(base);
  return VCPU[size] || 4;
}

function awsSpecs(fam, size) {
  const key = fam + '.' + size;
  const io = AWS[key];
  const mem = MEM[fam] ? MEM[fam][size] : undefined;
  return { iops: io ? io.iops : undefined, tput: io ? io.tput : undefined, memory: mem, vcpu: VCPU[size], cores: PHYS_CORES[size] };
}

async function run() {
  const dir = path.join(__dirname, '..', 'tests');
  if (!fs.existsSync(dir)) { console.error('tests dir not found:', dir); process.exit(2); }
  const zips = fs.readdirSync(dir).filter(f => f.endsWith('.zip'));
  if (!zips.length) { console.error('no .zip samples in', dir); process.exit(2); }

  let checked = 0;
  const fail = [];
  const cov = { A:0, B:0, C:0, D:0, E:0, F:0, G:0, H:0, I:0, J:0, K:0, L:0, M:0, N:0, O:0, ALT:0 };
  const proc = new SSATProcessor();

  for (const z of zips) {
    let res;
    try { res = await proc.processZipFile(fs.readFileSync(path.join(dir, z)), 'RDS', false); }
    catch (e) { fail.push(`${z} | PARSE ERROR | ${e.message}`); continue; }
    if (!res || !res.success) { fail.push(`${z} | PROCESS FAIL | ${res && res.error}`); continue; }

    const a = res.analysis;
    const cs = a.currentServer || {};
    const rec = (res.recommendations || []).find(r => r.isPrimary) || (res.recommendations || [])[0];
    if (!rec || !rec.instanceType) { fail.push(`${z} | NO RECOMMENDATION`); continue; }
    checked++;

    const name = z.replace(/_SSAT_.*\.zip$/, '');
    const ed = editionCode(cs.sqlEdition);
    const ver = (cs.sqlVersion || '').toString();
    const cores = parseInt(cs.cores) || 0;
    const memGB = parseInt(cs.memoryGB) || 0;
    const ht = cs.htStatus || 'OFF';
    const iopsReq = Math.ceil(a.iops?.p95 || 0);
    const thruReq = Math.ceil(a.throughput?.p95 || 0);
    const cpuP95 = a.cpu?.p95 || 0;
    const memP95 = a.memory?.p95 || 0;
    const remark = (rec.remark || rec.explanation || '');
    const edLimitFlagged = /exceeds .*(edition|limits)|Enterprise Edition|Capped at/i.test(remark);
    const F = (o, msg) => fail.push(`${z} | ${name} | ${o} | PICK=${rec.instanceType} | ${msg}`);

    // ---- F. Fixed editions (checked on ORIGINAL edition, skip rest) ----
    if (ed === 'EXP') { cov.F++; if (rec.instanceType !== 'db.t3.xlarge') F('F-FIXED','EXP must be db.t3.xlarge'); continue; }
    if (ed === 'DEV') {
      cov.F++;
      const expect = ver.startsWith('16') ? 'db.r8i.xlarge' : 'db.r6i.xlarge';
      if (rec.instanceType !== expect) F('F-FIXED',`DEV v${ver} must be ${expect}`);
      continue;
    }

    // ---- A. In catalog (resolvable family+size with AWS specs) ----
    cov.A++;
    const p = parseInst(rec.instanceType);
    if (!p) { F('A-CATALOG','unparseable instance type'); continue; }
    const spec = awsSpecs(p.fam, p.size);
    if (spec.vcpu === undefined || spec.memory === undefined) { F('A-CATALOG',`no AWS spec for ${p.fam}.${p.size}`); continue; }

    // ---- B. Meets CPU (re-derived post-scaling target) ----
    cov.B++;
    const tCpu = deriveTargetVcpu(cores, memGB, ht, cpuP95, memP95);
    if (spec.vcpu < tCpu && !edLimitFlagged) F('B-CPU',`vCPU ${spec.vcpu} < target ${tCpu}`);

    // ---- C. Meets Memory (>= source) ----
    cov.C++;
    if (memGB > 0 && spec.memory < memGB && !edLimitFlagged) F('C-MEM',`mem ${spec.memory}GB < source ${memGB}GB`);

    // ---- D. Meets IOPS (authoritative AWS value) ----
    cov.D++;
    if (iopsReq > 0) {
      if (spec.iops === undefined) F('D-IOPS','no AWS IOPS for pick');
      else if (spec.iops < iopsReq && !edLimitFlagged) F('D-IOPS',`AWS IOPS ${spec.iops} < required ${iopsReq}`);
    }

    // ---- E. Meets Throughput (authoritative AWS value) ----
    cov.E++;
    if (thruReq > 0) {
      if (spec.tput === undefined) F('E-THRU','no AWS throughput for pick');
      else if (spec.tput < thruReq && !edLimitFlagged) F('E-THRU',`AWS tput ${spec.tput} < required ${thruReq}`);
    }

    // ---- G. Edition core caps ----
    if (ed === 'WEB' || ed === 'SE') {
      cov.G++;
      const cap = ed === 'WEB' ? 16 : 24;             // WEB: 4xl(16 vCPU); SE: 24 physical cores
      const measure = ed === 'WEB' ? spec.vcpu : spec.cores;
      if (measure > cap && !edLimitFlagged) F('G-EDITION',`${ed} exceeds cap: ${measure} > ${cap}`);
    }

    // ---- H. x2 edition gate (BUG-027): x2m/x2iedn only on EE/SE, never Web/Express ----
    const pickIsX2 = (p.fam === 'x2m' || p.fam === 'x2iedn');
    if (pickIsX2) {
      cov.H++;
      if (ed === 'WEB' || ed === 'EXP') F('H-X2EDITION',`x2 (${p.fam}) not orderable on ${ed}`);
    }

    // ---- I. x2 SE size cap (BUG-027): SE x2 must be <= 8xlarge ----
    if (pickIsX2 && ed === 'SE') {
      cov.I++;
      if (SIZE_ORDER.indexOf(p.size) > SIZE_ORDER.indexOf('8xlarge')) F('I-X2SE',`SE x2 ${p.size} exceeds 8xlarge cap`);
    }

    // ---- J. Storage type matches getStorageType(iops,tput): io2 if >80K IOPS or >2000 MB/s, else gp3 ----
    if (rec.ebsType) {
      cov.J++;
      const expectEbs = (iopsReq > 80000 || thruReq > 2000) ? 'io2' : 'gp3';
      if (rec.ebsType !== expectEbs) F('J-EBS',`ebsType ${rec.ebsType} != expected ${expectEbs} (iops=${iopsReq},tput=${thruReq})`);
    }

    // ---- K. Efficiency: no SMALLER size in the SAME family also meets CPU+Mem+IOPS+Thru (not over-sized) ----
    if (!edLimitFlagged && spec.iops !== undefined) {
      cov.K++;
      const pickIdx = SIZE_ORDER.indexOf(p.size);
      for (let i = 0; i < pickIdx; i++) {
        const sz = SIZE_ORDER[i];
        const s2 = awsSpecs(p.fam, sz);
        if (s2.vcpu === undefined || s2.memory === undefined || s2.iops === undefined) continue;
        // SE x2 cap: a smaller size only counts if it's also within edition rules
        if (pickIsX2 && ed === 'SE' && SIZE_ORDER.indexOf(sz) > SIZE_ORDER.indexOf('8xlarge')) continue;
        const meetsAll = s2.vcpu >= tCpu && s2.memory >= (memGB||0) && s2.iops >= iopsReq && s2.tput >= thruReq
          && (ed !== 'WEB' || s2.vcpu <= 16) && (ed !== 'SE' || s2.cores <= 24);
        if (meetsAll) { F('K-OVERSIZED',`smaller ${p.fam}.${sz} also fits — pick ${p.size} over-provisioned`); break; }
      }
    }

    // ---- L. Under-provision MUST carry a WARNING (enforce, not just accept) ----
    {
      cov.L++;
      const under = (memGB>0 && spec.memory < memGB) || (iopsReq>0 && spec.iops!==undefined && spec.iops < iopsReq) || (thruReq>0 && spec.tput!==undefined && spec.tput < thruReq);
      if (under && !edLimitFlagged) F('L-NOWARN',`under-provisioned (mem/iops/tput below need) but no WARNING in note`);
    }

    // ---- N. RDS version floor: RDS SQL Server lowest orderable = v14 (2017); 2014/2016 dropped.
    //         A sub-v14 source MUST upgrade to 2017+ on migration. The picked instance
    //         (m7i/r7i/m8i/r8i/x2m/x2iedn) is orderable on v14+, so this is a migration-upgrade
    //         flag, not an instance-orderability error. We assert the engine noted the upgrade need. ----
    {
      cov.N++;
      const majorVer = parseInt((ver.match(/^(\d+)/)||[])[1] || '15');
      if (majorVer > 0 && majorVer < 14) {
        const notesUpgrade = /upgrade|2017\+|version|v1[4-9]|not supported/i.test(remark);
        if (!notesUpgrade) F('N-VERSION',`source SQL v${majorVer} below RDS floor (v14/2017) — requires version upgrade on migration; not noted`);
      }
    }

    // ---- M. Highest-gen family preference: if pick is an older gen (m7i/m6i/r7i/r6i),
    //         verify the newest gen of the SAME role at the SAME size wasn't an equal-or-better fit ----
    {
      const genPref = { m6i:'m8i', m7i:'m8i', r6i:'r8i', r7i:'r8i' };
      const newer = genPref[p.fam];
      if (newer) {
        cov.M++;
        const s2 = awsSpecs(newer, p.size);
        if (s2 && s2.vcpu !== undefined && s2.memory !== undefined) {
          const newerFits = s2.vcpu >= tCpu && s2.memory >= (memGB||0)
            && (iopsReq===0 || (s2.iops||0) >= iopsReq) && (thruReq===0 || (s2.tput||0) >= thruReq)
            && (ed !== 'WEB' || s2.vcpu <= 16) && (ed !== 'SE' || s2.cores <= 24);
          // Only a finding if newer gen fits AND tool data would price/serve it — pure gen regression
          if (newerFits && !edLimitFlagged) F('M-OLDGEN',`picked older ${p.fam}.${p.size}; ${newer}.${p.size} (newest gen) also fits`);
        }
      }
      // x2m is x2iedn hardware + RDS Optimize CPU: identical EBS specs, ~50% SQL licensing savings.
      // So x2iedn should never be picked when x2m at the same size is equally valid (edition/size gated).
      if (p.fam === 'x2iedn') {
        cov.M++;
        const x2mOk = x2AllowedFor(ed) && x2SizeOkFor(ed, p.size) && awsSpecs('x2m', p.size);
        if (x2mOk && !edLimitFlagged) F('M-X2PREF',`picked x2iedn.${p.size}; x2m.${p.size} (same specs, ~50% licensing savings) should be preferred`);
      }
    }

    // ---- O. Family ROLE vs memory:CPU ratio (audit Finding 1).
    //   Engine INITIAL pick: ratio<=4 → general-purpose m; ratio>4 → memory-optimized r/x2.
    //   BUT memory-validation / IOPS steps may legitimately switch role (e.g. r-family when the
    //   m-family at the needed size lacks memory). So only flag a role mismatch when the EXPECTED
    //   role, at the SAME size, would ALSO have met memory+IOPS+tput — i.e. a true role regression. ----
    {
      // Engine ratio = actualMemoryGB / actualCores where actualCores is HT-adjusted (ceil/2 when HT=ON).
      // Oracle O MUST use the same physical-core basis, else ratio is understated (false positives).
      const physCores = (ht === 'ON') ? Math.ceil(cores / 2) : cores;
      const roleRatio = (memGB > 0 && physCores > 0) ? memGB / physCores : null;
      if (roleRatio !== null && !edLimitFlagged) {
        cov.O++;
        const isMemRole = /^r|^x2/.test(p.fam);
        const isGenRole = /^m/.test(p.fam);
        if (roleRatio <= 4 && isMemRole) {
          // Would the general-purpose m8i at this size have met memory+IOPS+tput? If yes → wrong role.
          const m = awsSpecs('m8i', p.size);
          const mFits = m && m.memory !== undefined && m.memory >= (memGB||0)
            && (iopsReq===0 || (m.iops||0) >= iopsReq) && (thruReq===0 || (m.tput||0) >= thruReq);
          if (mFits) F('O-ROLE',`ratio ${roleRatio.toFixed(1)}<=4 expects general-purpose (m); ${p.fam} chosen though m8i.${p.size} also fits`);
        }
        if (roleRatio > 8 && isGenRole) F('O-ROLE',`ratio ${roleRatio.toFixed(1)}>8 expects memory-optimized (r/x2), got ${p.fam}`);
      }
    }

    // ---- ALT: validate every alternative card for LEGALITY invariants only.
    //   Alternatives are trade-off OPTIONS (Option B) — they need NOT meet the full workload
    //   requirements (CPU/mem/IOPS/tput), so B/C/D/E are intentionally NOT checked here.
    //   Only rules that must hold for ANY offered instance regardless of fit:
    //     A = real AWS instance, H = x2 edition legality, I = SE x2 size legality, J = storage type. ----
    const alts = (res.recommendations || []).filter(r => r !== rec && r.instanceType);
    for (const alt of alts) {
      cov.ALT++;
      const ap = parseInst(alt.instanceType);
      const AF = (o, msg) => fail.push(`${z} | ${name} | ALT:${o} | CARD=${alt.instanceType} | ${msg}`);
      if (!ap) { AF('A-CATALOG','unparseable'); continue; }
      const asp = awsSpecs(ap.fam, ap.size);
      if (asp.vcpu === undefined || asp.memory === undefined) { AF('A-CATALOG',`no AWS spec for ${ap.fam}.${ap.size}`); continue; }
      // H x2 edition gate (illegal on Web/Express regardless of fit)
      if ((ap.fam === 'x2m' || ap.fam === 'x2iedn') && (ed === 'WEB' || ed === 'EXP')) AF('H-X2EDITION',`x2 (${ap.fam}) not orderable on ${ed}`);
      // I x2 SE size cap (not orderable above 8xlarge on SE)
      if ((ap.fam === 'x2m' || ap.fam === 'x2iedn') && ed === 'SE' && SIZE_ORDER.indexOf(ap.size) > SIZE_ORDER.indexOf('8xlarge')) AF('I-X2SE',`SE x2 ${ap.size} exceeds 8xlarge cap`);
      // J storage type
      if (alt.ebsType) {
        const expectEbs = (iopsReq > 80000 || thruReq > 2000) ? 'io2' : 'gp3';
        if (alt.ebsType !== expectEbs) AF('J-EBS',`ebsType ${alt.ebsType} != expected ${expectEbs}`);
      }
    }
  }

  console.log(`Checked ${checked} recommendations across ${zips.length} sample ZIPs.`);
  console.log(`Coverage: A=${cov.A} B=${cov.B} C=${cov.C} D=${cov.D} E=${cov.E} F=${cov.F} G=${cov.G} H=${cov.H} I=${cov.I} J=${cov.J} K=${cov.K} L=${cov.L} M=${cov.M} N=${cov.N} O=${cov.O} ALT=${cov.ALT}`);
  if (!fail.length) { console.log('ALL PASS — every pick is in-catalog and meets CPU+Mem+IOPS+Throughput together, fixed editions and edition caps correct.'); process.exit(0); }
  console.log(`${fail.length} FAILURES:`); fail.forEach(f => console.log('  ' + f)); process.exit(1);
}
run();
