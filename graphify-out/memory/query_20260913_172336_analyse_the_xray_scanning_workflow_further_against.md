---
type: "query"
date: "2026-09-13T17:23:36.876780+00:00"
question: "Analyse the Xray scanning workflow further against current Xray documentation and discover bugs or improvements"
contributor: "graphify"
outcome: "useful"
source_nodes: ["processXrayScan", ".waitForArtifactStatus", ".artifactStatus", "xraySummaryResponse", ".getViolations", "persistXrayIgnoreRuleSnapshots", ".doRawJSON", "RegistryXrayTestClient"]
---

# Q: Analyse the Xray scanning workflow further against current Xray documentation and discover bugs or improvements

## Answer

Expanded via graph vocab: [xray, artifact, scan, status, summary, export, violation, policy, digest, manifest, registry, sbom]. Audit found: the overall workflow matches JFrog's cache/status/v2-summary/v2-export model; Get Violations sends raw repository names although JFrog requires artifactory-id/repo and fetches only limit 20 offset 0; ignore-rule snapshotting fetches only page 1 and persists only rules[0]; successful PARTIAL is overwritten as generic completed; successful empty/unknown status payloads poll until timeout; debug logging stores unbounded binary ZIP exports in text and launches one goroutine per request; registry health only pings Xray and does not validate Artifactory/repository/read/full-mode permissions; scanArtifact requests a scan but its docs do not guarantee a forced rescan, so freshness remains an inferred contract guarded by timestamps/transitions.

## Outcome

- Signal: useful

## Source Nodes

- processXrayScan
- .waitForArtifactStatus
- .artifactStatus
- xraySummaryResponse
- .getViolations
- persistXrayIgnoreRuleSnapshots
- .doRawJSON
- RegistryXrayTestClient