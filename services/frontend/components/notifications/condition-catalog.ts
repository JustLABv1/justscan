import type {
  NotificationConditionOption as ApiNotificationConditionOption,
  NotificationConditionPredicate,
} from '@/lib/api';

export type ConditionValue = string | string[];

export type ConditionOption = ApiNotificationConditionOption & {
  legacy?: boolean;
};

export const eventTypeOptions: ConditionOption[] = [
  { value: 'scan_complete', label: 'Scan complete' },
  { value: 'scan_failed', label: 'Scan failed' },
  { value: 'compliance_failed', label: 'Compliance failed' },
  { value: 'intelligence_policy_impact', label: 'CVE intelligence policy impact' },
];

const scanProviderOptions: ConditionOption[] = [
  { value: 'trivy', label: 'Trivy' },
  { value: 'artifactory_xray', label: 'Artifactory Xray' },
];

const scanStatusOptions: ConditionOption[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const severityOptions: ConditionOption[] = [
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

const complianceStatusOptions: ConditionOption[] = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'needs_validation', label: 'Needs validation' },
  { value: 'mixed', label: 'Mixed' },
];

const intelligenceImpactOptions: ConditionOption[] = [
  { value: 'resolved', label: 'Resolved' },
  { value: 'new_failure', label: 'New failure' },
  { value: 'still_failed', label: 'Still failed' },
  { value: 'needs_validation', label: 'Needs validation' },
];

const booleanOptions: ConditionOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

export const conditionFieldOptions = [
  'event_type',
  'user_id',
  'org_id',
  'image_ref',
  'scan_provider',
  'scan_status',
  'highest_severity',
  'highest_cvss',
  'critical_count',
  'high_count',
  'medium_count',
  'low_count',
  'unknown_count',
  'suppressed_count',
  'compliance_failed',
  'compliance_status',
  'policy_id',
  'policy_name',
  'intelligence_impact',
  'historical_compliance_status',
  'current_compliance_status',
  'xray_blocked',
  'xray_policy_name',
  'xray_watch_name',
  'tag',
] as const;

export type ConditionField = (typeof conditionFieldOptions)[number];
export type ConditionKind = 'enum' | 'dynamic' | 'pattern' | 'numeric' | 'boolean' | 'severity';

export const conditionFieldLabels: Record<ConditionField, string> = {
  event_type: 'Event type',
  user_id: 'User',
  org_id: 'Organization',
  image_ref: 'Image reference',
  scan_provider: 'Scan provider',
  scan_status: 'Scan status',
  highest_severity: 'Highest severity',
  highest_cvss: 'Highest CVSS',
  critical_count: 'Critical findings',
  high_count: 'High findings',
  medium_count: 'Medium findings',
  low_count: 'Low findings',
  unknown_count: 'Unknown findings',
  suppressed_count: 'Suppressed findings',
  compliance_failed: 'Compliance failed',
  compliance_status: 'Compliance status',
  policy_id: 'Policy ID',
  policy_name: 'Policy name',
  intelligence_impact: 'Intelligence impact',
  historical_compliance_status: 'Historical compliance status',
  current_compliance_status: 'Current compliance status',
  xray_blocked: 'Blocked by Xray',
  xray_policy_name: 'Xray policy name',
  xray_watch_name: 'Xray watch name',
  tag: 'Tag',
};

export const operatorLabels: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  in: 'is one of',
  matches: 'matches pattern',
  matches_any: 'matches any pattern',
  gte: 'is at least',
  gt: 'is greater than',
  lte: 'is at most',
  lt: 'is less than',
  gte_severity: 'is at least severity',
};

const operatorOptionsByKind: Record<ConditionKind, string[]> = {
  enum: ['eq', 'neq', 'in'],
  dynamic: ['eq', 'neq', 'in'],
  pattern: ['eq', 'neq', 'contains', 'in', 'matches_any'],
  numeric: ['eq', 'gte', 'gt', 'lte', 'lt'],
  boolean: ['eq'],
  severity: ['eq', 'gte_severity'],
};

type ConditionDefinition = {
  label: string;
  kind: ConditionKind;
  operators?: string[];
  defaultOperator?: string;
  options?: ConditionOption[];
  placeholder?: string;
  description?: string;
  defaultValue: string;
};

