export const ALERT_SEVERITIES = {
  HIGH: 'high',
  BLOCKER: 'blocker',
};

export const ALERT_RULES = [
  {
    id: 'owner-denied-repeated',
    name: 'Repeated owner-denied access events',
    severity: ALERT_SEVERITIES.HIGH,
    signal: 'logs.access_denied',
    condition: {
      where: {
        owner_denied: true,
      },
      groupBy: ['tenant_id', 'actor', 'route', 'owner_reason'],
      threshold: 3,
      windowMinutes: 10,
    },
    route: 'primary-on-call',
  },
  {
    id: 'tenant-creation-failure-rate',
    name: 'Tenant creation failure-rate threshold',
    severity: ALERT_SEVERITIES.BLOCKER,
    signal: 'logs.tenant_creation_failed',
    condition: {
      groupBy: ['environment'],
      thresholdPercent: 20,
      minimumAttempts: 5,
      windowMinutes: 10,
    },
    route: 'primary-and-secondary-on-call',
  },
];

export function getAlertRule(ruleId) {
  return ALERT_RULES.find((rule) => rule.id === ruleId) || null;
}
