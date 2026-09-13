---
type: "query"
date: "2026-09-13T17:19:15.551324+00:00"
question: "Xray scans complete in Xray but all JustScan scans end failed with fresh=false context deadline exceeded"
contributor: "graphify"
outcome: "useful"
source_nodes: ["xrayArtifactScanStatus", "xrayArtifactStatusResponse", ".waitForArtifactStatus", "xray.go"]
---

# Q: Xray scans complete in Xray but all JustScan scans end failed with fresh=false context deadline exceeded

## Answer

Expanded from original query via vocab: [xray, artifact, status, fresh, completion, timestamp, transition, poll, scan, wait]. The polling loop in services/backend/scanner/xray.go accepted DONE but omitted Xray's terminal PARTIAL status, so partial completions looped until the provider deadline. Updated waitForArtifactStatusUntil to accept PARTIAL, parse updated_at timestamps, and avoid claiming a freshness failure when requireFresh is false. Added lifecycle regression coverage and troubleshooting documentation.

## Outcome

- Signal: useful

## Source Nodes

- xrayArtifactScanStatus
- xrayArtifactStatusResponse
- .waitForArtifactStatus
- xray.go