const definitions: Record<ConditionField, ConditionDefinition> = {
  event_type: {
    label: conditionFieldLabels.event_type,
    kind: 'enum',
    options: eventTypeOptions,
    defaultValue: eventTypeOptions[0].value,
  },
  user_id: {
    label: conditionFieldLabels.user_id,
    kind: 'dynamic',
    placeholder: 'Search users',
    description: 'Only users visible in this notification scope are suggested.',
    defaultValue: '',
  },
  org_id: {
    label: conditionFieldLabels.org_id,
    kind: 'dynamic',
    placeholder: 'Search organizations',
    description: 'Only organizations visible in this notification scope are suggested.',
    defaultValue: '',
  },
  image_ref: {
    label: conditionFieldLabels.image_ref,
    kind: 'pattern',
    operators: ['eq', 'contains', 'matches', 'matches_any'],
    placeholder: 'Search images or type a pattern',
    description: 'Use contains or a pattern operator for an image not in the suggestions.',
    defaultValue: '',
  },
  scan_provider: {
    label: conditionFieldLabels.scan_provider,
    kind: 'enum',
    options: scanProviderOptions,
    defaultValue: scanProviderOptions[0].value,
  },
  scan_status: {
    label: conditionFieldLabels.scan_status,
    kind: 'enum',
    options: scanStatusOptions,
    defaultValue: scanStatusOptions[0].value,
  },
  highest_severity: {
    label: conditionFieldLabels.highest_severity,
    kind: 'severity',
    options: severityOptions,
    defaultValue: 'HIGH',
  },
  highest_cvss: {
    label: conditionFieldLabels.highest_cvss,
    kind: 'numeric',
    defaultOperator: 'gte',
    placeholder: '7.0',
    description: 'Enter a CVSS score from 0 to 10.',
    defaultValue: '7',
  },
  critical_count: {
    label: conditionFieldLabels.critical_count,
    kind: 'numeric',
    placeholder: '1',
    defaultValue: '0',
  },
  high_count: {
    label: conditionFieldLabels.high_count,
    kind: 'numeric',
    placeholder: '5',
    defaultValue: '0',
  },
  medium_count: {
    label: conditionFieldLabels.medium_count,
    kind: 'numeric',
    placeholder: '10',
    defaultValue: '0',
  },
  low_count: {
    label: conditionFieldLabels.low_count,
    kind: 'numeric',
    placeholder: '20',
    defaultValue: '0',
  },
  unknown_count: {
    label: conditionFieldLabels.unknown_count,
    kind: 'numeric',
    placeholder: '0',
    defaultValue: '0',
  },
  suppressed_count: {
    label: conditionFieldLabels.suppressed_count,
    kind: 'numeric',
    placeholder: '0',
    defaultValue: '0',
  },
  compliance_failed: {
    label: conditionFieldLabels.compliance_failed,
    kind: 'boolean',
    options: booleanOptions,
    defaultValue: 'true',
  },
  compliance_status: {
    label: conditionFieldLabels.compliance_status,
    kind: 'enum',
    options: complianceStatusOptions,
    defaultValue: 'fail',
  },
  policy_id: {
    label: conditionFieldLabels.policy_id,
    kind: 'dynamic',
    placeholder: 'Search policies by name or ID',
    description: 'Policy IDs are stored in the rule; names are shown to help you choose.',
    defaultValue: '',
  },
  policy_name: {
    label: conditionFieldLabels.policy_name,
    kind: 'pattern',
    placeholder: 'Search policies or type a name',
    description: 'Use contains for a partial policy name.',
    defaultValue: '',
  },
  intelligence_impact: {
    label: conditionFieldLabels.intelligence_impact,
    kind: 'enum',
    options: intelligenceImpactOptions,
    defaultValue: intelligenceImpactOptions[0].value,
  },
  historical_compliance_status: {
    label: conditionFieldLabels.historical_compliance_status,
    kind: 'enum',
    options: complianceStatusOptions,
    defaultValue: 'fail',
  },
  current_compliance_status: {
    label: conditionFieldLabels.current_compliance_status,
    kind: 'enum',
    options: complianceStatusOptions,
    defaultValue: 'fail',
  },
  xray_blocked: {
    label: conditionFieldLabels.xray_blocked,
    kind: 'boolean',
    options: booleanOptions,
    defaultValue: 'true',
  },
  xray_policy_name: {
    label: conditionFieldLabels.xray_policy_name,
    kind: 'pattern',
    placeholder: 'Search Xray policies or type a pattern',
    description: 'Use contains or a pattern operator for values not in the suggestions.',
    defaultValue: '',
  },
  xray_watch_name: {
    label: conditionFieldLabels.xray_watch_name,
    kind: 'pattern',
    placeholder: 'Search Xray watches or type a pattern',
    description: 'Use contains or a pattern operator for values not in the suggestions.',
    defaultValue: '',
  },
  tag: {
    label: conditionFieldLabels.tag,
    kind: 'pattern',
    placeholder: 'Search tags or type a partial name',
    description: 'Only tags visible in this notification scope are suggested.',
    defaultValue: '',
  },
};

