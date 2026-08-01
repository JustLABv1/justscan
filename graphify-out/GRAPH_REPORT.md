# Graph Report - services/backend  (2026-08-01)

## Corpus Check
- 408 files · ~256,075 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3444 nodes · 9011 edges · 262 communities (252 shown, 10 thin omitted)
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 1558 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Git Repositories Services
- Suppression Handlers
- Compliance Intelligence
- Xray Scanner
- Authentication Handlers
- Git Repositories Handlers
- Pipelines Pipeline Scans
- CVE History Scanner
- Watchlist Handlers
- Xray Scanner
- Tags Handlers
- Helm Registry Credentials Handlers
- Intelligence Scanner
- Helm Scanner
- Vulnerability KB Handlers
- Xray Scanner
- AI Services
- Organizations Handlers
- Status Pages Handlers
- OIDC Multi Services
- Helm Handlers
- Trivy Scanner
- Scans Handlers
- Xray Scanner
- Httperror Services
- Users Handlers
- JWT Services
- Capabilities Scanner
- Grype Scanner
- AI Services
- Notifications Notify
- Organizations Handlers
- Handlers Module
- Status Pages Handlers
- Notifications Queue
- Administration Handlers
- Registry Scanner
- Database Migrations
- OSV Scanner
- CVE History Scanner
- Worker Scanner
- Progress Scanner
- Scans Handlers
- Registries Handlers
- Configuration Module
- Intelligence Identity Scanner
- Dashboard Handlers
- Xray Scanner
- Administration Handlers
- AI Handlers
- Organizations Handlers
- Httperror Services
- Public Handlers
- Scans Handlers
- Administration Handlers
- Shared Handlers
- Trivy Scanner
- Request Services
- KB Scanner
- Scans Handlers
- Xray Scanner
- Condition Options Handlers
- Router Module
- Configuration Module
- Scans Handlers
- Scans Handlers
- Scans Handlers
- Administration Handlers
- Administration Handlers
- Administration Handlers
- Status Pages Handlers
- Notifications Rules
- OIDC Debug Services
- Helm Handlers
- Scans Handlers
- Ratelimit Middleware
- Shared Request Log
- Notifications Notify
- Administration Handlers
- Shared Vuln KB
- Dashboard Handlers
- Request Services
- Scans Handlers
- Scans Handlers
- Status Pages Handlers
- Shared Vulnerability Intelligence
- Xray Scanner
- Configuration Settings
- Docs Module
- Tokens Handlers
- Condition Options Handlers
- Xray Scanner
- Shared AI
- Database Migrate Runner
- Blockedpolicy Services
- Public Handlers
- Registries Handlers
- Scans Handlers
- CVE History Scanner
- SBOM Scanner
- Scans Handlers
- Scans Handlers
- Xray Scanner
- Shared Module
- Notifications Rules
- Dashboard Handlers
- Authentication Handlers
- Comments Handlers
- Shared SBOM
- Archive Input Scanner
- Intelligence Scanner
- Administration Handlers
- AI Services
- Token Services
- Administration Handlers
- Scans Handlers
- Database Migrations
- Database Init
- Swagger Router
- Dashboard Handlers
- Scans Handlers
- Scans Handlers
- Tokens Handlers
- Tokens Handlers
- Ownership Services
- Dashboard Handlers
- Scans Handlers
- Scans Handlers
- Search Handlers
- Shared Tokens
- Grype Scanner
- Xray Log Keys Scanner
- Database Migrations
- Database Migrations
- Database Migrations
- Database Migrations
- Database Migrations
- Database Migrations
- Database Migrations
- Database Migrations
- Docker Entrypoint
- Organizations Handlers
- Scans Handlers
- Scans Handlers
- Shared Helm Scan Runs
- Administration Handlers
- Configuration Module
- Administration Handlers
- Administration Handlers
- Scans Handlers
- Shared Module
- Shared Manual Findings
- Shared OSV Cache
- Configuration Module
- Administration Handlers
- Organizations Handlers
- Scans Handlers
- Scans Handlers
- Scans Handlers
- Scans Handlers
- Scans Handlers
- Scans Handlers
- Status Pages Handlers
- Users Handlers
- Users Handlers
- Request Log Middleware
- Shared Settings
- Configuration Module
- Configuration Module
- Database Migrations
- Shared Ownership
- Logo Module
- Backend Module
- Configuration Module
- Configuration Module
- Configuration Module
- Configuration Module
- Configuration Module
- Configuration Module
- Logo Module

## God Nodes (most connected - your core abstractions)
1. `Scan` - 152 edges
2. `JSONObject` - 85 edges
3. `RequireRequestUser()` - 69 edges
4. `Admin()` - 69 edges
5. `RequireOrgRole()` - 68 edges
6. `Orgs()` - 54 edges
7. `Scans()` - 50 edges
8. `processXrayScan()` - 49 edges
9. `Vulnerability` - 43 edges
10. `xrayClient` - 40 edges

## Surprising Connections (you probably didn't know these)
- `RunForScan()` --calls--> `Dispatch()`  [INFERRED]
  compliance/evaluate.go → notifications/queue.go
- `AssignScan()` --calls--> `RunForScan()`  [INFERRED]
  handlers/orgs/orgs.go → compliance/evaluate.go
- `ReEvaluate()` --calls--> `RunForScan()`  [INFERRED]
  handlers/orgs/orgs.go → compliance/evaluate.go
- `GrantScanOrgAccess()` --calls--> `RunForScan()`  [INFERRED]
  handlers/scans/org_grants.go → compliance/evaluate.go
- `BulkGrantScanOrgAccess()` --calls--> `RunForScan()`  [INFERRED]
  handlers/scans/workspaces.go → compliance/evaluate.go

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Executions Table Schema Migration** — services_backend_database_migrations_sample_init, services_backend_database_migrations_sample_addghostandtotalstepstoexecutions, services_backend_database_migrations_sample_removeghostandtotalstepsfromexecutions, services_backend_database_migrations_sample_executions, services_backend_database_migrations_sample_ghost, services_backend_database_migrations_sample_total_steps [EXTRACTED 1.00]

## Communities (262 total, 10 thin omitted)

### Community 0 - "Git Repositories Services"
Cohesion: 0.05
Nodes (120): appendHelmChart(), appendHelmChartFromRoots(), appendKustomizeRoots(), appendManifestFile(), appendManifestImages(), appendManifestPaths(), attachScanTags(), cancelRepositoryRunScan() (+112 more)

### Community 1 - "Suppression Handlers"
Cohesion: 0.07
Nodes (73): EvaluatePolicy(), filterSuppressedVulnerabilities(), filterSuppressedVulnerabilitiesForOrg(), Context, DB, UUID, RunForScan(), T (+65 more)

