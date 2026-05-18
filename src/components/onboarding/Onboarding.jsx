import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { base44 } from '@/api/base44Client';
import { notificationService } from '@/lib/notifications/service';
import { Loader2, School, GraduationCap, Users, ArrowRight, Check, Upload } from 'lucide-react';
import { extractPaletteFromFile, DEFAULT_THEME } from '@/lib/tenantTheme';
import { logAuditEvent } from '@/lib/audit';

export default function Onboarding({ user, onComplete }) {
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

  const colorRoles = useMemo(() => ['primary', 'secondary', 'accent', 'neutral'], []);

  const handleRoleSelect = (role) => {
    setFormData({ ...formData, role });
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    try {
      let schoolId = null;
      
      // If ADMIN creating new school
      if (formData.role === 'ADMIN' && formData.newSchoolName) {
        const schoolPayload = { name: formData.newSchoolName };
        if (logoFile) {
          const { file_url } = await base44.integrations.Core.UploadFile({ file: logoFile });
          schoolPayload.logo_url = file_url;
          schoolPayload.theme_settings = themePreview;
        }
        const school = await base44.entities.School.create(schoolPayload);
        schoolId = school.id;
        
        // Create trial subscription for new schools
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 30); // 30 days trial
        
        await base44.entities.SchoolSubscription.create({
          school_id: schoolId,
          subscription_status: 'trial',
          subscription_plan: 'trial',
          trial_start_date: new Date().toISOString(),
          trial_end_date: trialEndDate.toISOString(),
          welcome_message_shown: false,
        });
      } else if (formData.schoolCode) {
        // Find school by code (using school ID as code for simplicity)
        const schools = await base44.entities.School.filter({ id: formData.schoolCode });
        if (schools.length > 0) {
          schoolId = schools[0].id;
        } else {
          alert('Código de escuela inválido. Verifica con tu administrador.');
          setIsLoading(false);
          return;
        }
      }

      if (!schoolId) {
        alert('Error: No se pudo determinar la escuela.');
        setIsLoading(false);
        return;
      }

      // Determine status: ACTIVE for ADMIN, PENDING for others
      const userStatus = formData.role === 'ADMIN' ? 'ACTIVE' : 'PENDING';

      // Create user profile
      const newProfile = await base44.entities.UserProfile.create({
        user_id: user.id,
        school_id: schoolId,
        app_role: formData.role,
        status: userStatus,
        phone: formData.phone,
        onboarding_completed: true,
      });

      // If user is pending, notify school admins
      if (userStatus === 'PENDING') {
        // Get all admin users for this school
        const adminProfiles = await base44.entities.UserProfile.filter({
          school_id: schoolId,
          app_role: 'ADMIN',
          status: 'ACTIVE'
        });

        // Get admin user details
        const allUsers = await base44.entities.User.list();
        const roleNames = {
          TEACHER: 'Maestro/a',
          PARENT: 'Padre/Madre'
        };

        const schools = await base44.entities.School.filter({ id: schoolId });
        const school = schools[0];
        const recipients = adminProfiles.map((profile) => {
          const adminUser = allUsers.find((u) => u.id === profile.user_id);
          return {
            user_id: profile.user_id,
            app_role: profile.app_role,
            email: adminUser?.email,
            notification_preferences: profile.notification_preferences || {},
            school_notification_preferences: school?.notification_preferences || {},
          };
        });

        await notificationService.sendByEvent({
          eventType: 'new_user_pending',
          schoolId,
          actorUserId: user.id,
          recipients,
          templateContext: {
            schoolName: school?.name || 'LIUMA',
            userName: user.full_name,
            userEmail: user.email,
            roleName: roleNames[formData.role],
          },
          channels: ['email', 'in_app'],
        });
      }

      if (formData.role === 'ADMIN') {
        const actorProfile = { school_id: schoolId, app_role: 'ADMIN' };
        await logAuditEvent({
          user,
          userProfile: actorProfile,
          entity: 'SchoolTheme',
          entityId: schoolId,
          action: 'THEME_CREATED_OR_UPDATED',
          reason: 'tenant_theme_onboarding',
          context: { old_palette: null, new_palette: themePreview.palette, timestamp: new Date().toISOString() },
        });
      }
      onComplete();
    } catch (error) {
      console.error('Error in onboarding:', error);
      alert('Hubo un error. Intenta de nuevo.');
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl font-bold text-white">L</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Bienvenido a LIUMA</h1>
          <p className="text-slate-500 mt-1">Configuremos tu cuenta</p>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                s <= step ? 'bg-indigo-600' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="text-lg font-semibold text-slate-800 mb-2">
                  ¿Cuál es tu rol?
                </h2>
                <p className="text-sm text-slate-500 mb-4">
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
                          ? 'border-indigo-600 bg-indigo-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          formData.role === option.value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          <option.icon className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{option.label}</p>
                          <p className="text-sm text-slate-500">{option.desc}</p>
                        </div>
                        {formData.role === option.value && (
                          <Check className="w-5 h-5 text-indigo-600 ml-auto" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                <Button
                  onClick={() => setStep(2)}
                  disabled={!formData.role}
                  className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 h-12 text-lg"
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
                <h2 className="text-lg font-semibold text-slate-800 mb-4">
                  {formData.role === 'ADMIN' ? 'Crea tu escuela' : 'Ingresa el código de tu escuela'}
                </h2>
                
                {formData.role === 'ADMIN' ? (
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 rounded-xl p-4 mb-4">
                      <p className="text-sm font-medium text-indigo-900 mb-1">
                        🎉 Prueba LIUMA gratis por 30 días
                      </p>
                      <p className="text-xs text-indigo-700">
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
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Upload className="w-3 h-3" /> Extraemos colores automáticamente con fallback seguro.</p>
                    </div>
                    <div className="rounded-xl border p-3 bg-slate-50">
                      <p className="text-sm font-medium text-slate-700 mb-2">Vista previa de paleta</p>
                      <div className="grid grid-cols-2 gap-2">
                        {colorRoles.map((role) => (
                          <label key={role} className="text-xs text-slate-600">
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
                    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                      <p className="text-sm text-indigo-800">
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
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 h-12"
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
                <h2 className="text-lg font-semibold text-slate-800 mb-4">
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
                
                <div className="bg-slate-50 rounded-xl p-4 mt-4">
                  <p className="text-sm text-slate-600">
                    {formData.role === 'ADMIN' 
                      ? 'Tu cuenta se activará inmediatamente y tendrás acceso completo.'
                      : 'Tu solicitud será enviada al administrador de la escuela para aprobación. Recibirás un correo cuando sea aprobada.'}
                  </p>
                </div>
                
                <div className="flex gap-3 mt-6">
                  <Button variant="outline" onClick={() => setStep(2)} className="flex-1 h-12">
                    Atrás
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={isLoading}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 h-12"
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
