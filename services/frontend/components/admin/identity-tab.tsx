'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { StatusAlert } from '@/components/ui/form-alert';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  adminCreateGroupMapping,
  adminCreateOIDCProvider,
  adminCreateOIDCDebugSession,
  adminCreateOIDCRoleOverride,
  adminDeleteGroupMapping,
  adminDeleteOIDCProvider,
  adminDeleteOIDCRoleOverride,
  adminListGroupMappings,
  adminListOIDCProviders,
  adminListOIDCRoleOverrides,
  adminPreviewOIDCClaimSync,
  adminGetOIDCDebugSession,
  adminUpdateGroupMapping,
  adminUpdateOIDCProvider,
  adminUpdateOIDCRoleOverride,
} from '@/lib/api/admin';
import { getApiBase } from '@/lib/api/base';
import { listOrgs } from '@/lib/api/orgs';
import type {
  OIDCClaimSyncPreview,
  OIDCDebugReport,
  OIDCGroupMapping,
  OIDCOrgRoleOverride,
  OIDCProviderAdmin,
} from '@/lib/api/types/registries';
import type { Org } from '@/lib/api/types/orgs';
import { deferEffect } from '@/lib/defer-effect';
import {
  Button,
  Card,
  Chip,
  Input,
  ListBox,
  Modal,
  SearchField,
  Select,
  Switch,
  Table,
  Tabs,
  TextArea,
  useOverlayState,
} from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, Refresh01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