### Community 2 - "Compliance Intelligence"
Cohesion: 0.08
Nodes (61): changedFindingsAffectPolicy(), classifyPolicyImpact(), combinedStatus(), dispatchIntelligencePolicyImpactNotifications(), EvaluatePolicyWithCurrentIntelligence(), EvaluateScanIntelligencePolicyImpacts(), evaluateScanPolicyImpacts(), Context (+53 more)

### Community 3 - "Xray Scanner"
Cohesion: 0.05
Nodes (58): Header, registryErrorEntry, registryErrorResponse, registryHTTPError, registryManifestDescriptor, registryManifestPlatform, blockedArtifactPath(), blockedRepository() (+50 more)

### Community 4 - "Authentication Handlers"
Cohesion: 0.10
Nodes (53): desiredOIDCMembership, oidcClaimBlockers, OIDCClaimSyncMembership, OIDCClaimSyncPreview, OIDCClaimSyncRoute, oidcEvaluationResult, oidcRouteCandidate, blockedClaimsForType() (+45 more)

### Community 5 - "Git Repositories Handlers"
Cohesion: 0.13
Nodes (54): defaultTimezone(), SyncSchedule(), Unschedule(), helmSourceRequest, repositoryRequest, build(), buildHelmSource(), CancelRun() (+46 more)

### Community 6 - "Pipelines Pipeline Scans"
Cohesion: 0.08
Nodes (51): Addr, PipelineInitiator, PipelineScanRequest, cidrAllowed(), Client, Context, hostAllowed(), isPublicCallbackAddress() (+43 more)

### Community 7 - "CVE History Scanner"
Cohesion: 0.11
Nodes (49): VulnerabilityIntelligenceSyncCheckpoint, beginCVEHistorySync(), CancelCVEHistorySync(), completeCVEHistoryEventProgress(), contextSleep(), CurrentCVEHistorySyncStatus(), cveHistoryCursorAtOrAfter(), endCVEHistorySync() (+41 more)

### Community 8 - "Watchlist Handlers"
Cohesion: 0.10
Nodes (48): attachWatchlistPosture(), canWriteWatchlistItem(), CreateWatchlistItem(), DeleteWatchlistItem(), Context, DB, HandlerFunc, UUID (+40 more)

### Community 9 - "Xray Scanner"
Cohesion: 0.09
Nodes (51): roundTripFunc, buildXrayArtifactPathCandidates(), parseXrayIgnoredViolationRulesFromExport(), parseXrayViolationsExport(), buildTestExportZip(), containsFold(), decodeJSONBody(), Client (+43 more)

### Community 10 - "Tags Handlers"
Cohesion: 0.10
Nodes (43): CanManageTag(), CanReadTag(), Context, DB, UUID, Create(), Delete(), DB (+35 more)

### Community 11 - "Helm Registry Credentials Handlers"
Cohesion: 0.10
Nodes (43): CanOrgAccessHelmRegistryCredential(), Context, DB, UUID, HelmRegistryCredentialBelongsToRepository(), LoadAuthorizedHelmRegistryCredential(), LoadHelmRegistryCredentialForRepository(), Context (+35 more)

### Community 12 - "Intelligence Scanner"
Cohesion: 0.10
Nodes (45): evidenceCandidate, AttachVulnerabilityIntelligence(), BackfillVulnerabilityIntelligence(), canonicalIntelligenceSource(), ensureIntelligenceVersion(), equalJSONObjectSlices(), equalStrings(), equalStringSets() (+37 more)

### Community 13 - "Helm Scanner"
Cohesion: 0.08
Nodes (39): Chart, ExtractImages(), Context, DB, HandlerFunc, helmCredentialMatchesChart(), resolveHelmPullCredential(), T (+31 more)

### Community 14 - "Vulnerability KB Handlers"
Cohesion: 0.10
Nodes (40): applyPostureFilter(), floatValue(), GetKBExposure(), GetKBHistory(), Context, DB, HandlerFunc, SelectQuery (+32 more)

### Community 15 - "Xray Scanner"
Cohesion: 0.12
Nodes (14): ArtifactoryRepository, registryManifest, RegistryXrayTestClient, applyXrayAuth(), Client, Context, Duration, Request (+6 more)

### Community 16 - "AI Services"
Cohesion: 0.16
Nodes (24): ChatMessage, ChatProvider, ChatRequest, ChatResponse, httpChatProvider, ProviderCapabilities, ProviderRuntime, providerTextMessage (+16 more)

### Community 17 - "Organizations Handlers"
Cohesion: 0.11
Nodes (33): EnsureOrgActionAllowed(), Context, IsReadOnlyRequest(), DB, HandlerFunc, ListOrgAuditLog(), AcceptInviteByID(), AcceptInviteByToken() (+25 more)

### Community 18 - "Status Pages Handlers"
Cohesion: 0.17
Nodes (40): canManageStatusPage(), canReadStatusPageRecord(), canViewStatusPage(), CheckStatusPageSlugAvailability(), CreateStatusPage(), DeleteStatusPage(), ensureOrgStatusPageLink(), GetStatusPage() (+32 more)

### Community 19 - "OIDC Multi Services"
Cohesion: 0.11
Nodes (30): OIDCClaims, providerEntry, Config, extractStringSlice(), ExtractStringSliceForDebug(), GenerateStateToken(), ExtractOIDCClaimsForProvider(), FetchUserInfoClaims() (+22 more)

### Community 20 - "Helm Handlers"
Cohesion: 0.09
Nodes (33): Write(), CreateScans(), DB, HandlerFunc, CreatePublicHelmScans(), DB, HandlerFunc, EnsureOrgScanLink() (+25 more)

### Community 21 - "Trivy Scanner"
Cohesion: 0.10
Nodes (38): sbomJSONObject(), extractCVSS(), ExtractDigest(), ExtractKBEntries(), extractVersion(), DB, UUID, isRetriableTrivyRegistryError() (+30 more)

### Community 22 - "Scans Handlers"
Cohesion: 0.14
Nodes (34): DefaultSettings(), FromOrg(), FromUser(), Context, DB, UUID, LoadOrgSettings(), LoadUserPreference() (+26 more)

### Community 23 - "Xray Scanner"
Cohesion: 0.12
Nodes (35): appendScanStepOutput(), Context, DB, UUID, isTerminalScanStep(), recordScanStepOutput(), setScanStep(), setScanStepByID() (+27 more)

### Community 24 - "Httperror Services"
Cohesion: 0.06
Nodes (25): Context, StatusBadRequest(), Context, StatusConflict(), CreateUser(), Context, DB, DisableUser() (+17 more)

