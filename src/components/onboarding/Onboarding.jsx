import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from '@/api/base44Client';
import { notificationService } from '@/lib/notifications/service';
import { Loader2, School, GraduationCap, Users, ArrowRight, Check, Upload } from 'lucide-react';
import { extractPaletteFromFile, DEFAULT_THEME } from '@/lib/tenantTheme';
import { logAuditEvent } from '@/lib/audit';
import {
  PRIVACY_NOTICE_VERSION,
  PRIVACY_NOTICE_URL,
  TERMS_URL,
  consentIsComplete,
  sensitiveConsentLabel,
} from '@/lib/consent/privacyNotice';
import {
  captureOnboardingFailure,
  completeOnboardingTenantCreation,
  mapOnboardingError,
  validateOnboardingPayload,
  ONBOARDING_ERROR_MESSAGES,
} from '@/lib/onboardingTenantCreation';
import { forgetInviteCode, formatJoinCode, readJoinCodeFromSearch, readRememberedInviteCode } from '@/lib/onboarding/joinCode';

// Labels for the four palette slots. The keys are the stored theme_settings
// keys (English, consumed by tenantTheme.js); only the labels are shown.
const PALETTE_LABELS = {
  primary: 'Principal',
  secondary: 'Secundario',
  accent: 'Acento',
  neutral: 'Neutro',
};

// Field-level error, announced to screen readers and tied to its input.
function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-destructive">
      {message}
    </p>
  );
}

function buildCorrelationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tenant-create-${Date.now()}`;
}

export default function Onboarding({ user, onComplete, onCancel }) {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  // An invitation link (/?codigo=ABCD-EFGH, see JoinCodeCard) pre-fills the
  // code — from the URL, or from storage when the sign-in redirect dropped it.
  const [invitedCode] = useState(() => (typeof window !== 'undefined'
    ? readJoinCodeFromSearch(window.location.search) || readRememberedInviteCode()
    : ''));
  const [formData, setFormData] = useState({
    role: '',
    schoolCode: invitedCode,
    newSchoolName: '',
    phone: '',
  });
  // { field: 'schoolCode' | 'newSchoolName' | 'consent' | null, message }
  const [formError, setFormError] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [themePreview, setThemePreview] = useState(DEFAULT_THEME);
  const [consent, setConsent] = useState({ general: false, sensitive: false });

  const colorRoles = useMemo(() => ['primary', 'secondary', 'accent', 'neutral'], []);

  const handleRoleSelect = (role) => {
    setFormData({ ...formData, role });
    setFormError(null);
  };

  const errorFor = (field) => (formError?.field === field ? formError.message : null);

  // Validate step 2 locally so a mistyped code is flagged next to the input,
  // before the consent step, instead of after "Finalizar".
  const goToStep3 = () => {
    const check = validateOnboardingPayload({ formData, user: user || { id: 'pending' } });
    if (!check.valid && (check.field === 'schoolCode' || check.field === 'newSchoolName')) {
      setFormError({ field: check.field, message: check.field === 'schoolCode'
        ? ONBOARDING_ERROR_MESSAGES[check.code]
        : 'Escribe el nombre de tu escuela.' });
      return;
    }
    setFormError(null);
    setStep(3);
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    const correlationId = buildCorrelationId();
    const requestPayload = {
      correlationId,
      role: formData.role,
      schoolCode: formData.schoolCode,
      newSchoolName: formData.newSchoolName,
      hasPhone: Boolean(formData.phone),
      hasLogo: Boolean(logoFile),
    };
    setFormError(null);

    try {
      await completeOnboardingTenantCreation({
        base44,
        notificationService,
        logAuditEvent,
        user,
        formData,
        logoFile,
        themePreview,
        consent: {
          acceptances: consent,
          noticeVersion: PRIVACY_NOTICE_VERSION,
          acceptedAt: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
      });
      forgetInviteCode();
      setIsLoading(false);
      onComplete();
      return;
    } catch (error) {
      const mappedError = mapOnboardingError(error);
      const failureDetails = captureOnboardingFailure({
        error,
        requestPayload,
        phase: 'onboarding_tenant_creation',
        correlationId,
      });
      console.error('tenant_creation_failed', {
        ...failureDetails,
        userFacingErrorCode: mappedError.code,
      });
      // Errors that belong to an earlier step send the user back to it.
      if (mappedError.field === 'schoolCode' || mappedError.field === 'newSchoolName') setStep(2);
      // Only fields that render an inline error; anything else (role,
      // user.id, a server refusal) goes in the form-level alert.
      const shownField = ['schoolCode', 'newSchoolName', 'consent'].includes(mappedError.field) ? mappedError.field : 'submit';
      setFormError({ field: shownField, message: mappedError.message });
    }
    setIsLoading(false);
  };



  const handleLogoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    try {
      const extracted = await extractPaletteFromFile(file);
      setThemePreview(extracted.quality === 'failed' ? DEFAULT_THEME : extracted);
    } catch (error) {
      setThemePreview(DEFAULT_THEME);
    }
  };

  const updateThemeColor = (role, value) => {
    setThemePreview((prev) => ({
      ...prev,
      palette: { ...(prev.palette || DEFAULT_THEME.palette), [role]: value }
    }));
  };

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Cancelar — solo cuando esta pantalla se abrió DESDE dentro de la app
            (Módulo 18: unirse a una segunda escuela ya no requiere quedarse sin
            la primera). El flujo original, sin perfil todavía, no tiene a dónde
            volver y no recibe esta prop. */}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            ← Volver
          </button>
        )}

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl font-bold text-white">L</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            {onCancel ? 'Unirme a otra escuela' : 'Bienvenido a LIUMA'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {onCancel ? 'Crea una escuela nueva o únete a una existente con su código' : 'Configuremos tu cuenta'}
          </p>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                s <= step ? 'bg-brand' : 'bg-border'
              }`}
            />
          ))}
        </div>

        <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-xl p-6">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="text-lg font-semibold text-foreground mb-2">
                  ¿Cuál es tu rol?
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Si eres directivo, puedes crear tu escuela con 30 días de prueba gratis
                </p>
                <div className="space-y-3">
                  {[
                    { value: 'PARENT', label: 'Soy Padre/Madre', icon: Users, desc: 'Tengo hijos en la escuela' },
                    { value: 'TEACHER', label: 'Soy Maestro/a', icon: GraduationCap, desc: 'Doy clases en la escuela' },
                    { value: 'ADMIN', label: 'Soy Directivo', icon: School, desc: 'Administro la escuela' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={formData.role === option.value}
                      onClick={() => handleRoleSelect(option.value)}
                      className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                        formData.role === option.value
                          ? 'border-brand bg-brand/10'
                          : 'border-border hover:border-brand/30'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          formData.role === option.value ? 'bg-brand text-white' : 'bg-muted text-muted-foreground'
                        }`}>
                          <option.icon className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{option.label}</p>
                          <p className="text-sm text-muted-foreground">{option.desc}</p>
                        </div>
                        {formData.role === option.value && (
                          <Check className="w-5 h-5 text-brand ml-auto" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                <Button
                  onClick={() => setStep(2)}
                  disabled={!formData.role}
                  className="w-full mt-6 bg-brand text-white hover:bg-brand/90 h-12 text-lg"
                >
                  Continuar
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  {formData.role === 'ADMIN' ? 'Crea tu escuela' : 'Ingresa el código de tu escuela'}
                </h2>
                
                {formData.role === 'ADMIN' ? (
                  <div className="space-y-4">
                    <div className="bg-brand/10 border border-brand/30 rounded-xl p-4 mb-4">
                      <p className="text-sm font-medium text-foreground mb-1">
                        🎉 Prueba LIUMA gratis por 30 días
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Sin tarjeta de crédito. Acceso completo a todas las funciones.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="onb-school-name">Nombre de tu escuela</Label>
                      <Input
                        id="onb-school-name"
                        value={formData.newSchoolName}
                        onChange={(e) => setFormData({ ...formData, newSchoolName: e.target.value })}
                        placeholder="Ej: Colegio Montessori"
                        className="mt-1 h-12"
                        maxLength={120}
                        autoComplete="organization"
                        aria-invalid={Boolean(errorFor('newSchoolName'))}
                        aria-describedby={errorFor('newSchoolName') ? 'onb-school-name-error' : undefined}
                      />
                      <FieldError id="onb-school-name-error" message={errorFor('newSchoolName')} />
                    </div>
                    <div>
                      <Label htmlFor="onb-logo">Logo (opcional)</Label>
                      <Input id="onb-logo" type="file" accept="image/*" onChange={handleLogoChange} className="mt-1 h-12" aria-describedby="onb-logo-help" />
                      <p id="onb-logo-help" className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Upload className="w-3 h-3" aria-hidden="true" /> Tomamos los colores de tu logo; puedes ajustarlos abajo.</p>
                    </div>
                    <div className="rounded-xl border border-border p-3 bg-muted">
                      <p className="text-sm font-medium text-foreground mb-2">Colores de tu escuela</p>
                      <div className="grid grid-cols-2 gap-2">
                        {colorRoles.map((role) => (
                          <div key={role} className="text-xs text-muted-foreground">
                            <Label htmlFor={`onb-color-${role}`} className="text-xs font-normal text-muted-foreground">{PALETTE_LABELS[role]}</Label>
                            <Input id={`onb-color-${role}`} type="color" value={themePreview.palette?.[role] || DEFAULT_THEME.palette[role]} onChange={(e) => updateThemeColor(role, e.target.value)} className="mt-1 h-10 p-1" />
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 rounded-lg p-3" style={{ background: themePreview.palette?.secondary || DEFAULT_THEME.palette.secondary }} aria-hidden="true">
                        <span className="mr-2 inline-flex rounded-md px-3 py-2 text-sm font-medium" style={{ background: themePreview.palette?.primary || DEFAULT_THEME.palette.primary, color: '#fff' }}>Botón</span>
                        <Badge style={{ background: themePreview.palette?.accent || DEFAULT_THEME.palette.accent, color: '#fff' }}>Etiqueta</Badge>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="onb-school-code">Código de tu escuela</Label>
                      <Input
                        id="onb-school-code"
                        value={formData.schoolCode}
                        onChange={(e) => setFormData({ ...formData, schoolCode: e.target.value.toUpperCase() })}
                        onBlur={(e) => setFormData((f) => ({ ...f, schoolCode: formatJoinCode(e.target.value) || e.target.value.trim() }))}
                        placeholder="Ej: ABCD-EFGH"
                        className="mt-1 h-12 font-mono tracking-widest uppercase"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        required
                        aria-invalid={Boolean(errorFor('schoolCode'))}
                        aria-describedby={`onb-school-code-help${errorFor('schoolCode') ? ' onb-school-code-error' : ''}`}
                      />
                      <FieldError id="onb-school-code-error" message={errorFor('schoolCode')} />
                    </div>
                    <div id="onb-school-code-help" className="bg-brand/10 border border-brand/30 rounded-xl p-3 space-y-1">
                      <p className="text-sm text-foreground">
                        {invitedCode
                          ? 'Tomamos el código de tu invitación. Verifica que coincida con el que te dio tu escuela.'
                          : '¿Dónde está el código? Son 8 letras y números (por ejemplo ABCD-EFGH).'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Lo tiene la dirección de tu escuela: suele venir en el mensaje o correo de invitación a LIUMA.
                        Si no lo tienes, pídeselo a la escuela. Al registrarte, la escuela aprobará tu acceso.
                      </p>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-3 mt-6">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1 h-12">
                    Atrás
                  </Button>
                  <Button
                    onClick={goToStep3}
                    disabled={formData.role === 'ADMIN' ? !formData.newSchoolName.trim() : !formData.schoolCode.trim()}
                    className="flex-1 bg-brand text-white hover:bg-brand/90 h-12"
                  >
                    Continuar
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  Información de contacto
                </h2>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="onb-phone">Teléfono (opcional)</Label>
                    <Input
                      id="onb-phone"
                      autoComplete="tel"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="10 dígitos"
                      className="mt-1 h-12"
                    />
                  </div>
                </div>
                
                <div className="bg-muted rounded-xl p-4 mt-4">
                  <p className="text-sm text-muted-foreground">
                    {formData.role === 'ADMIN'
                      ? 'Tu escuela queda creada al instante, con 30 días de prueba y acceso completo.'
                      : 'Tu solicitud llegará a la dirección de la escuela para su aprobación. Podrás entrar en cuanto la aprueben.'}
                  </p>
                </div>

                {/* Privacy notice + express consent (LFPDPPP) */}
                <fieldset
                  className="border border-border rounded-xl p-4 mt-4 space-y-3"
                  aria-describedby={errorFor('consent') ? 'onb-consent-error' : undefined}
                >
                  <legend className="px-1 text-sm font-medium text-foreground">Aviso de Privacidad y consentimiento</legend>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={consent.general}
                      onCheckedChange={(value) => setConsent((c) => ({ ...c, general: value === true }))}
                      className="mt-0.5"
                      aria-label="Acepto el Aviso de Privacidad y los Términos del servicio"
                    />
                    <span className="text-sm text-muted-foreground">
                      He leído y acepto el{' '}
                      <a
                        href={PRIVACY_NOTICE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand underline"
                      >
                        Aviso de Privacidad
                      </a>{' '}
                      y los{' '}
                      <a
                        href={TERMS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand underline"
                      >
                        Términos del servicio
                      </a>
                      , y el tratamiento de mis datos personales.
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={consent.sensitive}
                      onCheckedChange={(value) => setConsent((c) => ({ ...c, sensitive: value === true }))}
                      className="mt-0.5"
                      aria-label="Consentimiento expreso de datos sensibles"
                    />
                    <span className="text-sm text-muted-foreground">{sensitiveConsentLabel(formData.role)}</span>
                  </label>

                  <p className="text-xs text-muted-foreground">Versión del aviso: {PRIVACY_NOTICE_VERSION}</p>
                  <FieldError id="onb-consent-error" message={errorFor('consent')} />
                </fieldset>

                {formError?.field === 'submit' && (
                  <div role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
                    {formError.message}
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <Button variant="outline" onClick={() => setStep(2)} className="flex-1 h-12">
                    Atrás
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={isLoading || !consentIsComplete(consent)}
                    className="flex-1 bg-brand text-white hover:bg-brand/90 h-12"
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      'Finalizar'
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
