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
  consentIsComplete,
  sensitiveConsentLabel,
} from '@/lib/consent/privacyNotice';
import {
  captureOnboardingFailure,
  completeOnboardingTenantCreation,
  mapOnboardingError,
} from '@/lib/onboardingTenantCreation';

function buildCorrelationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tenant-create-${Date.now()}`;
}

export default function Onboarding({ user, onComplete, onCancel }) {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    role: '',
    schoolCode: '',
    newSchoolName: '',
    phone: '',
    isDemo: false,
  });
  const [logoFile, setLogoFile] = useState(null);
  const [themePreview, setThemePreview] = useState(DEFAULT_THEME);
  const [consent, setConsent] = useState({ general: false, sensitive: false });

  const colorRoles = useMemo(() => ['primary', 'secondary', 'accent', 'neutral'], []);

  const handleRoleSelect = (role) => {
    setFormData({ ...formData, role });
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    const correlationId = buildCorrelationId();
    const requestPayload = {
      correlationId,
      role: formData.role,
      schoolCode: formData.schoolCode,
      newSchoolName: formData.newSchoolName,
      phone: formData.phone,
      isDemo: formData.isDemo,
      hasLogo: Boolean(logoFile),
    };

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
      onComplete();
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
      alert(mappedError.message);
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
                      <Label>Nombre de tu escuela</Label>
                      <Input
                        value={formData.newSchoolName}
                        onChange={(e) => setFormData({ ...formData, newSchoolName: e.target.value })}
                        placeholder="Ej: Colegio Montessori"
                        className="mt-1 h-12"
                      />
                    </div>
                    <div>
                      <Label>Logo (opcional)</Label>
                      <Input type="file" accept="image/*" onChange={handleLogoChange} className="mt-1 h-12" />
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Upload className="w-3 h-3" /> Extraemos colores automáticamente con fallback seguro.</p>
                    </div>
                    <div className="rounded-xl border border-border p-3 bg-muted">
                      <p className="text-sm font-medium text-foreground mb-2">Vista previa de paleta</p>
                      <div className="grid grid-cols-2 gap-2">
                        {colorRoles.map((role) => (
                          <label key={role} className="text-xs text-muted-foreground">
                            <span className="capitalize">{role}</span>
                            <Input type="color" value={themePreview.palette?.[role] || DEFAULT_THEME.palette[role]} onChange={(e) => updateThemeColor(role, e.target.value)} className="mt-1 h-10 p-1" />
                          </label>
                        ))}
                      </div>
                      <div className="mt-3 rounded-lg p-3" style={{ background: themePreview.palette?.secondary || DEFAULT_THEME.palette.secondary }}>
                        <Button className="mr-2" style={{ background: themePreview.palette?.primary || DEFAULT_THEME.palette.primary, color: '#fff' }}>Botón</Button>
                        <Badge style={{ background: themePreview.palette?.accent || DEFAULT_THEME.palette.accent, color: '#fff' }}>Badge</Badge>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label>Código de escuela (requerido)</Label>
                      <Input
                        value={formData.schoolCode}
                        onChange={(e) => setFormData({ ...formData, schoolCode: e.target.value })}
                        placeholder="Código proporcionado por tu escuela"
                        className="mt-1 h-12"
                        required
                      />
                    </div>
                    <div className="bg-brand/10 border border-brand/30 rounded-xl p-3">
                      <p className="text-sm text-foreground">
                        💡 El administrador de tu escuela te debe proporcionar este código único. 
                        Sin él no podrás continuar.
                      </p>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-3 mt-6">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1 h-12">
                    Atrás
                  </Button>
                  <Button
                    onClick={() => setStep(3)}
                    disabled={formData.role === 'ADMIN' ? !formData.newSchoolName : !formData.schoolCode}
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
                    <Label>Teléfono (opcional)</Label>
                    <Input
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
                      ? 'Tu cuenta se activará inmediatamente y tendrás acceso completo.'
                      : 'Tu solicitud será enviada al administrador de la escuela para aprobación. Recibirás un correo cuando sea aprobada.'}
                  </p>
                </div>

                {/* Privacy notice + express consent (LFPDPPP) */}
                <div className="border border-border rounded-xl p-4 mt-4 space-y-3">
                  <p className="text-sm font-medium text-foreground">Aviso de Privacidad y consentimiento</p>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={consent.general}
                      onCheckedChange={(value) => setConsent((c) => ({ ...c, general: value === true }))}
                      className="mt-0.5"
                      aria-label="Acepto el Aviso de Privacidad"
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
                      y el tratamiento de mis datos personales.
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
                </div>

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