### Community 25 - "Users Handlers"
Cohesion: 0.08
Nodes (26): GetUserIDFromToken(), UUID, Context, Unauthorized(), ChangeUserDetails(), Context, DB, ChangeUserPassword() (+18 more)

### Community 26 - "JWT Services"
Cohesion: 0.08
Nodes (22): DB, UUID, ResolveUserAccess(), GetIDFromToken(), GetTypeFromToken(), Context, DB, ValidateTokenDBEntry() (+14 more)

### Community 27 - "Capabilities Scanner"
Cohesion: 0.13
Nodes (27): GetMaintenanceSettings(), DB, HandlerFunc, CreatePublicScan(), GetPublicScan(), GetPublicSettings(), Context, DB (+19 more)

### Community 28 - "Grype Scanner"
Cohesion: 0.16
Nodes (31): buildGrypeCommandEnv(), ExtractGrypeKBEntries(), UUID, grypeBestCVSS(), grypeBestDescription(), grypeBestSeverity(), grypeBestSource(), grypeCanonicalVulnerabilityID() (+23 more)

### Community 29 - "AI Services"
Cohesion: 0.23
Nodes (29): DefaultBaseURL(), DefaultChatModel(), Context, DB, IsProviderTypeSupported(), ListAdminProviders(), ListEnabledProviderSummaries(), ListProviderSettings() (+21 more)

### Community 30 - "Notifications Notify"
Cohesion: 0.18
Nodes (27): NotificationConfig, discordEmbed, discordField, discordFooter, discordMessage, buildEmailBody(), buildPlainMessage(), channelMatches() (+19 more)

### Community 31 - "Organizations Handlers"
Cohesion: 0.22
Nodes (27): RequireOrgRole(), AssignScan(), CreateOrg(), CreatePolicy(), DeleteOrg(), DeletePolicy(), filterVisibleComplianceResults(), GetComplianceTrend() (+19 more)

### Community 32 - "Handlers Module"
Cohesion: 0.22
Nodes (27): CreateChannel(), CreateRule(), DeleteChannel(), DeleteRule(), Context, DB, isAllowedChannelType(), isAllowedNotificationEvent() (+19 more)

### Community 33 - "Status Pages Handlers"
Cohesion: 0.14
Nodes (27): buildStatusPageScanSummary(), compileStatusPagePatterns(), containsStatusPageGitImageName(), defaultStatusPageUpdateTitle(), gitRepositorySourceCurrentScanWhere(), Time, loadGitRepositoryStatusPageItems(), loadStaticStatusPageItems() (+19 more)

### Community 34 - "Notifications Queue"
Cohesion: 0.21
Nodes (28): NotificationRule, appendDigestEvent(), backoffForAttempt(), buildDigestPayload(), buildJobPayload(), containsString(), deliverQueueJob(), Dispatch() (+20 more)

### Community 35 - "Administration Handlers"
Cohesion: 0.18
Nodes (26): oidcClaimSyncPreviewRequest, oidcMappingRequest, oidcRoleOverrideRequest, InvalidateProviderCache(), buildOIDCMapping(), buildOIDCRoleOverride(), CreateGroupMapping(), CreateOIDCProvider() (+18 more)

### Community 36 - "Registry Scanner"
Cohesion: 0.14
Nodes (26): Registry, BaseModel, Time, UUID, buildRegistryEnv(), effectiveXrayRepository(), Context, DB (+18 more)

### Community 37 - "Database Migrations"
Cohesion: 0.10
Nodes (17): init(), init(), addRegistryProviderColumns(), addScanProviderColumns(), Context, DB, init(), init() (+9 more)

### Community 38 - "OSV Scanner"
Cohesion: 0.16
Nodes (26): AugmentJavaVulnerabilitiesFromOSV(), Client, Context, DB, Duration, Time, UUID, loadOSVFindingsForPackage() (+18 more)

### Community 39 - "CVE History Scanner"
Cohesion: 0.21
Nodes (21): JSONObject, Value, affectedRangesFromContainer(), cpeRangesFromConfiguration(), deduplicateJSONObjectSlice(), deriveCurrentCVEState(), extractCurrentCVSS(), extractCVESAffectedRanges() (+13 more)

### Community 40 - "Worker Scanner"
Cohesion: 0.16
Nodes (24): Context, RunGrypeScan(), RunGrypeScanFromArchive(), workerGrypeCacheDir(), scanCommandTimeout(), ScanJob, buildImageRef(), RunSBOMScan() (+16 more)

### Community 41 - "Progress Scanner"
Cohesion: 0.19
Nodes (24): failStaleScans(), Context, DB, Duration, Time, UUID, interruptedScanFailureMessage(), recoverInterruptedScans() (+16 more)

### Community 42 - "Scans Handlers"
Cohesion: 0.18
Nodes (23): FileHeader, acquireArchiveUpload(), CreateOrgUploadedArchiveScan(), CreateUploadedArchiveScan(), Context, DB, HandlerFunc, UUID (+15 more)

### Community 43 - "Registries Handlers"
Cohesion: 0.22
Nodes (22): canManageRegistryShares(), CreateRegistry(), DeleteRegistry(), GetDefaultRegistry(), Context, DB, HandlerFunc, UUID (+14 more)

### Community 44 - "Configuration Module"
Cohesion: 0.16
Nodes (18): AIConf, ConfigurationManager, DatabaseConf, EncryptionConf, JWTConf, LocalAuthConf, GetConfigInstance(), GetInstance() (+10 more)

### Community 45 - "Intelligence Identity Scanner"
Cohesion: 0.22
Nodes (23): Constraints, applicabilityState, cloneStringSlice(), cloneUUIDPointer(), derivePosture(), derivePostureForIdentity(), derivePostureStateForIdentity(), evaluateAffectedRange() (+15 more)

### Community 46 - "Dashboard Handlers"
Cohesion: 0.24
Nodes (23): activityResult, dashboardPolicyIssueCounts, gitRepositorySummary, operationsResult, policyFailures, statsResult, topImage, ApplyOwnershipVisibility() (+15 more)

### Community 47 - "Xray Scanner"
Cohesion: 0.16
Nodes (20): blockedArtifactSummaryPaths(), dedupeXrayArtifactPathCandidates(), formatXraySummaryErrors(), hasMissingXraySummaryError(), isRetriableXrayRequestError(), joinXrayArtifactPaths(), preferredXrayArtifactCandidate(), RefreshXrayPolicyViolations() (+12 more)