export function getConditionDefinition(field: string): ConditionDefinition {
  return (
    definitions[field as ConditionField] ?? {
      label: field,
      kind: 'pattern',
      options: [],
      placeholder: 'Saved legacy value',
      defaultValue: '',
    }
  );
}

export function getOperatorOptions(field: string, currentOperator?: string) {
  const definition = getConditionDefinition(field);
  const options = [...(definition.operators ?? operatorOptionsByKind[definition.kind])];
  if (currentOperator && !options.includes(currentOperator)) {
    options.push(currentOperator);
  }
  return options;
}

export function getDefaultOperator(field: string) {
  const definition = getConditionDefinition(field);
  const options = getOperatorOptions(field);
  return definition.defaultOperator && options.includes(definition.defaultOperator)
    ? definition.defaultOperator
    : (options[0] ?? 'eq');
}

export function getDefaultConditionValue(field: string): ConditionValue {
  return getConditionDefinition(field).defaultValue;
}

export function isMultiValueOperator(operator: string) {
  return operator === 'in' || operator === 'matches_any';
}

export function allowsCustomConditionValue(field: string, operator: string) {
  const kind = getConditionDefinition(field).kind;
  return (
    (kind === 'pattern' || kind === 'dynamic') &&
    (operator === 'contains' || operator === 'matches' || operator === 'matches_any')
  );
}

export function normalizeConditionValue(operator: string, value: ConditionValue): ConditionValue {
  if (isMultiValueOperator(operator)) {
    if (Array.isArray(value)) return value;
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

export function conditionValueIsEmpty(value: ConditionValue) {
  return Array.isArray(value) ? value.length === 0 : value.trim() === '';
}

export function parseConditionValue(
  field: string,
  operator: string,
  value: ConditionValue
): NotificationConditionPredicate['value'] {
  const normalized = normalizeConditionValue(operator, value);
  if (isMultiValueOperator(operator)) {
    return Array.isArray(normalized)
      ? normalized.map((item) => item.trim()).filter(Boolean)
      : normalized
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
  }

  const trimmed = String(normalized).trim();
  if (getConditionDefinition(field).kind === 'boolean') {
    return trimmed === 'true';
  }
  if (getConditionDefinition(field).kind === 'numeric') {
    return trimmed === '' ? '' : Number(trimmed);
  }
  return trimmed;
}

export function formatConditionValue(
  value: NotificationConditionPredicate['value'] | ConditionValue
) {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export function conditionOptionLabel(field: string, value: string, options: ConditionOption[]) {
  const option = options.find((item) => item.value === value);
  return option?.label ?? value;
}

export function mergeConditionOptions(
  field: string,
  options: ConditionOption[],
  value: ConditionValue
) {
  const definitionOptions = getConditionDefinition(field).options ?? [];
  const merged = [...definitionOptions, ...options];
  const seen = new Set<string>();
  const result = merged.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
  const values = Array.isArray(value) ? value : [value];
  for (const savedValue of values) {
    if (!savedValue || seen.has(savedValue)) continue;
    result.push({
      value: savedValue,
      label: `Saved legacy value: ${savedValue}`,
      description: 'This value is no longer available in the current scope.',
      legacy: true,
    });
    seen.add(savedValue);
  }
  return result;
}
