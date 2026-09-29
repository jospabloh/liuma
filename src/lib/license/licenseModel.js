/**
 * licenseModel.js — Pure license-management logic for LIUMA (no React, no env,
 * no Base44 access) so it can be unit-tested with `node --test` and reused by
 * both the UI (LicenseAdmin, useSubscription, useFeatureGate) and onboarding.
 *
 * Mirrors FlowFin's license management adapted to LIUMA's school tenancy:
 *   - License TYPES (tiers): start → growth → plus  (cumulative)
 *   - Billing lifecycle (subscription_status):
 *       trial → active → view_only → suspended  (plus legacy inactive/canceled)
 *   - Manual payment confirmation (cobro real ocurre en Mercado Pago; ACACIA
 *     confirma el pago dentro de LIUMA — no hay auto-renovación interna).
 *
 * Prices/tiers come from the public LIUMA pricing (acaciaco-site/liuma):
 *   LIUMA Start  $999 MXN/mes
 *   LIUMA Growth $1,999 MXN/mes
 *   LIUMA Plus   $2,999 MXN/mes
 *   Activación inicial (cuando aplica): $7,990 MXN (única vez)
 *
 * NOTE on limits: the public pricing page does not publish hard student caps,
 * so the per-tier `studentLimit` values below are sensible operational defaults.
 * They only ever gate the product when VITE_PAYWALL_GATING_ENABLED is turned on
 * (off by default, exactly like FlowFin), so they are safe to tune later.
 */

// Trial length in natural days (matches the 30-day trial seeded at onboarding).
export const TRIAL_DURATION_DAYS = 30;

// License tiers, low → high. Order defines `planRank`.
export const PLAN_TIERS = ['start', 'growth', 'plus'];

// One-time activation/onboarding fee (acaciaco-site: "Activación inicial").
export const ACTIVATION_FEE = {
  amount: 7990,
  currency: 'MXN',
  label: '$7,990 MXN',
  desc: 'Configuración inicial, activación y acompañamiento de arranque (única vez, cuando aplica).',
};

// Public catalog of license TYPES. `studentLimit: null` means unlimited.
export const PLAN_CATALOG = {
  start: {
    id: 'start',
    label: 'LIUMA Start',
    price: '$999 MXN/mes',
    priceMonthly: 999,
    studentLimit: 150,
    desc: 'Para instituciones pequeñas o pilotos controlados',
    features: [
      'Base de comunicación escolar',
      'Acceso estructurado por roles',
      'Mejor orden operativo',
      'Hasta 150 alumnos',
    ],
  },
  growth: {
    id: 'growth',
    label: 'LIUMA Growth',
    price: '$1,999 MXN/mes',
    priceMonthly: 1999,
    studentLimit: 400,
    desc: 'Para escuelas que requieren más adopción y cobertura',
    features: [
      'Incluye todo lo de Start',
      'Mayor capacidad operativa',
      'Más coordinación entre actores',
      'Hasta 400 alumnos',
    ],
    popular: true,
  },
  plus: {
    id: 'plus',
    label: 'LIUMA Plus',
    price: '$2,999 MXN/mes',
    priceMonthly: 2999,
    studentLimit: null,
    desc: 'Para operación más robusta y necesidades extendidas',
    features: [
      'Incluye todo lo de Growth',
      'Mayor profundidad funcional',
      'Mejor soporte para crecimiento',
      'Alumnos ilimitados',
    ],
    enterpriseNote: 'Más de 2,000 alumnos: contáctanos para un plan a medida.',
  },
};

// tier → licensed student limit (null = unlimited). Single source of truth used
// by activation/payment-confirmation builders so the limit always tracks the tier.
export const PLAN_LIMITS = {
  ...Object.fromEntries(PLAN_TIERS.map((tier) => [tier, PLAN_CATALOG[tier].studentLimit])),
  // 'founder' is Mission Control's hidden, lifetime, non-paid plan
  // (acacia-mission-control api/_lib/licenseControl.js lists it for liuma and
  // portfolioLifecycle.js never runs the expiry cycle on it). It is NOT part of
  // the public price ladder (PLAN_TIERS), but LIUMA must recognise it: before
  // this, a school MC marked 'founder' was normalised as 'start' and capped at
  // 150 students.
  founder: null,
};