### Community 48 - "Administration Handlers"
Cohesion: 0.15
Nodes (21): adminDashboardCounts, adminDashboardInsights, adminDashboardQueues, adminDashboardResponse, adminScanTrendRow, adminVulnerabilityAccumulator, adminVulnerabilityTrendRow, adminVulnerabilityTrendSample (+13 more)

### Community 49 - "AI Handlers"
Cohesion: 0.22
Nodes (21): createConversationRequest, buildPromptMessages(), conversationTitle(), CreateConversation(), DeleteConversation(), extractAssistantToolCalls(), GetConversation(), Context (+13 more)

### Community 50 - "Organizations Handlers"
Cohesion: 0.13
Nodes (19): Context, DB, UUID, WriteOrgAction(), CreateOrgToken(), DeleteRevokedOrgToken(), DB, Duration (+11 more)

### Community 51 - "Httperror Services"
Cohesion: 0.09
Nodes (17): Context, InternalServerError(), DeleteToken(), Context, DB, DeleteUser(), Context, DB (+9 more)

### Community 52 - "Public Handlers"
Cohesion: 0.15
Nodes (20): buildPublicHelmRunItems(), GetPublicHelmRun(), DB, HandlerFunc, publicHelmRunItemKey(), attachPipelineInitiator(), attachPipelineInitiators(), Context (+12 more)

### Community 53 - "Scans Handlers"
Cohesion: 0.21
Nodes (21): archiveUploadActor(), archiveUploadDirectory(), cleanupExpiredArchiveUploadSessions(), CompleteArchiveUploadSession(), CreateArchiveUploadSession(), createScanFromArchive(), Context, DB (+13 more)

### Community 54 - "Administration Handlers"
Cohesion: 0.23
Nodes (21): createAIProviderRequest, testAIProviderRequest, updateAIProviderRequest, updateAISettingsRequest, CreateAIProvider(), DeleteAIProvider(), encryptRequestedProviderToken(), getAIAuditUserID() (+13 more)

### Community 55 - "Shared Handlers"
Cohesion: 0.17
Nodes (18): getScanByShareToken(), GetSharedScan(), Context, DB, HandlerFunc, DownloadSharedSBOM(), GetSharedSBOM(), GetSharedSBOMComponent() (+10 more)

### Community 56 - "Trivy Scanner"
Cohesion: 0.17
Nodes (21): ageHours(), GetHealthReport(), Context, Time, maxAge(), HealthReport, dbNeedsRefresh(), EnsureDatabasesFresh() (+13 more)

### Community 57 - "Request Services"
Cohesion: 0.33
Nodes (20): CanOrgAccessRegistry(), GetOrgTokenID(), GetOrgTokenOrgID(), Context, DB, UUID, IsOrgTokenRequest(), ListAccessibleOrgIDs() (+12 more)

### Community 58 - "KB Scanner"
Cohesion: 0.16
Nodes (18): T, TestDispatchXrayKeepsScanInJustScanQueueUntilWorkerHandoff(), TestWorkerConcurrencyDefaultsToTwo(), MergeKBEntries(), mergeKBEntry(), Context, DB, Time (+10 more)

### Community 59 - "Scans Handlers"
Cohesion: 0.19
Nodes (18): T, TestApplyIntelligenceFilterSupportsDisputedAndRejected(), TestIntelligenceFilterConditionUsesCurrentPosture(), TestIntelligenceFilterValidationRejectsUnknownValues(), TestListVulnerabilityQueryUsesExplicitTableAlias(), applyIntelligenceFilter(), applyVulnerabilityFilters(), GetVulnerabilitySummary() (+10 more)

### Community 60 - "Xray Scanner"
Cohesion: 0.16
Nodes (20): appendXrayIgnoredViolationRulesFromPayload(), collectNestedObjectsByKey(), collectNestedValuesByKey(), collectXrayExportViolationCandidates(), collectXrayIgnoreRuleObjects(), extractStringSlice(), extractXrayIgnoreRules(), extractXrayViolationPolicies() (+12 more)

### Community 61 - "Condition Options Handlers"
Cohesion: 0.47
Nodes (18): appendNotificationOptionSearch(), Context, DB, UUID, ListConditionOptions(), loadNotificationConditionOptions(), loadNotificationImageOptions(), loadNotificationOrgOptions() (+10 more)

### Community 62 - "Router Module"
Cohesion: 0.12
Nodes (14): Auth(), DB, RouterGroup, AutoTags(), DB, RouterGroup, RouterGroup, Health() (+6 more)

### Community 63 - "Configuration Module"
Cohesion: 0.18
Nodes (9): cachedSetting, GetResolver(), Context, DB, Duration, RWMutex, Time, InitSettingResolver() (+1 more)

### Community 64 - "Scans Handlers"
Cohesion: 0.22
Nodes (16): buildScanComplianceSummaries(), dedupeAndSortStrings(), Context, DB, UUID, scopedOrgIDFromRequest(), scopedOrgIDFromScopeValue(), sortedFailedPolicies() (+8 more)

### Community 65 - "Scans Handlers"
Cohesion: 0.20
Nodes (16): GetScanImageStats(), Context, DB, HandlerFunc, Time, imageOverviewOrder(), ListScanImages(), parseImageOverviewTime() (+8 more)

### Community 66 - "Scans Handlers"
Cohesion: 0.31
Nodes (17): buildFrontendScanURL(), buildPipelineStatusURL(), CreatePipelineScan(), GetPipelineScan(), Context, DB, HandlerFunc, UUID (+9 more)

### Community 67 - "Administration Handlers"
Cohesion: 0.24
Nodes (16): VulnerabilityIntelligenceChangeEventResponse, VulnerabilityIntelligenceHistoryResponse, vulnerabilityIntelligenceSyncStateResponse, applyCVEHistoryFilters(), CancelVulnerabilityIntelligenceSync(), GetVulnerabilityIntelligenceHistory(), Context, DB (+8 more)

### Community 68 - "Administration Handlers"
Cohesion: 0.24
Nodes (15): CreateNotificationChannel(), DeleteNotificationChannel(), Context, DB, isAllowedChannelType(), isAllowedNotificationEvent(), isAllowedSeverity(), ListNotificationChannels() (+7 more)

### Community 69 - "Administration Handlers"
Cohesion: 0.36
Nodes (15): GetSettings(), Context, DB, UpdateAPILogRetention(), UpdateAuthSettings(), UpdateMaintenanceSettings(), UpdatePublicScanEnabled(), UpdateRateLimit() (+7 more)