function parseDelimitedList(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function buildSuggestedRedirectUri(apiBase: string, providerName: string) {
  const base = trimTrailingSlash(apiBase);
  const name = providerName.trim();
  if (!base || !name) {
    return '';
  }
  return `${base}/api/v1/auth/oidc/${encodeURIComponent(name)}/callback`;
}

function renderClaimMappingPreview(
  template: string,
  providerName: string,
  matchType: 'exact' | 'prefix' | 'regex',
  matchValue: string,
  previewClaim: string
) {
  const normalizedMatchValue = matchValue.trim();
  const exampleClaim = previewClaim.trim() || (matchType === 'prefix'
    ? `${normalizedMatchValue || 'team:'}platform`
    : normalizedMatchValue || 'platform-admins');
  let exampleSuffix = '';
  let matches = true;
  let error = '';
  if (matchType === 'prefix') {
    matches = exampleClaim.startsWith(normalizedMatchValue);
    exampleSuffix = matches ? exampleClaim.slice(normalizedMatchValue.length).trim() : '';
  } else if (matchType === 'regex') {
    try {
      const result = new RegExp(normalizedMatchValue).exec(exampleClaim);
      matches = result !== null;
      exampleSuffix = result?.[1]?.trim() ?? '';
    } catch {
      matches = false;
      error = 'Invalid regular expression';
    }
  }
  const preview = (template || '{claim}')
    .replaceAll('{claim}', exampleClaim)
    .replaceAll('{suffix}', exampleSuffix)
    .replaceAll('{provider}', providerName || 'provider');

  return {
    claim: exampleClaim,
    suffix: exampleSuffix,
    preview,
    matches,
    error,
  };
}

function Banner({ type, text }: { type: 'success' | 'error'; text: string }) {
  return (
    <StatusAlert
      status={type === 'success' ? 'success' : 'danger'}
      title={type === 'success' ? 'Identity configuration updated' : 'Identity action failed'}
      description={text}
    />
  );
}

export function IdentityTab() {
  const [providers, setProviders] = useState<OIDCProviderAdmin[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');

  const [selectedProvider, setSelectedProvider] = useState<OIDCProviderAdmin | null>(null);
  const [mappings, setMappings] = useState<OIDCGroupMapping[]>([]);
  const [roleOverrides, setRoleOverrides] = useState<OIDCOrgRoleOverride[]>([]);

  const [previewGroupsInput, setPreviewGroupsInput] = useState('');
  const [previewRolesInput, setPreviewRolesInput] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<OIDCClaimSyncPreview | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugReport, setDebugReport] = useState<OIDCDebugReport | null>(null);

  const providerModal = useOverlayState();
  const mappingModal = useOverlayState();
  const overrideModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [editingProvider, setEditingProvider] = useState<OIDCProviderAdmin | null>(null);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [buttonColor, setButtonColor] = useState('');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [redirectUriEdited, setRedirectUriEdited] = useState(false);
  const [scopesInput, setScopesInput] = useState('openid, profile, email');
  const [adminGroupsInput, setAdminGroupsInput] = useState('');
  const [adminRolesInput, setAdminRolesInput] = useState('');
  const [includedGroupsInput, setIncludedGroupsInput] = useState('');
  const [excludedGroupsInput, setExcludedGroupsInput] = useState('');
  const [includedOrgNamesInput, setIncludedOrgNamesInput] = useState('');
  const [excludedOrgNamesInput, setExcludedOrgNamesInput] = useState('');
  const [groupsClaim, setGroupsClaim] = useState('groups');
  const [rolesClaim, setRolesClaim] = useState('roles');
  const [providerEnabled, setProviderEnabled] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [providerFormError, setProviderFormError] = useState('');
  const [providerStep, setProviderStep] = useState(0);

  const [editingMapping, setEditingMapping] = useState<OIDCGroupMapping | null>(null);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingFormError, setMappingFormError] = useState('');
  const [mappingEffect, setMappingEffect] = useState<'allow' | 'exclude'>('allow');
  const [mappingClaimType, setMappingClaimType] = useState<'group' | 'role'>('group');
  const [mappingMatchType, setMappingMatchType] = useState<'exact' | 'prefix' | 'regex'>('exact');
  const [mappingMatchValue, setMappingMatchValue] = useState('');
  const [mappingPreviewClaim, setMappingPreviewClaim] = useState('m017-1_default-roles-m017-1');
  const [mappingProvisioningMode, setMappingProvisioningMode] = useState<'existing_org' | 'create_org'>('existing_org');
  const [mappingOrgId, setMappingOrgId] = useState('');
  const [mappingOrgNameTemplate, setMappingOrgNameTemplate] = useState('{claim}');
  const [mappingRole, setMappingRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');
  const [mappingRecreateMissingOrg, setMappingRecreateMissingOrg] = useState(false);
  const [mappingRemoveOnUnsync, setMappingRemoveOnUnsync] = useState(true);

  const [editingOverride, setEditingOverride] = useState<OIDCOrgRoleOverride | null>(null);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideFormError, setOverrideFormError] = useState('');
  const [overrideClaimType, setOverrideClaimType] = useState<'group' | 'role'>('group');
  const [overrideMatchType, setOverrideMatchType] = useState<'exact' | 'prefix' | 'regex'>('exact');
  const [overrideMatchValue, setOverrideMatchValue] = useState('');
  const [overrideTargetType, setOverrideTargetType] = useState<'org_id' | 'rendered_name'>('org_id');
  const [overrideOrgId, setOverrideOrgId] = useState('');
  const [overrideOrgNameTemplate, setOverrideOrgNameTemplate] = useState('{claim}');
  const [overrideRole, setOverrideRole] = useState<'viewer' | 'editor' | 'admin'>('admin');

  const apiBase = (() => {
    const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (configured) {
      return trimTrailingSlash(configured);
    }
    if (typeof window !== 'undefined') {
      return trimTrailingSlash(window.location.origin);
    }
    return '';
  })();

  const suggestedRedirectUri = useMemo(
    () => buildSuggestedRedirectUri(apiBase, providerName),
    [apiBase, providerName]
  );

  const resolvedRedirectUri = redirectUriEdited ? redirectUri : suggestedRedirectUri;

  const redirectUriMismatch = useMemo(() => {
    if (!suggestedRedirectUri || !resolvedRedirectUri.trim()) {
      return false;
    }
    return trimTrailingSlash(resolvedRedirectUri) !== trimTrailingSlash(suggestedRedirectUri);
  }, [resolvedRedirectUri, suggestedRedirectUri]);

  const mappingTemplatePreview = useMemo(
    () =>
      renderClaimMappingPreview(
        mappingOrgNameTemplate,
        selectedProvider?.name ?? 'provider',
        mappingMatchType,
        mappingMatchValue,
        mappingPreviewClaim
      ),
    [mappingOrgNameTemplate, selectedProvider?.name, mappingMatchType, mappingMatchValue, mappingPreviewClaim]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [providerData, orgData] = await Promise.all([adminListOIDCProviders(), listOrgs()]);
      setProviders(providerData);
      setOrgs(orgData);
      setSelectedProvider((current) =>
        current ? providerData.find((provider) => provider.name === current.name) ?? null : null
      );
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load identity providers');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSelectedDetails = useCallback(async () => {
    if (!selectedProvider) {
      setMappings([]);
      setRoleOverrides([]);
      return;
    }
    try {
      const [nextMappings, nextOverrides] = await Promise.all([
        adminListGroupMappings(selectedProvider.name),
        adminListOIDCRoleOverrides(selectedProvider.name),
      ]);
      setMappings(nextMappings);
      setRoleOverrides(nextOverrides);
    } catch (detailError: unknown) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load provider details');
    }
  }, [selectedProvider]);

  useEffect(() => deferEffect(load), [load]);
  useEffect(() => deferEffect(loadSelectedDetails), [loadSelectedDetails]);
  useEffect(
    () =>
      deferEffect(async () => {
        if (loading) return;
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('oidc_debug');
        if (!sessionId) return;
        setDebugLoading(true);
        try {
          const session = await adminGetOIDCDebugSession(sessionId);
          if (session.status !== 'complete' || !session.report) {
            throw new Error('OIDC diagnostic session has not completed');
          }
          setDebugReport(session.report);
          setSelectedProvider((current) =>
            current?.name === session.provider_name
              ? current
              : providers.find((provider) => provider.name === session.provider_name) ?? current
          );
          params.delete('oidc_debug');
          const query = params.toString();
          window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
        } catch (debugError: unknown) {
          setError(debugError instanceof Error ? debugError.message : 'Failed to load OIDC diagnostic result');
        } finally {
          setDebugLoading(false);
        }
      }),
    [loading, providers]
  );

  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return providers.filter((provider) =>
      q.length === 0 ||
      provider.name.toLowerCase().includes(q) ||
      provider.display_name.toLowerCase().includes(q) ||
      provider.issuer_url.toLowerCase().includes(q)
    );
  }, [providers, search]);

  function openCreateProvider() {
    setEditingProvider(null);
    setProviderName('');
    setDisplayName('');
    setButtonColor('');
    setIssuerUrl('');
    setClientId('');
    setClientSecret('');
    setRedirectUri('');
    setRedirectUriEdited(false);
    setScopesInput('openid, profile, email');
    setAdminGroupsInput('');
    setAdminRolesInput('');
    setIncludedGroupsInput('');
    setExcludedGroupsInput('');
    setIncludedOrgNamesInput('');
    setExcludedOrgNamesInput('');
    setGroupsClaim('groups');
    setRolesClaim('roles');
    setProviderEnabled(true);
    setSortOrder(String(providers.length));
    setProviderFormError('');
    setProviderStep(0);
    providerModal.open();
  }

  function openEditProvider(provider: OIDCProviderAdmin) {
    setEditingProvider(provider);
    setProviderName(provider.name);
    setDisplayName(provider.display_name);
    setButtonColor(provider.button_color ?? '');
    setIssuerUrl(provider.issuer_url);
    setClientId(provider.client_id);
    setClientSecret('');
    setRedirectUri(provider.redirect_uri);
    setRedirectUriEdited(true);
    setScopesInput((provider.scopes ?? []).join(', '));
    setAdminGroupsInput((provider.admin_groups ?? []).join(', '));
    setAdminRolesInput((provider.admin_roles ?? []).join(', '));
    setIncludedGroupsInput((provider.included_groups ?? []).join(', '));
    setExcludedGroupsInput((provider.excluded_groups ?? []).join(', '));
    setIncludedOrgNamesInput((provider.included_org_names ?? []).join(', '));
    setExcludedOrgNamesInput((provider.excluded_org_names ?? []).join(', '));
    setGroupsClaim(provider.groups_claim || 'groups');
    setRolesClaim(provider.roles_claim || 'roles');
    setProviderEnabled(provider.enabled);
    setSortOrder(String(provider.sort_order ?? 0));
    setProviderFormError('');
    setProviderStep(0);
    providerModal.open();
  }

  function validateProviderStep(step: number) {
    if (step === 0) {
      if (
        !providerName.trim() ||
        !displayName.trim() ||
        !issuerUrl.trim() ||
        !clientId.trim() ||
        !resolvedRedirectUri.trim()
      ) {
        return 'Please complete all required connection fields.';
      }
      if (!editingProvider && !clientSecret.trim()) {
        return 'Client secret is required when creating a provider.';
      }
    }
    if (step === 1) {
      if (parseDelimitedList(scopesInput).length === 0) {
        return 'At least one scope is required.';
      }
    }
    return '';
  }

  function requiredLabel(text: string) {
    return (
      <span>
        {text} <span className="text-danger">*</span>
      </span>
    );
  }

  function providerStepTitle(step: number) {
    if (step === 0) return 'Connection Basics';
    if (step === 1) return 'Access Rules';
    return 'Claims and Ordering';
  }

  function providerStepDescription(step: number) {
    if (step === 0) return 'Define provider identity and OIDC connection details.';
    if (step === 1) return 'Control scopes and provider-level claim filtering behavior.';
    return 'Finalize claim extraction, login button styling, and provider order.';
  }

  function goToNextProviderStep() {
    const nextError = validateProviderStep(providerStep);
    if (nextError) {
      setProviderFormError(nextError);
      return;
    }
    setProviderFormError('');
    setProviderStep((current) => Math.min(current + 1, 2));
  }

  function handlePrimaryProviderAction() {
    if (providerStep < 2) {
      goToNextProviderStep();
      return;
    }
    const form = document.getElementById('identity-provider-form') as HTMLFormElement | null;
    form?.requestSubmit();
  }

  async function handleProviderSubmit(event: React.FormEvent) {
    event.preventDefault();
    setProviderSaving(true);
    setProviderFormError('');
    try {
      const payload = {
        name: providerName.trim(),
        display_name: displayName.trim(),
        button_color: buttonColor.trim() || undefined,
        issuer_url: issuerUrl.trim(),
        client_id: clientId.trim(),
        ...(clientSecret.trim() ? { client_secret: clientSecret.trim() } : {}),
        redirect_uri: resolvedRedirectUri.trim(),
        scopes: parseDelimitedList(scopesInput),
        admin_groups: parseDelimitedList(adminGroupsInput),
        admin_roles: parseDelimitedList(adminRolesInput),
        included_groups: parseDelimitedList(includedGroupsInput),
        excluded_groups: parseDelimitedList(excludedGroupsInput),
        included_org_names: parseDelimitedList(includedOrgNamesInput),
        excluded_org_names: parseDelimitedList(excludedOrgNamesInput),
        groups_claim: groupsClaim.trim() || 'groups',
        roles_claim: rolesClaim.trim() || 'roles',
        enabled: providerEnabled,
        sort_order: Number.parseInt(sortOrder, 10) || 0,
      };

      if (editingProvider) {
        await adminUpdateOIDCProvider(editingProvider.name, payload);
      } else {
        if (!payload.name || !clientSecret.trim()) {
          throw new Error('Name and client secret are required when creating a provider');
        }
        await adminCreateOIDCProvider(payload);
      }

      providerModal.close();
      await load();
      setSuccess(editingProvider ? 'Provider updated' : 'Provider created');
      setTimeout(() => setSuccess(''), 2500);
    } catch (saveError: unknown) {
      setProviderFormError(saveError instanceof Error ? saveError.message : 'Failed to save provider');
    } finally {
      setProviderSaving(false);
    }
  }

  async function handleToggleEnabled(provider: OIDCProviderAdmin) {
    try {
      await adminUpdateOIDCProvider(provider.name, { enabled: !provider.enabled });
      await load();
    } catch (toggleError: unknown) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update provider state');
    }
  }

  async function handleDeleteProvider(name: string) {
    const ok = await confirm({
      title: 'Delete OIDC Provider',
      message: `Remove provider "${name}"? This will break logins using this provider.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminDeleteOIDCProvider(name);
      if (selectedProvider?.name === name) setSelectedProvider(null);
      await load();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete provider');
    }
  }

  function openCreateMapping() {
    if (!selectedProvider) return;
    setEditingMapping(null);
    setMappingEffect('allow');
    setMappingClaimType('group');
    setMappingMatchType('exact');
    setMappingMatchValue('');
    setMappingPreviewClaim('m017-1_default-roles-m017-1');
    setMappingProvisioningMode(orgs.length > 0 ? 'existing_org' : 'create_org');
    setMappingOrgId(orgs[0]?.id ?? '');
    setMappingOrgNameTemplate('{claim}');
    setMappingRole(orgs.length > 0 ? 'viewer' : 'admin');
    setMappingRecreateMissingOrg(false);
    setMappingRemoveOnUnsync(true);
    setMappingFormError('');
    mappingModal.open();
  }

  function openEditMapping(mapping: OIDCGroupMapping) {
    setEditingMapping(mapping);
    setMappingEffect(mapping.effect);
    setMappingClaimType(mapping.claim_type);
    setMappingMatchType(mapping.match_type);
    setMappingMatchValue(mapping.match_value);
    setMappingPreviewClaim(
      mapping.match_type === 'prefix'
        ? `${mapping.match_value}platform`
        : mapping.match_type === 'exact'
          ? mapping.match_value
          : 'm017-1_default-roles-m017-1'
    );
    setMappingProvisioningMode(mapping.provisioning_mode);
    setMappingOrgId(mapping.org_id ?? '');
    setMappingOrgNameTemplate(mapping.org_name_template || '{claim}');
    setMappingRole((mapping.role as 'viewer' | 'editor' | 'admin') || 'viewer');
    setMappingRecreateMissingOrg(mapping.recreate_missing_org);
    setMappingRemoveOnUnsync(mapping.remove_on_unsync);
    setMappingFormError('');
    mappingModal.open();
  }

  async function handleMappingSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProvider) return;
    setMappingSaving(true);
    setMappingFormError('');
    try {
      const payload = {
        effect: mappingEffect,
        claim_type: mappingClaimType,
        match_type: mappingMatchType,
        match_value: mappingMatchValue.trim(),
        provisioning_mode: mappingEffect === 'exclude' ? undefined : mappingProvisioningMode,
        org_id: mappingEffect === 'exclude' ? undefined : mappingProvisioningMode === 'existing_org' ? mappingOrgId : undefined,
        org_name_template:
          mappingEffect === 'exclude'
            ? ''
            : mappingProvisioningMode === 'create_org' || mappingRecreateMissingOrg
            ? mappingOrgNameTemplate.trim()
            : '',
        role: mappingEffect === 'exclude' ? undefined : mappingRole,
        recreate_missing_org:
          mappingEffect === 'exclude' || mappingProvisioningMode !== 'existing_org'
            ? false
            : mappingRecreateMissingOrg,
        remove_on_unsync: mappingEffect === 'exclude' ? undefined : mappingRemoveOnUnsync,
      };

      if (editingMapping) {
        await adminUpdateGroupMapping(selectedProvider.name, editingMapping.id, payload);
      } else {
        await adminCreateGroupMapping(selectedProvider.name, payload);
      }
      mappingModal.close();
      await loadSelectedDetails();
    } catch (saveError: unknown) {
      setMappingFormError(saveError instanceof Error ? saveError.message : 'Failed to save mapping');
    } finally {
      setMappingSaving(false);
    }
  }

  async function handleDeleteMapping(mappingId: string) {
    if (!selectedProvider) return;
    const ok = await confirm({
      title: 'Delete Claim Mapping',
      message: 'Remove this OIDC claim mapping rule?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminDeleteGroupMapping(selectedProvider.name, mappingId);
      await loadSelectedDetails();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete mapping');
    }
  }

  function openCreateOverride() {
    if (!selectedProvider) return;
    setEditingOverride(null);
    setOverrideClaimType('group');
    setOverrideMatchType('exact');
    setOverrideMatchValue('');
    setOverrideTargetType(orgs.length > 0 ? 'org_id' : 'rendered_name');
    setOverrideOrgId(orgs[0]?.id ?? '');
    setOverrideOrgNameTemplate('{claim}');
    setOverrideRole('admin');
    setOverrideFormError('');
    overrideModal.open();
  }

  function openEditOverride(override: OIDCOrgRoleOverride) {
    setEditingOverride(override);
    setOverrideClaimType(override.claim_type);
    setOverrideMatchType(override.match_type);
    setOverrideMatchValue(override.match_value);
    setOverrideTargetType(override.target_type);
    setOverrideOrgId(override.org_id ?? '');
    setOverrideOrgNameTemplate(override.org_name_template || '{claim}');
    setOverrideRole(override.role);
    setOverrideFormError('');
    overrideModal.open();
  }

  async function handleOverrideSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProvider) return;
    setOverrideSaving(true);
    setOverrideFormError('');
    try {
      const payload = {
        claim_type: overrideClaimType,
        match_type: overrideMatchType,
        match_value: overrideMatchValue.trim(),
        target_type: overrideTargetType,
        org_id: overrideTargetType === 'org_id' ? overrideOrgId : undefined,
        org_name_template: overrideTargetType === 'rendered_name' ? overrideOrgNameTemplate.trim() : '',
        role: overrideRole,
      };
      if (editingOverride) {
        await adminUpdateOIDCRoleOverride(selectedProvider.name, editingOverride.id, payload);
      } else {
        await adminCreateOIDCRoleOverride(selectedProvider.name, payload);
      }
      overrideModal.close();
      await loadSelectedDetails();
    } catch (saveError: unknown) {
      setOverrideFormError(saveError instanceof Error ? saveError.message : 'Failed to save role override');
    } finally {
      setOverrideSaving(false);
    }
  }

  async function handleDeleteOverride(overrideId: string) {
    if (!selectedProvider) return;
    const ok = await confirm({
      title: 'Delete Role Override',
      message: 'Remove this role override rule?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminDeleteOIDCRoleOverride(selectedProvider.name, overrideId);
      await loadSelectedDetails();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete role override');
    }
  }

  async function handlePreview(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProvider) return;
    setPreviewLoading(true);
    try {
      const result = await adminPreviewOIDCClaimSync(selectedProvider.name, {
        groups: parseDelimitedList(previewGroupsInput),
        roles: parseDelimitedList(previewRolesInput),
      });
      setPreview(result);
    } catch (previewError: unknown) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to preview claim sync');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleStartOIDCDebug() {
    if (!selectedProvider) return;
    setDebugLoading(true);
    setDebugReport(null);
    setError('');
    try {
      const session = await adminCreateOIDCDebugSession(selectedProvider.name);
      window.location.assign(`${getApiBase()}${session.login_url}`);
    } catch (debugError: unknown) {
      setError(debugError instanceof Error ? debugError.message : 'Failed to start OIDC diagnostics');
      setDebugLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Banner type="error" text={error} />}
      {success && <Banner type="success" text={success} />}

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SearchField name="admin-identity-provider-search" variant="secondary" className="w-full sm:max-w-sm">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder="Filter providers by name, display name, or issuer..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button variant="secondary" onPress={openCreateProvider}>
            <PlusSignIcon size={15} />
            Add Provider
          </Button>
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="OIDC providers" className="min-w-[1100px]">
              <Table.Header>
                <Table.Column>Select</Table.Column>
                <Table.Column isRowHeader>Provider</Table.Column>
                <Table.Column>Issuer</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Mappings</Table.Column>
                <Table.Column>Overrides</Table.Column>
                <Table.Column className="text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading providers...' : 'No providers found.'}
                  </div>
                )}
              >
                {filteredProviders.map((provider) => (
                  <Table.Row
                    key={provider.name}
                    id={provider.name}
                    className={provider.name === selectedProvider?.name ? 'bg-[var(--row-hover)]' : 'hover:bg-[var(--row-hover)]'}
                  >
                    <Table.Cell>
                      <Button
                        size="sm"
                        variant={provider.name === selectedProvider?.name ? 'primary' : 'secondary'}
                        onPress={() => setSelectedProvider(provider)}
                      >
                        {provider.name === selectedProvider?.name ? 'Selected' : 'Select'}
                      </Button>
                    </Table.Cell>
                    <Table.Cell>
                      <button className="text-left" onClick={() => setSelectedProvider(provider)} type="button">
                        <p className="font-medium underline-offset-4 hover:underline">{provider.display_name}</p>
                        <p className="text-xs text-zinc-500 font-mono">{provider.name}</p>
                      </button>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500 font-mono">{provider.issuer_url}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft" color={provider.enabled ? 'success' : 'default'}>
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">{provider.name === selectedProvider?.name ? mappings.length : '-'}</Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">{provider.name === selectedProvider?.name ? roleOverrides.length : '-'}</Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for provider ${provider.display_name}`}
                          items={[
                            {
                              id: 'toggle',
                              label: provider.enabled ? 'Disable provider' : 'Enable provider',
                              icon: <Refresh01Icon size={15} />,
                              onAction: () => {
                                void handleToggleEnabled(provider);
                              },
                            },
                            {
                              id: 'edit',
                              label: 'Edit provider',
                              icon: <PencilEdit01Icon size={15} />,
                              onAction: () => openEditProvider(provider),
                            },
                            {
                              id: 'delete',
                              label: 'Delete provider',
                              icon: <Delete01Icon size={15} />,
                              variant: 'danger',
                              onAction: () => {
                                void handleDeleteProvider(provider.name);
                              },
                            },
                          ]}
                        />
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card>

      {!selectedProvider && (
        <Card className="border border-divider/60 bg-content2/30">
          <Card.Content>
            <p className="text-sm text-zinc-500">
              Select a provider row above to configure claim mappings, role overrides, and claim sync preview.
            </p>
          </Card.Content>
        </Card>
      )}

      {selectedProvider && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Claim Mappings</h3>
              <Button size="sm" variant="secondary" onPress={openCreateMapping}>Add Mapping</Button>
            </div>
            <Table variant="secondary">
              <Table.Content aria-label="Claim mappings">
                <Table.Header>
                  <Table.Column isRowHeader>Claim</Table.Column>
                  <Table.Column>Target</Table.Column>
                  <Table.Column>Role</Table.Column>
                  <Table.Column className="text-right">Actions</Table.Column>
                </Table.Header>
                <Table.Body renderEmptyState={() => <div className="py-6 text-center text-sm text-zinc-500">No mappings configured.</div>}>
                  {mappings.map((mapping) => (
                    <Table.Row key={mapping.id} id={mapping.id}>
                      <Table.Cell>
                        <p className="font-mono text-xs">{mapping.match_value}</p>
                        <p className="text-xs text-zinc-500">{mapping.claim_type} · {mapping.match_type} · {mapping.effect}</p>
                      </Table.Cell>
                      <Table.Cell className="text-xs text-zinc-500">{mapping.org_name ?? mapping.org_id ?? 'Derived'}</Table.Cell>
                      <Table.Cell className="text-xs uppercase tracking-[0.12em] text-zinc-500">{mapping.effect === 'exclude' ? '—' : mapping.role}</Table.Cell>
                      <Table.Cell>
                        <div className="flex justify-end">
                          <RowActionsMenu
                            label={`Open actions for mapping ${mapping.match_value}`}
                            items={[
                              {
                                id: 'edit',
                                label: 'Edit mapping',
                                icon: <PencilEdit01Icon size={15} />,
                                onAction: () => openEditMapping(mapping),
                              },
                              {
                                id: 'delete',
                                label: 'Delete mapping',
                                icon: <Delete01Icon size={15} />,
                                variant: 'danger',
                                onAction: () => {
                                  void handleDeleteMapping(mapping.id);
                                },
                              },
                            ]}
                          />
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Role Overrides</h3>
              <Button size="sm" variant="secondary" onPress={openCreateOverride}>Add Override</Button>
            </div>
            <Table variant="secondary">
              <Table.Content aria-label="Role overrides">
                <Table.Header>
                  <Table.Column isRowHeader>Claim</Table.Column>
                  <Table.Column>Target</Table.Column>
                  <Table.Column>Role</Table.Column>
                  <Table.Column className="text-right">Actions</Table.Column>
                </Table.Header>
                <Table.Body renderEmptyState={() => <div className="py-6 text-center text-sm text-zinc-500">No overrides configured.</div>}>
                  {roleOverrides.map((override) => (
                    <Table.Row key={override.id} id={override.id}>
                      <Table.Cell>
                        <p className="font-mono text-xs">{override.match_value}</p>
                        <p className="text-xs text-zinc-500">{override.claim_type} · {override.match_type}</p>
                      </Table.Cell>
                      <Table.Cell className="text-xs text-zinc-500">{override.org_name ?? override.org_id ?? override.org_name_template}</Table.Cell>
                      <Table.Cell className="text-xs uppercase tracking-[0.12em] text-zinc-500">{override.role}</Table.Cell>
                      <Table.Cell>
                        <div className="flex justify-end">
                          <RowActionsMenu
                            label={`Open actions for override ${override.match_value}`}
                            items={[
                              {
                                id: 'edit',
                                label: 'Edit override',
                                icon: <PencilEdit01Icon size={15} />,
                                onAction: () => openEditOverride(override),
                              },
                              {
                                id: 'delete',
                                label: 'Delete override',
                                icon: <Delete01Icon size={15} />,
                                variant: 'danger',
                                onAction: () => {
                                  void handleDeleteOverride(override.id);
                                },
                              },
                            ]}
                          />
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table>
          </Card>
        </div>
      )}

      {selectedProvider && (
        <Card className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Live OIDC Diagnostics</h3>
              <p className="max-w-3xl text-sm text-zinc-500">
                Sign in through {selectedProvider.display_name} to inspect the verified ID token and UserInfo claims.
                This does not provision a user, change roles, sync organizations, or create a JustScan session.
              </p>
            </div>
            <Button
              variant="secondary"
              isPending={debugLoading}
              isDisabled={!selectedProvider.enabled}
              onPress={() => void handleStartOIDCDebug()}
            >
              {debugLoading ? 'Starting…' : 'Sign in and inspect claims'}
            </Button>
          </div>

          {!selectedProvider.enabled && (
            <p className="text-sm text-warning">Enable this provider before starting a diagnostic login.</p>
          )}

          {debugReport && debugReport.provider_name === selectedProvider.name && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Card variant="secondary">
                  <Card.Header>
                    <Card.Title>Groups</Card.Title>
                    <Card.Description className="font-mono">{debugReport.groups_claim_path}</Card.Description>
                  </Card.Header>
                  <Card.Content className="flex flex-wrap gap-2">
                    {(debugReport.resolved_groups ?? []).length > 0
                      ? (debugReport.resolved_groups ?? []).map((group) => <Chip key={group} size="sm" variant="soft">{group}</Chip>)
                      : <span className="text-sm text-zinc-500">No groups resolved</span>}
                  </Card.Content>
                </Card>
                <Card variant="secondary">
                  <Card.Header>
                    <Card.Title>Roles</Card.Title>
                    <Card.Description className="font-mono">{debugReport.roles_claim_path}</Card.Description>
                  </Card.Header>
                  <Card.Content className="flex flex-wrap gap-2">
                    {(debugReport.resolved_roles ?? []).length > 0
                      ? (debugReport.resolved_roles ?? []).map((role) => <Chip key={role} size="sm" variant="soft">{role}</Chip>)
                      : <span className="text-sm text-zinc-500">No roles resolved</span>}
                  </Card.Content>
                </Card>
                <Card variant="secondary">
                  <Card.Header>
                    <Card.Title>Keycloak paths</Card.Title>
                    <Card.Description>Automatically included in role resolution</Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-2 text-xs">
                    <p><span className="text-zinc-500">Realm:</span> <code>realm_access.roles</code> ({(debugReport.realm_roles ?? []).length})</p>
                    <p><span className="text-zinc-500">Client:</span> <code>{debugReport.client_roles_path}</code> ({(debugReport.client_roles ?? []).length})</p>
                    <Chip size="sm" variant="soft" color={debugReport.would_be_admin ? 'success' : 'default'}>
                      {debugReport.would_be_admin ? 'Would receive admin role' : 'Would receive user role'}
                    </Chip>
                  </Card.Content>
                </Card>
              </div>

              {debugReport.userinfo_error && (
                <p className="text-sm text-warning">UserInfo could not be read: {debugReport.userinfo_error}</p>
              )}

              <Tabs defaultSelectedKey="id-token" variant="secondary">
                <Tabs.ListContainer>
                  <Tabs.List aria-label="OIDC diagnostic claim sources">
                    <Tabs.Tab id="id-token">ID token<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="userinfo">UserInfo<Tabs.Indicator /></Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
                <Tabs.Panel id="id-token">
                  <pre className="max-h-[32rem] overflow-auto rounded-xl bg-content2 p-4 text-xs leading-5">
                    {JSON.stringify(debugReport.id_token_claims, null, 2)}
                  </pre>
                </Tabs.Panel>
                <Tabs.Panel id="userinfo">
                  <pre className="max-h-[32rem] overflow-auto rounded-xl bg-content2 p-4 text-xs leading-5">
                    {JSON.stringify(debugReport.userinfo_claims ?? {}, null, 2)}
                  </pre>
                </Tabs.Panel>
              </Tabs>
              <p className="text-xs text-zinc-500">
                OAuth tokens, authorization codes, and client credentials are never included. This result expires shortly.
              </p>
            </div>
          )}
        </Card>
      )}

      {selectedProvider && (
        <Card className="space-y-4">
          <h3 className="text-base font-semibold">Claim Sync Preview</h3>
          <form className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end" onSubmit={handlePreview}>
            <TextArea
              value={previewGroupsInput}
              onChange={(event) => setPreviewGroupsInput(event.target.value)}
              variant="secondary"
              placeholder="groups (comma or newline separated)"
              rows={4}
            />
            <TextArea
              value={previewRolesInput}
              onChange={(event) => setPreviewRolesInput(event.target.value)}
              variant="secondary"
              placeholder="roles (comma or newline separated)"
              rows={4}
            />
            <Button type="submit" variant="secondary" isDisabled={previewLoading}>
              {previewLoading ? 'Running...' : 'Run Preview'}
            </Button>
          </form>

          {preview && (
            <Table variant="secondary">
              <Table.Content aria-label="Preview memberships">
                <Table.Header>
                  <Table.Column isRowHeader>Org</Table.Column>
                  <Table.Column>Claim</Table.Column>
                  <Table.Column>Role</Table.Column>
                  <Table.Column>Behavior</Table.Column>
                </Table.Header>
                <Table.Body renderEmptyState={() => <div className="py-6 text-center text-sm text-zinc-500">No memberships.</div>}>
                  {preview.final_memberships.map((membership, index) => (
                    <Table.Row key={`${membership.mapping_id}-${membership.org_name}-${index}`} id={`${membership.mapping_id}-${index}`}>
                      <Table.Cell>{membership.org_name}</Table.Cell>
                      <Table.Cell className="font-mono text-xs text-zinc-500">{membership.claim}</Table.Cell>
                      <Table.Cell className="text-xs text-zinc-500">{membership.base_role} → {membership.final_role}</Table.Cell>
                      <Table.Cell className="text-xs text-zinc-500">{membership.provisioning_mode === 'create_org' ? 'Create org' : 'Existing org'}{membership.override_applied ? ' · Override applied' : ''}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table>
          )}
        </Card>
      )}

      <Modal state={providerModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="cover" placement="center">
            <Modal.Dialog className="mx-auto w-full max-w-[1040px]">
              <Modal.Header>
                <Modal.Heading>{editingProvider ? 'Edit Provider' : 'Add Provider'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="min-h-0 max-h-[80vh] overflow-y-auto py-5">
                <div className="space-y-5">
                  <p className="text-sm text-zinc-500">
                    Configure identity provider details in three steps. {editingProvider ? 'Update connection details and policy controls.' : 'Create a new OIDC provider with claim governance defaults.'}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Chip variant={providerStep === 0 ? 'primary' : 'soft'} color={providerStep === 0 ? 'accent' : 'default'}>1. Basics</Chip>
                    <Chip variant={providerStep === 1 ? 'primary' : 'soft'} color={providerStep === 1 ? 'accent' : 'default'}>2. Access Rules</Chip>
                    <Chip variant={providerStep === 2 ? 'primary' : 'soft'} color={providerStep === 2 ? 'accent' : 'default'}>3. Claims & Order</Chip>
                  </div>
                  <Card className="border border-divider/60 bg-content2/30">
                    <Card.Content>
                      <p className="text-sm font-semibold">{providerStepTitle(providerStep)}</p>
                      <p className="mt-1 text-sm text-zinc-500">{providerStepDescription(providerStep)}</p>
                    </Card.Content>
                  </Card>

                  <form id="identity-provider-form" className="space-y-5" onSubmit={handleProviderSubmit}>
                    {providerFormError && <p className="text-sm text-danger">{providerFormError}</p>}

                    {providerStep === 0 && (
                      <div className="space-y-4">
                        <Card className="border border-divider/60 bg-content1">
                          <Card.Content className="space-y-4">
                            <p className="text-sm font-semibold">Provider Identity</p>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">{requiredLabel('Provider Name')}</p><Input className="w-full" variant="secondary" placeholder="e.g. keycloak-main" value={providerName} onChange={(event) => setProviderName(event.target.value)} required /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">{requiredLabel('Display Name')}</p><Input className="w-full" variant="secondary" placeholder="Shown on login button" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></div>
                            </div>
                          </Card.Content>
                        </Card>
                        <Card className="border border-divider/60 bg-content1">
                          <Card.Content className="space-y-4">
                            <p className="text-sm font-semibold">OIDC Handshake</p>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5 md:col-span-2"><p className="text-sm text-zinc-500">{requiredLabel('Issuer URL')}</p><Input className="w-full" variant="secondary" placeholder="https://issuer.example.com/realms/main" value={issuerUrl} onChange={(event) => setIssuerUrl(event.target.value)} required /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">{requiredLabel('Client ID')}</p><Input className="w-full" variant="secondary" placeholder="OIDC client identifier" value={clientId} onChange={(event) => setClientId(event.target.value)} required /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">{editingProvider ? 'Client Secret' : requiredLabel('Client Secret')}</p><Input className="w-full" type="password" variant="secondary" placeholder={editingProvider ? 'Leave blank to keep current secret' : 'Client secret'} value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} required={!editingProvider} /></div>
                            </div>
                          </Card.Content>
                        </Card>
                        <div className="space-y-1">
                          <p className="text-sm text-zinc-500">{requiredLabel('Redirect URI')}</p>
                          <Input
                            className="w-full"
                            variant="secondary"
                            placeholder={suggestedRedirectUri || 'Enter provider name to auto-generate callback URI'}
                            value={resolvedRedirectUri}
                            onChange={(event) => {
                              setRedirectUri(event.target.value);
                              setRedirectUriEdited(true);
                            }}
                            required
                          />
                          <p className="text-sm text-zinc-500">
                            Recommended: {suggestedRedirectUri || 'Enter a provider name first.'}
                          </p>
                          {redirectUriMismatch && (
                            <p className="text-sm text-amber-600 dark:text-amber-400">
                              This URI differs from the recommended provider callback path.
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {providerStep === 1 && (
                      <div className="space-y-4">
                        <Card className="border border-divider/60 bg-content1">
                          <Card.Content className="space-y-4">
                            <p className="text-sm font-semibold">Scope and Admin Signals</p>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5 md:col-span-2"><p className="text-sm text-zinc-500">{requiredLabel('Scopes')}</p><Input className="w-full" variant="secondary" placeholder="openid, profile, email" value={scopesInput} onChange={(event) => setScopesInput(event.target.value)} required /><p className="text-sm text-zinc-500">Comma-separated scopes requested during sign-in.</p></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Admin Groups</p><Input className="w-full" variant="secondary" placeholder="platform-admins, secops" value={adminGroupsInput} onChange={(event) => setAdminGroupsInput(event.target.value)} /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Admin Roles</p><Input className="w-full" variant="secondary" placeholder="admin, superuser" value={adminRolesInput} onChange={(event) => setAdminRolesInput(event.target.value)} /></div>
                            </div>
                          </Card.Content>
                        </Card>
                        <Card className="border border-divider/60 bg-content1">
                          <Card.Content className="space-y-4">
                            <p className="text-sm font-semibold">Provider Filters</p>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Included Groups</p><Input className="w-full" variant="secondary" placeholder="Only allow these groups" value={includedGroupsInput} onChange={(event) => setIncludedGroupsInput(event.target.value)} /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Excluded Groups</p><Input className="w-full" variant="secondary" placeholder="Always deny these groups" value={excludedGroupsInput} onChange={(event) => setExcludedGroupsInput(event.target.value)} /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Included Org Names</p><Input className="w-full" variant="secondary" placeholder="engineering, ops" value={includedOrgNamesInput} onChange={(event) => setIncludedOrgNamesInput(event.target.value)} /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Excluded Org Names</p><Input className="w-full" variant="secondary" placeholder="contractors, archived" value={excludedOrgNamesInput} onChange={(event) => setExcludedOrgNamesInput(event.target.value)} /></div>
                            </div>
                          </Card.Content>
                        </Card>
                      </div>
                    )}

                    {providerStep === 2 && (
                      <div className="space-y-4">
                        <Card className="border border-divider/60 bg-content1">
                          <Card.Content className="space-y-4">
                            <p className="text-sm font-semibold">Claim Extraction</p>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Groups Claim</p><Input className="w-full" variant="secondary" placeholder="groups" value={groupsClaim} onChange={(event) => setGroupsClaim(event.target.value)} /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Roles Claim</p><Input className="w-full" variant="secondary" placeholder="roles" value={rolesClaim} onChange={(event) => setRolesClaim(event.target.value)} /></div>
                            </div>
                          </Card.Content>
                        </Card>
                        <Card className="border border-divider/60 bg-content1">
                          <Card.Content className="space-y-4">
                            <p className="text-sm font-semibold">Presentation and Ordering</p>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Button Color</p><Input className="w-full" variant="secondary" placeholder="#0F766E (optional)" value={buttonColor} onChange={(event) => setButtonColor(event.target.value)} /></div>
                              <div className="space-y-1.5"><p className="text-sm text-zinc-500">Sort Order</p><Input className="w-full" type="number" variant="secondary" placeholder="0" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></div>
                            </div>
                            <div className="rounded-medium border border-divider/60 bg-content2/20 p-4">
                              <Switch isSelected={providerEnabled} onChange={setProviderEnabled}>
                                <Switch.Content>
                                  <Switch.Control><Switch.Thumb /></Switch.Control>
                                  Provider enabled
                                </Switch.Content>
                              </Switch>
                              <p className="mt-2 text-sm text-zinc-500">Disabled providers stay configured but are hidden from the login screen.</p>
                            </div>
                          </Card.Content>
                        </Card>
                      </div>
                    )}
                  </form>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button type="button" variant="secondary" onPress={providerModal.close}>Cancel</Button>
                {providerStep > 0 && (
                  <Button type="button" variant="secondary" onPress={() => setProviderStep((current) => Math.max(current - 1, 0))}>
                    Back
                  </Button>
                )}
                {providerStep < 2 ? (
                  <Button type="button" variant="primary" onPress={handlePrimaryProviderAction}>
                    Next
                  </Button>
                ) : (
                  <Button type="button" variant="primary" isDisabled={providerSaving} onPress={handlePrimaryProviderAction}>
                    {providerSaving ? 'Saving...' : editingProvider ? 'Save Provider' : 'Create Provider'}
                  </Button>
                )}
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={mappingModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{editingMapping ? 'Edit Mapping' : 'Add Mapping'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="identity-mapping-form" className="space-y-3" onSubmit={handleMappingSubmit}>
                  {mappingFormError && <p className="text-sm text-danger">{mappingFormError}</p>}
                  <Card className="border border-divider/60 bg-content2/30">
                    <Card.Content className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">Template Variables</p>
                      <p className="text-sm text-zinc-500">Use {'{claim}'} for the full claim, {'{suffix}'} for prefix leftovers or the first regex capture group, and {'{provider}'} for the identity provider name.</p>
                    </Card.Content>
                  </Card>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select value={mappingEffect} onChange={(value) => setMappingEffect(value as 'allow' | 'exclude')} variant="secondary">
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox><ListBox.Item id="allow">Allow</ListBox.Item><ListBox.Item id="exclude">Exclude</ListBox.Item></ListBox></Select.Popover>
                    </Select>
                    <Select value={mappingClaimType} onChange={(value) => setMappingClaimType(value as 'group' | 'role')} variant="secondary">
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox><ListBox.Item id="group">Group</ListBox.Item><ListBox.Item id="role">Role</ListBox.Item></ListBox></Select.Popover>
                    </Select>
                    <Select value={mappingMatchType} onChange={(value) => setMappingMatchType(value as 'exact' | 'prefix' | 'regex')} variant="secondary">
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox><ListBox.Item id="exact">Exact</ListBox.Item><ListBox.Item id="prefix">Prefix</ListBox.Item><ListBox.Item id="regex">Regex</ListBox.Item></ListBox></Select.Popover>
                    </Select>
                    <Input className="w-full" variant="secondary" placeholder={mappingMatchType === 'regex' ? '^m[^_]+_default-roles-(.+)$' : 'Claim value'} value={mappingMatchValue} onChange={(event) => setMappingMatchValue(event.target.value)} required />
                  </div>
                  {mappingEffect !== 'exclude' && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Select value={mappingProvisioningMode} onChange={(value) => setMappingProvisioningMode(value as 'existing_org' | 'create_org')} variant="secondary">
                          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                          <Select.Popover><ListBox><ListBox.Item id="existing_org">Use existing org</ListBox.Item><ListBox.Item id="create_org">Create org</ListBox.Item></ListBox></Select.Popover>
                        </Select>
                        <Select value={mappingRole} onChange={(value) => setMappingRole(value as 'viewer' | 'editor' | 'admin')} variant="secondary">
                          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                          <Select.Popover><ListBox><ListBox.Item id="viewer">Viewer</ListBox.Item><ListBox.Item id="editor">Editor</ListBox.Item><ListBox.Item id="admin">Admin</ListBox.Item></ListBox></Select.Popover>
                        </Select>
                      </div>
                      <p className="text-sm text-zinc-500">Create org uses the template to provision orgs from claim values. Recreate missing org re-creates previously deleted orgs when a matching claim returns.</p>
                      {mappingProvisioningMode === 'existing_org' && (
                        <Select value={mappingOrgId} onChange={(value) => setMappingOrgId(String(value))} variant="secondary">
                        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {orgs.map((org) => (
                                <ListBox.Item key={org.id} id={org.id}>{org.name}</ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      )}
                      <Input className="w-full" variant="secondary" placeholder="Org template" value={mappingOrgNameTemplate} onChange={(event) => setMappingOrgNameTemplate(event.target.value)} />
                      <p className="text-sm text-zinc-500">For prefix matches, {'{suffix}'} is the leftover value. For regex matches, it is the first capture group.</p>
                      {(mappingProvisioningMode === 'create_org' || mappingRecreateMissingOrg) && (
                        <Card className="border border-divider/60 bg-content2/30">
                          <Card.Content className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">Live Preview</p>
                            <label className="text-sm text-zinc-500" htmlFor="mapping-preview-claim">Preview claim <span className="text-xs">(not saved)</span></label>
                            <Input id="mapping-preview-claim" className="w-full" variant="secondary" placeholder="Paste a real group or role claim" value={mappingPreviewClaim} onChange={(event) => setMappingPreviewClaim(event.target.value)} />
                            <p className="text-sm text-zinc-500">Claim: <span className="font-mono">{mappingTemplatePreview.claim}</span></p>
                            <p className={mappingTemplatePreview.matches ? 'text-sm text-success' : 'text-sm text-warning'}>{mappingTemplatePreview.error || (mappingTemplatePreview.matches ? 'Preview claim matches' : 'Preview claim does not match')}</p>
                            <p className="text-sm text-zinc-500">Suffix: <span className="font-mono">{mappingTemplatePreview.suffix || '(empty)'}</span></p>
                            <p className="text-sm text-zinc-500">Resolved org name: <span className="font-mono">{mappingTemplatePreview.preview}</span></p>
                          </Card.Content>
                        </Card>
                      )}
                      <div className="grid gap-2">
                        {mappingProvisioningMode === 'existing_org' ? (
                          <Switch isSelected={mappingRecreateMissingOrg} onChange={setMappingRecreateMissingOrg}>
                            <Switch.Content>
                              <Switch.Control><Switch.Thumb /></Switch.Control>
                              Recreate missing org
                            </Switch.Content>
                          </Switch>
                        ) : (
                          <p className="text-sm text-zinc-500">
                            Create org mappings already create missing orgs automatically from the rendered template.
                          </p>
                        )}
                        <Switch isSelected={mappingRemoveOnUnsync} onChange={setMappingRemoveOnUnsync}>
                          <Switch.Content>
                            <Switch.Control><Switch.Thumb /></Switch.Control>
                            Remove on unsync
                          </Switch.Content>
                        </Switch>
                      </div>
                    </>
                  )}
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={mappingModal.close}>Cancel</Button>
                <Button type="submit" form="identity-mapping-form" variant="primary" isDisabled={mappingSaving}>
                  {mappingSaving ? 'Saving...' : editingMapping ? 'Save Mapping' : 'Create Mapping'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={overrideModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{editingOverride ? 'Edit Override' : 'Add Override'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="identity-override-form" className="space-y-3" onSubmit={handleOverrideSubmit}>
                  {overrideFormError && <p className="text-sm text-danger">{overrideFormError}</p>}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select value={overrideClaimType} onChange={(value) => setOverrideClaimType(value as 'group' | 'role')} variant="secondary">
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox><ListBox.Item id="group">Group</ListBox.Item><ListBox.Item id="role">Role</ListBox.Item></ListBox></Select.Popover>
                    </Select>
                    <Select value={overrideMatchType} onChange={(value) => setOverrideMatchType(value as 'exact' | 'prefix' | 'regex')} variant="secondary">
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox><ListBox.Item id="exact">Exact</ListBox.Item><ListBox.Item id="prefix">Prefix</ListBox.Item><ListBox.Item id="regex">Regex</ListBox.Item></ListBox></Select.Popover>
                    </Select>
                    <Input className="w-full" variant="secondary" placeholder={overrideMatchType === 'regex' ? '^m[^_]+_default-roles-(.+)$' : 'Claim value'} value={overrideMatchValue} onChange={(event) => setOverrideMatchValue(event.target.value)} required />
                    <Select value={overrideTargetType} onChange={(value) => setOverrideTargetType(value as 'org_id' | 'rendered_name')} variant="secondary">
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox><ListBox.Item id="org_id">Organization</ListBox.Item><ListBox.Item id="rendered_name">Rendered name</ListBox.Item></ListBox></Select.Popover>
                    </Select>
                  </div>
                  {overrideTargetType === 'org_id' ? (
                    <Select value={overrideOrgId} onChange={(value) => setOverrideOrgId(String(value))} variant="secondary">
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {orgs.map((org) => (
                            <ListBox.Item key={org.id} id={org.id}>{org.name}</ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  ) : (
                    <Input className="w-full" variant="secondary" placeholder="Org template" value={overrideOrgNameTemplate} onChange={(event) => setOverrideOrgNameTemplate(event.target.value)} />
                  )}
                  <Select value={overrideRole} onChange={(value) => setOverrideRole(value as 'viewer' | 'editor' | 'admin')} variant="secondary">
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover><ListBox><ListBox.Item id="viewer">Viewer</ListBox.Item><ListBox.Item id="editor">Editor</ListBox.Item><ListBox.Item id="admin">Admin</ListBox.Item></ListBox></Select.Popover>
                  </Select>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={overrideModal.close}>Cancel</Button>
                <Button type="submit" form="identity-override-form" variant="primary" isDisabled={overrideSaving}>
                  {overrideSaving ? 'Saving...' : editingOverride ? 'Save Override' : 'Create Override'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {confirmDialog}
    </div>
  );
}