/** Every license_tier value SchoolSubscription.jsonc accepts. */
export const ALL_LICENSE_TIERS = [...PLAN_TIERS, 'founder'];
export const FOUNDER_TIER = 'founder';

// Billing-status groups.
export const ACTIVE_STATUSES = ['trial', 'active'];
// Statuses that lock the tenant into read-only (no writes), like FlowFin's
// view_only/suspended — plus LIUMA's legacy inactive/canceled.
export const READ_ONLY_STATUSES = ['view_only', 'suspended', 'inactive', 'canceled'];

export function planRank(tier) {
  const idx = PLAN_TIERS.indexOf(tier);
  return idx < 0 ? 0 : idx;
}

export function getPlan(tier) {
  return PLAN_CATALOG[tier] || null;
}

export function planLabel(tier) {
  if (tier === FOUNDER_TIER) return 'LIUMA Fundador';
  return PLAN_CATALOG[tier]?.label || tier || '—';
}

export function isReadOnlyStatus(status) {
  return READ_ONLY_STATUSES.includes(status);
}

/** Billing period helper in YYYY-MM (e.g. "2026-06"). */
export function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Days remaining in trial (>= 0). Returns null when there is no trial end date.
 */
export function computeTrialDaysLeft(trialEndAt, now = new Date()) {
  if (!trialEndAt) return null;
  const diff = new Date(trialEndAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Safe license expiry: never shortens an active license. If the current expiry
 * is in the future, extend FROM it; otherwise extend FROM now. Always lands on
 * the 1st of the resulting month (aligns with Mercado Pago monthly billing).
 * Mirrors FlowFin's confirmLicensePayment.calculateExpiry.
 */
export function calculateExpiry(currentExpiresAt, monthsToExtend = 1, now = new Date()) {
  const base = currentExpiresAt && new Date(currentExpiresAt) > now
    ? new Date(currentExpiresAt)
    : new Date(now);

  const next = new Date(base);
  next.setMonth(next.getMonth() + monthsToExtend);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

/**
 * Effective license state — the ONE rule for "may this school write?".
 *
 * Owner decision (2026-09-29): a missing or expired license FAILS CLOSED to
 * read-only. Users can still see and export everything; they cannot write
 * until the school pays. Before this, a school with no SchoolSubscription row
 * (every school in production) was treated as fully active forever, and a
 * trial whose 30 days had run out stayed 'trial' with full write access.
 *
 *   - no row                         → read-only ('missing')
 *   - status in READ_ONLY_STATUSES   → read-only (Mission Control put it there)
 *   - trial past trial_end_date      → read-only ('trial_expired'). Mission
 *     Control's lifecycle cron deliberately skips non-paid plans
 *     (portfolioLifecycle.js#filterPaidLicenses), so NOTHING else ever ends a
 *     trial — the app has to.
 *   - trial with no trial_end_date   → read-only ('trial_without_end'): a
 *     malformed row must not become an unlimited trial.
 *   - active past license_expires_at → still writable ('active_overdue').
 *     Paid licenses have an 8-day grace that Mission Control owns and enforces
 *     by writing view_only; locking earlier here would contradict it.
 *   - founder tier                   → never expires by date.
 *
 * MIRRORED BY HAND (Deno cannot import src/): base44/functions/
 * getMySubscription/entry.ts and guardedEntityWrite/entry.ts carry the same
 * rule as `effectiveLicense`. tests/unit/license-lifecycle.test.js checks
 * both copies.
 */
export function resolveEffectiveLicense(subscription, now = new Date()) {
  if (!subscription) {
    return { status: 'missing', isReadOnly: true, reason: 'missing' };
  }
  const status = subscription.subscription_status || 'trial';
  if (READ_ONLY_STATUSES.includes(status)) {
    return { status, isReadOnly: true, reason: status };
  }
  if (subscription.license_tier === FOUNDER_TIER) {
    return { status, isReadOnly: false, reason: 'founder' };
  }
  if (status === 'trial') {
    const end = Date.parse(subscription.trial_end_date || '');
    if (Number.isNaN(end)) return { status: 'view_only', isReadOnly: true, reason: 'trial_without_end' };
    if (end <= now.getTime()) return { status: 'view_only', isReadOnly: true, reason: 'trial_expired' };
    return { status, isReadOnly: false, reason: 'trial' };
  }
  const expires = Date.parse(subscription.license_expires_at || '');
  if (!Number.isNaN(expires) && expires <= now.getTime()) {
    return { status, isReadOnly: false, reason: 'active_overdue' };
  }
  return { status, isReadOnly: false, reason: status };
}

// Days before expiry at which the "vence pronto" notice appears. Matches
// Mission Control's own T-7 upcoming-renewal email
// (renewalReminders.js UPCOMING_WINDOW_DAYS), so the banner and the email
// start the same day. At URGENT_NOTICE_DAYS the tone escalates.
export const UPCOMING_NOTICE_DAYS = 7;
export const URGENT_NOTICE_DAYS = 3;

function daysUntil(iso, now) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Which license notice (if any) to show, before and after expiry. Pure, so the
 * thresholds are tested rather than eyeballed. Every notice carries a pay CTA
 * (see src/lib/license/billingContact.js) except a founder/active one, which
 * shows nothing.
 *
 * kinds: trial_ending | renewal_upcoming | active_overdue | read_only |
 *        suspended | missing
 * tone:  info | warning | danger
 */
export function licenseNotice(subscription, now = new Date()) {
  const effective = resolveEffectiveLicense(subscription, now);
  if (effective.reason === 'missing') {
    return { kind: 'missing', tone: 'danger', daysLeft: null, effective };
  }
  if (effective.reason === 'suspended') {
    return { kind: 'suspended', tone: 'danger', daysLeft: null, effective };
  }
  if (effective.isReadOnly) {
    return { kind: 'read_only', tone: 'danger', daysLeft: 0, effective };
  }
  if (effective.reason === 'trial') {
    const daysLeft = daysUntil(subscription.trial_end_date, now);
    if (daysLeft != null && daysLeft <= UPCOMING_NOTICE_DAYS) {
      return { kind: 'trial_ending', tone: daysLeft <= URGENT_NOTICE_DAYS ? 'danger' : 'warning', daysLeft, effective };
    }
    return null;
  }
  if (effective.reason === 'active_overdue') {
    return { kind: 'active_overdue', tone: 'danger', daysLeft: 0, effective };
  }
  if (effective.reason === 'active' && !subscription.auto_renewal) {
    // Auto-renewing (Mercado Pago charges on the 1st) needs no reminder here;
    // Mission Control mails the charge notice itself.
    const daysLeft = daysUntil(subscription.license_expires_at, now);
    if (daysLeft != null && daysLeft <= UPCOMING_NOTICE_DAYS) {
      return { kind: 'renewal_upcoming', tone: daysLeft <= URGENT_NOTICE_DAYS ? 'danger' : 'warning', daysLeft, effective };
    }
  }
  return null;
}

/**
 * Normalize a raw SchoolSubscription row into the shape the UI consumes.
 * Grandfather clause: a missing status defaults to 'trial'. A missing ROW is
 * read-only (see resolveEffectiveLicense).
 */
export function normalizeSubscription(subscription, now = new Date()) {
  if (!subscription) {
    return {
      exists: false,
      billingStatus: null,
      effectiveStatus: 'missing',
      readOnlyReason: 'missing',
      isReadOnly: true,
      licenseTier: 'start',
      licensedStudentLimit: PLAN_LIMITS.start,
      trialDaysLeft: null,
      trialStartAt: null,
      trialEndAt: null,
      licenseActivatedAt: null,
      licenseExpiresAt: null,
      autoRenewal: false,
    };
  }

  const billingStatus = subscription.subscription_status || 'trial';
  const licenseTier = subscription.license_tier || 'start';
  const effective = resolveEffectiveLicense(subscription, now);

  return {
    exists: true,
    id: subscription.id || null,
    schoolId: subscription.school_id || null,
    billingStatus,
    effectiveStatus: effective.status,
    readOnlyReason: effective.isReadOnly ? effective.reason : null,
    isReadOnly: effective.isReadOnly,
    licenseTier,
    licensedStudentLimit: subscription.licensed_student_limit ?? PLAN_LIMITS[licenseTier] ?? null,
    trialDaysLeft: billingStatus === 'trial'
      ? computeTrialDaysLeft(subscription.trial_end_date, now)
      : null,
    trialStartAt: subscription.trial_start_date || null,
    trialEndAt: subscription.trial_end_date || null,
    licenseActivatedAt: subscription.license_activated_at || null,
    licenseExpiresAt: subscription.license_expires_at || null,
    autoRenewal: Boolean(subscription.auto_renewal),
    lastPaymentPeriod: subscription.last_payment_period || null,
    lastPaymentReference: subscription.last_payment_reference || null,
    activationFeePaid: Boolean(subscription.activation_fee_paid),
  };
}

/**
 * Grace buffer applied over a tier's licensed cap before a NEW student is hard
 * blocked. Within the buffer the admin can keep adding (e.g. mid-year
 * enrollment) but sees an "over your plan — upgrade" warning. 0.10 = +10%.
 */
export const GRACE_BUFFER_RATIO = 0.10;

/**
 * Soft enterprise threshold for unlimited (Plus) tenants. Past this we suggest
 * contacting sales for a tailored plan — protects against a very large
 * institution sitting on a flat unlimited price.
 */
export const ENTERPRISE_CONTACT_THRESHOLD = 2000;

/** Next tier up, or null if already on the top tier. */
export function nextTier(tier) {
  const idx = PLAN_TIERS.indexOf(tier);
  if (idx < 0 || idx >= PLAN_TIERS.length - 1) return null;
  return PLAN_TIERS[idx + 1];
}

/**
 * Effective licensed student capacity for a tenant. Trial previews the largest
 * capacity (so trials are never blocked); paid tiers use their own limit.
 * Returns a number, or null for unlimited.
 */
export function effectiveStudentLimit(licenseTier, billingStatus) {
  if (billingStatus === 'trial') return PLAN_LIMITS.plus; // largest (null = unlimited)
  if (licenseTier === FOUNDER_TIER) return null;
  return PLAN_LIMITS[licenseTier] ?? null;
}

/** Hard cap (licensed limit + grace buffer). Null when the plan is unlimited. */
export function hardStudentLimit(limit, graceRatio = GRACE_BUFFER_RATIO) {
  if (limit == null) return null;
  // Subtract a tiny epsilon so floating-point noise (e.g. 400*1.1 = 440.0000…6)
  // doesn't round a whole-number result up by one.
  return Math.ceil(limit * (1 + graceRatio) - 1e-9);
}

/**
 * Evaluate the student quota for a tenant. Gating only bites when `gatingEnabled`
 * is on and the actor is not the ACACIA platform owner (who always bypasses).
 *
 * Returns:
 *   - limit:        effective licensed cap (null = unlimited)
 *   - hardLimit:    cap + grace buffer; new students are blocked at/after this
 *   - used:         current active student count
 *   - remaining:    slots left until the licensed cap (null = unlimited)
 *   - overLimit:    at/over the licensed cap but still within grace (warn, allow)
 *   - exceeded:     at/over the hard limit — a NEW student is blocked
 *   - gatingActive: whether the cap is actually being enforced
 *   - salesContactSuggested: unlimited tenant past the enterprise threshold
 */
export function evaluateStudentQuota({
  licenseTier,
  billingStatus,
  activeStudentCount = 0,
  gatingEnabled = false,
  isPlatformOwner = false,
} = {}) {
  const limit = effectiveStudentLimit(licenseTier, billingStatus);
  const gatingActive = Boolean(gatingEnabled) && !isPlatformOwner && limit != null;
  const hardLimit = hardStudentLimit(limit);
  const remaining = limit == null ? null : Math.max(0, limit - activeStudentCount);
  const overLimit = gatingActive && activeStudentCount >= limit;
  const exceeded = gatingActive && hardLimit != null && activeStudentCount >= hardLimit;

  // Advisory only (independent of gating): a very large unlimited tenant.
  const salesContactSuggested = limit == null && activeStudentCount >= ENTERPRISE_CONTACT_THRESHOLD;

  return { limit, hardLimit, used: activeStudentCount, remaining, overLimit, exceeded, gatingActive, salesContactSuggested };
}

/**
 * Build the SchoolSubscription payload for a freshly-created school's 30-day
 * trial. Used by onboarding (mirrors FlowFin's trial seeding).
 */
export function buildTrialSubscription(schoolId, now = new Date()) {
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);

  return {
    school_id: schoolId,
    subscription_status: 'trial',
    subscription_plan: 'trial',
    license_tier: 'start',
    licensed_student_limit: PLAN_LIMITS.start,
    trial_start_date: now.toISOString(),
    trial_end_date: trialEnd.toISOString(),
    welcome_message_shown: false,
  };
}

/**
 * General license adjustment payload (status/tier/expiry/notes) without
 * confirming a specific payment. Mirrors FlowFin's activateLicense.
 */
export function buildActivationUpdate({
  subscription_status,
  license_tier,
  licensed_student_limit,
  payment_reference,
  activation_notes,
  license_expires_at,
  auto_renewal,
  activation_fee_paid,
  adminEmail,
  now = new Date(),
} = {}) {
  const tier = license_tier || 'start';
  if (!PLAN_TIERS.includes(tier)) {
    throw new Error(`Tier inválido: ${tier}. Válidos: ${PLAN_TIERS.join(', ')}`);
  }

  const update = {
    subscription_status: subscription_status || 'active',
    license_tier: tier,
    licensed_student_limit: licensed_student_limit ?? PLAN_LIMITS[tier] ?? null,
    license_activated_at: now.toISOString(),
    activated_by_admin: adminEmail || null,
  };

  if (payment_reference !== undefined) update.payment_reference = payment_reference;
  if (activation_notes !== undefined) update.activation_notes = activation_notes;
  if (license_expires_at) update.license_expires_at = new Date(license_expires_at).toISOString();
  if (auto_renewal !== undefined) update.auto_renewal = Boolean(auto_renewal);
  if (activation_fee_paid !== undefined) update.activation_fee_paid = Boolean(activation_fee_paid);

  return update;
}

/**
 * Payment-confirmation payload: marks the license active, sets the tier and a
 * safe expiry, and records who/when/which period. Mirrors FlowFin's
 * confirmLicensePayment (the only path that "renews" a LIUMA license).
 */
export function buildPaymentConfirmationUpdate({
  subscription,
  license_tier,
  payment_reference,
  payment_period,
  payment_notes,
  license_expires_at,
  months_to_extend = 1,
  auto_renewal,
  activation_fee_paid,
  adminEmail,
  now = new Date(),
} = {}) {
  if (!payment_period) {
    throw new Error('payment_period requerido (formato YYYY-MM)');
  }

  const tier = license_tier || subscription?.license_tier || 'start';
  if (!PLAN_TIERS.includes(tier)) {
    throw new Error(`Tier inválido: ${tier}. Válidos: ${PLAN_TIERS.join(', ')}`);
  }

  const nowISO = now.toISOString();
  const newExpiresAt = license_expires_at
    ? new Date(license_expires_at).toISOString()
    : calculateExpiry(subscription?.license_expires_at, months_to_extend, now);

  const update = {
    subscription_status: 'active',
    license_tier: tier,
    licensed_student_limit: PLAN_LIMITS[tier] ?? null,
    license_activated_at: nowISO,
    license_expires_at: newExpiresAt,
    activated_by_admin: adminEmail || null,
    last_payment_confirmed_at: nowISO,
    last_payment_confirmed_by: adminEmail || null,
    last_payment_period: payment_period,
  };

  if (payment_reference !== undefined) {
    update.payment_reference = payment_reference;
    update.last_payment_reference = payment_reference;
  }
  if (payment_notes !== undefined) update.last_payment_notes = payment_notes;
  if (auto_renewal !== undefined) update.auto_renewal = Boolean(auto_renewal);
  if (activation_fee_paid !== undefined) update.activation_fee_paid = Boolean(activation_fee_paid);

  return update;
}