### Community 70 - "Status Pages Handlers"
Cohesion: 0.25
Nodes (16): buildStatusPageModels(), deriveStatus(), normalizeSlug(), T, TestBuildStatusPageModelsAcceptsGitRepositorySourceWithoutFixedTargets(), TestBuildStatusPageModelsAcceptsRegexScope(), TestBuildStatusPageModelsNormalizesGitRepositorySourceImageNames(), TestBuildStatusPageModelsRejectsInvalidRegex() (+8 more)

### Community 71 - "Notifications Rules"
Cohesion: 0.37
Nodes (16): conditionNode, compareBool(), compareFloat(), compareImageRef(), compareInt(), compareSeverity(), compareString(), compareStringList() (+8 more)

### Community 72 - "OIDC Debug Services"
Cohesion: 0.32
Nodes (14): OIDCDebugReport, OIDCDebugSession, cleanupExpiredOIDCDebugSessionsLocked(), cloneOIDCDebugSession(), CompleteOIDCDebugSession(), CreateOIDCDebugSession(), GetOIDCDebugSessionForAdmin(), GetOIDCDebugSessionForFlow() (+6 more)

### Community 73 - "Helm Handlers"
Cohesion: 0.28
Nodes (15): buildHelmRunItems(), canDeleteHelmRunScan(), DeleteRun(), GetRun(), Context, DB, HandlerFunc, UUID (+7 more)

### Community 74 - "Scans Handlers"
Cohesion: 0.20
Nodes (13): CreateManualFinding(), DeleteManualFinding(), DB, HandlerFunc, ListManualFindings(), UpdateManualFinding(), DB, HandlerFunc (+5 more)

### Community 75 - "Ratelimit Middleware"
Cohesion: 0.21
Nodes (12): ipRateLimiter, AuthLoginRateLimit(), AuthRegisterRateLimit(), Duration, HandlerFunc, Mutex, Time, PublicScanRateLimit() (+4 more)

### Community 76 - "Shared Request Log"
Cohesion: 0.18
Nodes (14): APIRequestLog, APIRequestLogWithUser, APIUsageStats, EndpointStat, StatusBucket, UserStat, XRayRequestLog, XRayUsageStats (+6 more)

### Community 77 - "Notifications Notify"
Cohesion: 0.17
Nodes (14): DB, UUID, recordDeliveryWithContext(), deliveryContext, buildScanURL(), enrichPayload(), Context, DB (+6 more)

### Community 78 - "Administration Handlers"
Cohesion: 0.27
Nodes (13): globalRegistryPayload, CreateGlobalRegistry(), DeleteGlobalRegistry(), getUserIDFromContext(), Context, DB, UUID, ListGlobalRegistries() (+5 more)

### Community 79 - "Shared Vuln KB"
Cohesion: 0.15
Nodes (12): Comment, KBLastChange, Vulnerability, VulnKBEntry, BaseModel, Time, UUID, BaseModel (+4 more)

### Community 80 - "Dashboard Handlers"
Cohesion: 0.21
Nodes (12): vulnTrendAccumulator, vulnTrendRow, vulnTrendSample, aggregateVulnTrendRows(), GetVulnTrends(), DB, HandlerFunc, Time (+4 more)

### Community 81 - "Request Services"
Cohesion: 0.27
Nodes (13): Context, DB, Sqlmock, T, UUID, newAuthedContext(), newMockBunDB(), registryRow() (+5 more)

### Community 82 - "Scans Handlers"
Cohesion: 0.29
Nodes (12): canReadScan(), canWriteScan(), CopyOrgScanLinks(), Context, DB, IDB, UUID, LoadAuthorizedScan() (+4 more)

### Community 83 - "Scans Handlers"
Cohesion: 0.41
Nodes (13): AttachSBOMVulnerabilityCounts(), DownloadSBOM(), GetSBOMComponent(), GetSBOMGraph(), Context, DB, HandlerFunc, UUID (+5 more)

### Community 84 - "Status Pages Handlers"
Cohesion: 0.33
Nodes (13): applyStatusPageScanScopeQuery(), SelectQuery, latestTrackedScanID(), rebindStatusPageRelations(), statusPageScanScopeWhere(), validateStatusPageGitRepositorySources(), StatusPage, StatusPageGitRepositorySource (+5 more)

### Community 85 - "Shared Vulnerability Intelligence"
Cohesion: 0.37
Nodes (13): ScanIntelligenceVersion, VulnerabilityIntelligenceChangeEvent, VulnerabilityIntelligenceEvidence, VulnerabilityIntelligenceSyncRun, VulnerabilityIntelligenceVersion, VulnerabilityPosture, VulnerabilityPostureEvent, BaseModel (+5 more)

### Community 86 - "Xray Scanner"
Cohesion: 0.25
Nodes (12): VulnerabilityContextAnalysis, appendContextStrings(), collectContextStrings(), firstContextString(), GetVulnerabilityContextAnalysis(), Context, DB, parseContextBool() (+4 more)

### Community 87 - "Configuration Settings"
Cohesion: 0.28
Nodes (10): LocalAuthEnabled(), runtimeAuthSetting(), SignInEnabled(), SignUpEnabled(), SSOOnly(), Context, OIDCAvailable(), Context (+2 more)

### Community 88 - "Docs Module"
Cohesion: 0.29
Nodes (12): addRegisteredRoutes(), defaultOperationID(), defaultSuccessDescription(), defaultSuccessStatus(), defaultSummary(), defaultTag(), methodAllowsBody(), normalizePath() (+4 more)

### Community 89 - "Tokens Handlers"
Cohesion: 0.15
Nodes (10): RefreshToken(), Context, DB, RecordSuccessfulLogin(), GenerateJWT(), UUID, GenerateTokenUser(), Context (+2 more)

### Community 90 - "Condition Options Handlers"
Cohesion: 0.27
Nodes (12): DB, Sqlmock, T, newConditionOptionsMockDB(), TestNotificationConditionOptionLookupScopes(), TestNotificationConditionOptionScopeVisibility(), TestNotificationConditionOptionSearch(), TestNotificationEventValidationIncludesIntelligenceImpact() (+4 more)

### Community 91 - "Xray Scanner"
Cohesion: 0.23
Nodes (13): anyXrayViolationPolicyBlocking(), dedupeJSONObjects(), dedupeStrings(), formatBlockedViolationsSummary(), joinWithOverflow(), ParseXrayViolationVulnerabilities(), persistXrayViolationContext(), xrayViolationCandidateVulnIDs() (+5 more)

### Community 92 - "Shared AI"
Cohesion: 0.30
Nodes (11): sendConversationMessageRequest, AIConversation, AIKnowledgeChunk, AIMessage, AIMessageSource, AIProviderAdminResponse, AISupportedProvider, AIToolCall (+3 more)

