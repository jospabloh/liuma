import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import DiaryCard from '@/components/diary/DiaryCard';
import { ClipboardList, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addDays, subDays, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { createPageUrl } from '@/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Bitacora() {
  const urlParams = new URLSearchParams(window.location.search);
  const studentIdParam = urlParams.get('studentId');
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEntry, setSelectedEntry] = useState(null);
  
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
      return profiles[0];
    },
    enabled: !!user,
  });

  const { data: parentLinks = [] } = useQuery({
    queryKey: ['parentLinks', user?.id],
    queryFn: () => base44.entities.ParentStudent.filter({ 
      parent_id: user.id, 
      status: 'ACTIVE' 
    }),
    enabled: !!user,
  });

  const studentIds = studentIdParam ? [studentIdParam] : parentLinks.map(l => l.student_id);

  const { data: students = [] } = useQuery({
    queryKey: ['students', studentIds],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const results = [];
      for (const id of studentIds) {
        const studentList = await base44.entities.Student.filter({ id });
        if (studentList.length > 0) results.push(studentList[0]);
      }
      return results;
    },
    enabled: studentIds.length > 0,
  });

  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  const { data: diaryEntries = [], isLoading } = useQuery({
    queryKey: ['diaryEntries', studentIds, dateStr],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const entries = await base44.entities.DiaryEntry.filter({ 
        date: dateStr,
        school_id: userProfile?.school_id
      });
      return entries.filter(e => studentIds.includes(e.student_id));
    },
    enabled: studentIds.length > 0 && !!userProfile,
  });

  const getStudentName = (studentId) => {
    const student = students.find(s => s.id === studentId);
    return student ? `${student.first_name} ${student.last_name}` : '';
  };

  const navigateDate = (direction) => {
    setSelectedDate(direction === 'prev' ? subDays(selectedDate, 1) : addDays(selectedDate, 1));
  };

  if (isLoading) return <LoadingScreen message="Cargando bitácora..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Bitácora"
        subtitle={isToday(selectedDate) ? 'Hoy' : format(selectedDate, "d 'de' MMMM", { locale: es })}
        showBack
        backTo={createPageUrl('Home')}
      />

      {/* Date Navigation */}
      <div className="flex items-center justify-between bg-white rounded-xl p-3 mb-6 shadow-sm">
        <Button variant="ghost" size="icon" onClick={() => navigateDate('prev')}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="text-center">
          <p className="font-semibold text-slate-800">
            {isToday(selectedDate) ? 'Hoy' : format(selectedDate, "EEEE", { locale: es })}
          </p>
          <p className="text-sm text-slate-500">
            {format(selectedDate, "d 'de' MMMM, yyyy", { locale: es })}
          </p>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigateDate('next')}
          disabled={isToday(selectedDate)}
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {diaryEntries.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Sin bitácora registrada"
          description={`Aún no hay bitácora para ${isToday(selectedDate) ? 'hoy' : 'este día'}.`}
        />
      ) : (
        <div className="space-y-4">
          {diaryEntries.map((entry, index) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <DiaryCard
                entry={entry}
                studentName={getStudentName(entry.student_id)}
                onClick={() => setSelectedEntry(entry)}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Entry Detail Modal */}
      <Dialog open={!!selectedEntry} onOpenChange={() => setSelectedEntry(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Bitácora de {selectedEntry && getStudentName(selectedEntry.student_id)}
            </DialogTitle>
          </DialogHeader>
          
          {selectedEntry && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-slate-700 whitespace-pre-wrap">{selectedEntry.notes_text}</p>
              </div>

              {selectedEntry.teacher_message && (
                <div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-4 border border-pink-200">
                  <p className="text-xs font-semibold text-pink-800 mb-2">💌 Mensajito especial</p>
                  <p className="text-sm text-purple-700">{selectedEntry.teacher_message}</p>
                </div>
              )}

              {selectedEntry.behavior && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-slate-500">Comportamiento</span>
                  <span className="font-medium">{selectedEntry.behavior}</span>
                </div>
              )}
              {selectedEntry.learning && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-slate-500">Aprendizaje</span>
                  <span className="font-medium">{selectedEntry.learning}</span>
                </div>
              )}
              {selectedEntry.mood && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-slate-500">Estado de ánimo</span>
                  <span className="font-medium">{selectedEntry.mood}</span>
                </div>
              )}
              {selectedEntry.food && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-slate-500">Alimentación</span>
                  <span className="font-medium">
                    {selectedEntry.food === 'todo' ? 'Comió todo' : 
                     selectedEntry.food === 'casi_todo' ? 'Casi todo' :
                     selectedEntry.food === 'poco' ? 'Poco' : 'No comió'}
                  </span>
                </div>
              )}
              {selectedEntry.naps && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-slate-500">Siesta</span>
                  <span className="font-medium">{selectedEntry.naps}</span>
                </div>
              )}
              {selectedEntry.bathroom && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-slate-500">Baño</span>
                  <span className="font-medium">{selectedEntry.bathroom}</span>
                </div>
              )}
              {selectedEntry.incidents && (
                <div className="mt-4 bg-amber-50 rounded-xl p-4">
                  <p className="text-sm font-medium text-amber-800 mb-1">Incidentes</p>
                  <p className="text-amber-700">{selectedEntry.incidents}</p>
                </div>
              )}
              
              <p className="text-xs text-slate-400 text-center">
                Registrado por {selectedEntry.teacher_name}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}