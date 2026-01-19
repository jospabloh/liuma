import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { base44 } from '@/api/base44Client';
import { Loader2, School, GraduationCap, Users, ArrowRight, Check } from 'lucide-react';

export default function Onboarding({ user, onComplete }) {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    role: '',
    schoolCode: '',
    newSchoolName: '',
    phone: '',
  });

  const handleRoleSelect = (role) => {
    setFormData({ ...formData, role });
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    try {
      let schoolId = null;
      
      // If ADMIN creating new school
      if (formData.role === 'ADMIN' && formData.newSchoolName) {
        const school = await base44.entities.School.create({
          name: formData.newSchoolName,
        });
        schoolId = school.id;
      } else if (formData.schoolCode) {
        // Find school by code (using school ID as code for simplicity)
        const schools = await base44.entities.School.filter({ id: formData.schoolCode });
        if (schools.length > 0) {
          schoolId = schools[0].id;
        }
      }

      if (!schoolId && formData.role !== 'ADMIN') {
        alert('No se encontró la escuela. Verifica el código.');
        setIsLoading(false);
        return;
      }

      // Create user profile
      await base44.entities.UserProfile.create({
        user_id: user.id,
        school_id: schoolId,
        app_role: formData.role,
        status: formData.role === 'ADMIN' ? 'ACTIVE' : 'PENDING',
        phone: formData.phone,
        onboarding_completed: true,
      });

      onComplete();
    } catch (error) {
      console.error('Error in onboarding:', error);
      alert('Hubo un error. Intenta de nuevo.');
    }
    setIsLoading(false);
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
                <h2 className="text-lg font-semibold text-slate-800 mb-4">
                  ¿Cuál es tu rol?
                </h2>
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
                    <div>
                      <Label>Nombre de la escuela</Label>
                      <Input
                        value={formData.newSchoolName}
                        onChange={(e) => setFormData({ ...formData, newSchoolName: e.target.value })}
                        placeholder="Ej: Colegio Montessori"
                        className="mt-1 h-12"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label>Código de escuela</Label>
                      <Input
                        value={formData.schoolCode}
                        onChange={(e) => setFormData({ ...formData, schoolCode: e.target.value })}
                        placeholder="Solicítalo al administrador"
                        className="mt-1 h-12"
                      />
                    </div>
                    <p className="text-sm text-slate-500">
                      El administrador de la escuela te proporcionará este código.
                    </p>
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
                      ? 'Tu cuenta se activará inmediatamente.'
                      : 'Tu cuenta quedará pendiente de aprobación por el administrador.'}
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