### Community 93 - "Database Migrate Runner"
Cohesion: 0.27
Nodes (10): compareMigrationNames(), Context, DB, migrateInNumericOrder(), resetBrokenFreshInstallMigrations(), tableExists(), T, TestCompareMigrationNames() (+2 more)

### Community 94 - "Blockedpolicy Services"
Cohesion: 0.39
Nodes (11): AttachScanDetails(), BuildDetails(), Context, DB, UUID, hasUnavailableIgnoreRuleStatus(), loadActiveIgnoreRuleWatches(), parseBlockedPolicyDetails() (+3 more)

### Community 95 - "Public Handlers"
Cohesion: 0.17
Nodes (9): GetPublicVulnerabilityContextAnalysis(), DB, HandlerFunc, GetVulnerabilityContextAnalysis(), DB, HandlerFunc, GetSharedVulnerabilityContextAnalysis(), DB (+1 more)

### Community 96 - "Registries Handlers"
Cohesion: 0.30
Nodes (10): CheckAndPersistRegistryHealth(), CheckRegistryHealth(), Context, DB, Time, runHealthChecks(), StartHealthChecks(), StopHealthChecks() (+2 more)

### Community 97 - "Scans Handlers"
Cohesion: 0.32
Nodes (11): BulkGrantScanOrgAccess(), BulkTransferScanOwnership(), Context, DB, HandlerFunc, Tx, UUID, loadWritableScanIDs() (+3 more)

### Community 98 - "CVE History Scanner"
Cohesion: 0.30
Nodes (11): T, TestCurrentSnapshotRawPayloadIsJSONSerializable(), TestCVEHistoryClientFetchHistoryPage(), TestCVEHistoryClientRetriesRateLimit(), TestCVEHistoryRunContextCachesCurrentSnapshot(), TestEvaluateAffectedRangeChangesTimeline(), TestEvaluateAffectedRangesRequiresSufficientIdentity(), TestFetchCurrentSnapshotNormalizesOfficialAndNVDData() (+3 more)

### Community 99 - "SBOM Scanner"
Cohesion: 0.35
Nodes (11): componentEcosystem(), componentModel(), componentRef(), firstSBOMNonEmpty(), firstSBOMString(), Context, DB, UUID (+3 more)

### Community 100 - "Scans Handlers"
Cohesion: 0.31
Nodes (10): artifactPolicyWhere(), Context, DB, HandlerFunc, Time, UUID, ListScanArtifacts(), loadArtifactFilterOptions() (+2 more)

### Community 101 - "Scans Handlers"
Cohesion: 0.33
Nodes (10): DeleteScan(), deleteScanRecords(), GetScan(), Context, DB, HandlerFunc, IDB, UUID (+2 more)

### Community 102 - "Xray Scanner"
Cohesion: 0.36
Nodes (11): KBRef, kbRefsContainExploit(), mergeKBRefs(), cycloneDXKBReferences(), cycloneDXVulnerabilityScore(), ExtractCycloneDXKBEntries(), ExtractXrayKBEntries(), ExtractXrayViolationKBEntries() (+3 more)

### Community 103 - "Shared Module"
Cohesion: 0.42
Nodes (10): NotificationChannel, NotificationDelivery, NotificationDigest, NotificationEvent, NotificationQueueJob, sendAndRecord(), SendTest(), BaseModel (+2 more)

### Community 104 - "Notifications Rules"
Cohesion: 0.38
Nodes (10): logRuleDecodeError(), ruleMatches(), T, TestNotificationScopeMatchesTargetedUsersAndOrganizations(), TestRuleDoesNotMatchWrongEvent(), TestRuleMatchesAllConditions(), TestRuleMatchesAnyConditionListPredicates(), TestRuleMatchesGuidedEnumBooleanAndNumericConditions() (+2 more)

### Community 105 - "Dashboard Handlers"
Cohesion: 0.27
Nodes (9): scanTrendRow, GetTrends(), DB, HandlerFunc, Time, UUID, orgPolicyFailureCondition(), trendCutoff() (+1 more)

### Community 106 - "Authentication Handlers"
Cohesion: 0.29
Nodes (9): deriveFrontendOrigin(), firstHeaderValue(), Context, DB, Request, normalizeOrigin(), requestOrigin(), sanitiseUsername() (+1 more)

### Community 107 - "Comments Handlers"
Cohesion: 0.31
Nodes (8): CreateComment(), DeleteComment(), DB, HandlerFunc, UpdateComment(), Comments(), DB, RouterGroup

### Community 108 - "Shared SBOM"
Cohesion: 0.44
Nodes (9): SBOMComponent, SBOMDependency, SBOMDocument, VulnerabilityComponentLink, BaseModel, Time, UUID, setSBOMDepths() (+1 more)

### Community 109 - "Archive Input Scanner"
Cohesion: 0.38
Nodes (8): archiveExtractionPath(), extractOCILayoutTar(), isOCILayoutTar(), prepareUploadedArchiveInput(), T, TestPrepareUploadedArchiveInputExtractsOCILayoutTar(), TestPrepareUploadedArchiveInputKeepsDockerArchiveFile(), writeArchiveInputTestTar()

### Community 110 - "Intelligence Scanner"
Cohesion: 0.36
Nodes (9): derivePostureState(), T, TestDerivePostureCarriesFeedEvidenceFields(), TestDerivePostureState(), TestDerivePostureStoresConflictingSources(), TestIntelligenceDescriptorUsesFeedVersion(), TestLatestEvidenceForFindingPrefersFeedAndPackageSpecificRecords(), TestNormalizeIntelligenceIngestRequest() (+1 more)

### Community 111 - "Administration Handlers"
Cohesion: 0.33
Nodes (8): adminOrgSummary, GetOrgGovernance(), Context, DB, Time, UUID, ListOrgs(), UpdateOrgGovernance()

### Community 112 - "AI Services"
Cohesion: 0.31
Nodes (7): EffectiveAISettings, EffectiveSettings(), GetAISettings(), GetSettings(), DB, HandlerFunc, ListProviders()

### Community 113 - "Token Services"
Cohesion: 0.28
Nodes (7): GenerateOrgToken(), GeneratePersonalToken(), Time, UUID, CreateUserToken(), Context, DB

### Community 114 - "Administration Handlers"
Cohesion: 0.36
Nodes (7): Context, StatusNotFound(), CreateOIDCDebugSession(), GetOIDCDebugSession(), Context, UUID, oidcDebugOwnerID()

### Community 115 - "Scans Handlers"
Cohesion: 0.28
Nodes (7): GetQueueSummary(), DB, HandlerFunc, T, TestGetQueueSummaryUsesOrganizationScope(), TestGetQueueSummaryUsesPersonalScope(), QueueSummary

### Community 116 - "Database Migrations"
Cohesion: 0.33
Nodes (9): Database Connection: localhost:5432 / justscan, Add ghost and total_steps to executions, columnExists, executions Table, ghost Column, Migration Registration Initializer, Migrations.MustRegister, Remove ghost and total_steps from executions (+1 more)

### Community 117 - "Database Init"
Cohesion: 0.32
Nodes (7): DB, StartDatabase(), StartPostgres(), DB, InitMultiOIDC(), SetAuthRegisterRateLimit(), SetPublicScanRateLimit()

### Community 118 - "Swagger Router"
Cohesion: 0.32
Nodes (7): Engine, FileSystem, Handler, getSwaggerV2Handler(), Context, mkdirAllWebDAV(), Swagger()

### Community 119 - "Dashboard Handlers"
Cohesion: 0.36
Nodes (7): countsTowardDashboardFindings(), isBlockedByXrayPolicyStatus(), summarizeActiveXrayScans(), T, TestCountsTowardDashboardFindings(), TestIsBlockedByXrayPolicyStatus(), TestSummarizeActiveXrayScansUsesQueuedFallback()

### Community 120 - "Scans Handlers"
Cohesion: 0.43
Nodes (7): Compare(), CompareScan(), countSevMap(), GetSBOM(), DB, HandlerFunc, compareVuln

### Community 121 - "Scans Handlers"
Cohesion: 0.39
Nodes (7): DB, HandlerFunc, UUID, GrantScanOrgAccess(), ListScanOrgGrants(), RevokeScanOrgAccess(), scanOrgGrant

### Community 122 - "Tokens Handlers"
Cohesion: 0.25
Nodes (6): Context, DB, RevokeCurrentToken(), DB, RouterGroup, Token()

### Community 123 - "Tokens Handlers"
Cohesion: 0.25
Nodes (6): Context, DB, Context, DB, ValidateServiceToken(), ValidateToken()

### Community 124 - "Ownership Services"
Cohesion: 0.48
Nodes (6): ApplyWorkspaceScope(), ApplyWorkspaceScopeValue(), Context, SelectQuery, UUID, HasOrgRoleAtLeast()

### Community 125 - "Dashboard Handlers"
Cohesion: 0.29
Nodes (5): GetScannerHealth(), HandlerFunc, Dashboard(), DB, RouterGroup

### Community 126 - "Scans Handlers"
Cohesion: 0.38
Nodes (6): BulkAddTagToScans(), BulkDeleteScans(), DB, HandlerFunc, bulkDeleteRequest, bulkTagRequest

### Community 127 - "Scans Handlers"
Cohesion: 0.43
Nodes (6): Context, DB, HandlerFunc, UUID, loadEnrichedScan(), RefreshXrayPolicyViolations()

### Community 128 - "Search Handlers"
Cohesion: 0.29
Nodes (6): DB, HandlerFunc, Search(), imageResult, scanResult, vulnResult

### Community 129 - "Shared Tokens"
Cohesion: 0.29
Nodes (6): IncBridgeTokenRequest, IncExpireTokenRequest, Tokens, BaseModel, Time, UUID

### Community 130 - "Grype Scanner"
Cohesion: 0.62
Nodes (6): assertHasKBRef(), assertHasString(), T, TestExtractGrypeKBEntriesMergesDuplicateAliases(), TestMergeLocalScannerFindingsKeepsBestDetails(), TestParseGrypeVulnerabilitiesPrefersCanonicalCVE()

### Community 131 - "Xray Log Keys Scanner"
Cohesion: 0.48
Nodes (6): Context, UUID, xrayRegistryIDFromContext(), xrayScanContext(), xrayScanIDFromContext(), xrayContextKey

### Community 132 - "Database Migrations"
Cohesion: 0.60
Nodes (5): createSchema(), dropSchema(), Context, DB, init()

### Community 133 - "Database Migrations"
Cohesion: 0.60
Nodes (5): createScanTables(), dropScanTables(), Context, DB, init()

### Community 134 - "Database Migrations"
Cohesion: 0.60
Nodes (5): createSuppressionTable(), dropSuppressionTable(), Context, DB, init()

### Community 135 - "Database Migrations"
Cohesion: 0.60
Nodes (5): createTagsTables(), dropTagsTables(), Context, DB, init()

### Community 136 - "Database Migrations"
Cohesion: 0.60
Nodes (5): createRegistriesTable(), dropRegistriesTable(), Context, DB, init()

### Community 137 - "Database Migrations"
Cohesion: 0.60
Nodes (5): createSBOMTable(), dropSBOMTable(), Context, DB, init()

### Community 138 - "Database Migrations"
Cohesion: 0.60
Nodes (5): createWatchlistTable(), dropWatchlistTable(), Context, DB, init()

### Community 139 - "Database Migrations"
Cohesion: 0.60
Nodes (5): createVulnKBTable(), dropVulnKBTable(), Context, DB, init()

### Community 140 - "Docker Entrypoint"
Cohesion: 0.47
Nodes (4): scanner_trivy_enabled(), setup_custom_ca_bundle(), docker-entrypoint.sh script, TRIVY_CACHE_DIR

### Community 141 - "Organizations Handlers"
Cohesion: 0.47
Nodes (5): DB, Sqlmock, T, newMockBunDB(), TestUpdateOrgRequiresAdminRole()

### Community 142 - "Scans Handlers"
Cohesion: 0.73
Nodes (5): DeleteScanArtifactGroup(), deleteScanGroup(), DeleteScanImageGroup(), DB, HandlerFunc

### Community 143 - "Scans Handlers"
Cohesion: 0.47
Nodes (5): CreateShare(), DeleteShare(), DB, HandlerFunc, createShareRequest

### Community 144 - "Shared Helm Scan Runs"
Cohesion: 0.33
Nodes (5): helmRunRow, HelmScanRun, BaseModel, Time, UUID

### Community 145 - "Administration Handlers"
Cohesion: 0.40
Nodes (4): AdminScanRow, Context, DB, ListAdminScans()

### Community 146 - "Configuration Module"
Cohesion: 0.60
Nodes (4): T, TestValidateAcceptsStrongSecrets(), TestValidateAllowsWeakSecretsWithExplicitEscapeHatch(), TestValidateRejectsWeakSecretsByDefault()

### Community 147 - "Administration Handlers"
Cohesion: 0.60
Nodes (4): GetAPIRequestLogs(), GetAPIUsageStats(), Context, DB

### Community 148 - "Administration Handlers"
Cohesion: 0.60
Nodes (4): GetXRayRequestLogs(), GetXRayUsageStats(), Context, DB

### Community 149 - "Scans Handlers"
Cohesion: 0.40
Nodes (4): GetTrends(), DB, HandlerFunc, trendRow

### Community 150 - "Shared Module"
Cohesion: 0.60
Nodes (4): JWTBridgeClaim, JWTClaim, UUID, RegisteredClaims

### Community 151 - "Shared Manual Findings"
Cohesion: 0.40
Nodes (4): ManualFinding, BaseModel, Time, UUID

### Community 152 - "Shared OSV Cache"
Cohesion: 0.60
Nodes (4): OSVPackageCache, OSVPackageFinding, BaseModel, Time

### Community 153 - "Configuration Module"
Cohesion: 0.40
Nodes (5): Grype Scanner: disabled, OSV Java Augmentation: enabled, Grype Executable: grype, Container Scanner Settings, Trivy Executable: trivy

### Community 154 - "Administration Handlers"
Cohesion: 0.50
Nodes (3): GetAuditLogs(), Context, DB

### Community 155 - "Organizations Handlers"
Cohesion: 0.67
Nodes (3): boolPtr(), T, TestPolicyIncludeSuppressedOrDefault()

### Community 156 - "Scans Handlers"
Cohesion: 0.67
Nodes (3): T, TestScopedOrgIDFromScopeValue(), TestSummarizeScanComplianceRows()

### Community 157 - "Scans Handlers"
Cohesion: 0.50
Nodes (3): ExportScan(), DB, HandlerFunc

### Community 158 - "Scans Handlers"
Cohesion: 0.67
Nodes (3): T, TestScanOwnershipWhereUsesProvidedAlias(), TestScanScopeWhereUsesProvidedAlias()

### Community 159 - "Scans Handlers"
Cohesion: 0.50
Nodes (3): GetIntelligencePolicyImpact(), DB, HandlerFunc

### Community 160 - "Scans Handlers"
Cohesion: 0.50
Nodes (3): DB, HandlerFunc, ListScans()

### Community 161 - "Scans Handlers"
Cohesion: 0.50
Nodes (3): GetVulnerabilityHistory(), DB, HandlerFunc

### Community 162 - "Status Pages Handlers"
Cohesion: 0.50
Nodes (3): DB, HandlerFunc, ViewStatusPageItemVulnerabilityContextAnalysisBySlug()

### Community 163 - "Users Handlers"
Cohesion: 0.50
Nodes (3): Context, DB, ListUserTokens()

### Community 164 - "Users Handlers"
Cohesion: 0.50
Nodes (3): Context, DB, RevokeUserToken()

### Community 165 - "Request Log Middleware"
Cohesion: 0.50
Nodes (3): DB, HandlerFunc, RequestLog()

### Community 166 - "Shared Settings"
Cohesion: 0.50
Nodes (3): SystemSetting, BaseModel, Time

### Community 167 - "Configuration Module"
Cohesion: 0.50
Nodes (4): Allow Insecure Defaults: enabled, Callback Allowed CIDRs, Callback Allowed Hosts, Security Settings

### Community 168 - "Configuration Module"
Cohesion: 0.50
Nodes (4): Vulnerability Cache Duration: 7 days, CVE History Tracking: enabled, NVD API Key: unset, Vulnerability Knowledge Base Settings

### Community 171 - "Logo Module"
Cohesion: 0.67
Nodes (3): Dark Monochrome Brand Mark, JL Monogram, JustLab Logo

## Knowledge Gaps
- **61 isolated node(s):** `TRIVY_CACHE_DIR`, `justscan-backend`, `createAIProviderRequest`, `updateAIProviderRequest`, `testAIProviderRequest` (+56 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Scan` connect `Public Handlers` to `Git Repositories Services`, `Suppression Handlers`, `Compliance Intelligence`, `Pipelines Pipeline Scans`, `Watchlist Handlers`, `Tags Handlers`, `Intelligence Scanner`, `Status Pages Handlers`, `Helm Handlers`, `Trivy Scanner`, `Scans Handlers`, `Xray Scanner`, `Status Pages Handlers`, `CVE History Scanner`, `Worker Scanner`, `Progress Scanner`, `Dashboard Handlers`, `Xray Scanner`, `Shared Handlers`, `Trivy Scanner`, `Scans Handlers`, `Helm Handlers`, `Shared Vuln KB`, `Scans Handlers`, `Status Pages Handlers`, `Shared Vulnerability Intelligence`, `Xray Scanner`, `Xray Scanner`, `Blockedpolicy Services`, `Scans Handlers`, `Dashboard Handlers`, `Scans Handlers`?**
  _High betweenness centrality (0.272) - this node is a cross-community bridge._
- **Why does `Admin()` connect `Administration Handlers` to `Handlers Module`, `Administration Handlers`, `Administration Handlers`, `Condition Options Handlers`, `Administration Handlers`, `Administration Handlers`, `AI Services`, `Administration Handlers`, `Administration Handlers`, `Administration Handlers`, `Httperror Services`, `Administration Handlers`, `Administration Handlers`, `Dashboard Handlers`, `Httperror Services`, `Administration Handlers`, `Condition Options Handlers`, `Router Module`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Why does `StartRouter()` connect `Router Module` to `Suppression Handlers`, `Git Repositories Handlers`, `Watchlist Handlers`, `Tags Handlers`, `Helm Registry Credentials Handlers`, `Helm Scanner`, `Vulnerability KB Handlers`, `Organizations Handlers`, `Status Pages Handlers`, `Capabilities Scanner`, `Handlers Module`, `Request Log Middleware`, `Registries Handlers`, `Configuration Module`, `AI Handlers`, `Shared Handlers`, `Administration Handlers`, `Scans Handlers`, `Registries Handlers`, `Comments Handlers`, `Swagger Router`, `Tokens Handlers`, `Dashboard Handlers`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Are the 58 inferred relationships involving `RequireRequestUser()` (e.g. with `LoadAuthorizedHelmRegistryCredential()` and `CreateConversation()`) actually correct?**
  _`RequireRequestUser()` has 58 INFERRED edges - model-reasoned connections that need verification._
- **Are the 66 inferred relationships involving `Admin()` (e.g. with `CreateAIProvider()` and `DeleteAIProvider()`) actually correct?**
  _`Admin()` has 66 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `RequireOrgRole()` (e.g. with `IsReadOnlyRequest()` and `TransferOrgOwnedResource()`) actually correct?**
  _`RequireOrgRole()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **What connects `TRIVY_CACHE_DIR`, `justscan-backend`, `createAIProviderRequest` to the rest of the system?**
  _61 weakly-connected nodes found - possible documentation gaps or missing edges._