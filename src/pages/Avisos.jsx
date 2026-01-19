import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import NoticeCard from '@/components/notices/NoticeCard';
import { Bell, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { createPageUrl } from '@/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Avisos() {
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [filterPriority, setFilterPriority] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  
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

  const studentIds = parentLinks.map(l => l.student_id);

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

  const classroomIds = [...new Set(students.map(s => s.classroom_id).filter(Boolean))];

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ['notices', userProfile?.school_id, classroomIds, studentIds],
    queryFn: async () => {
      const allNotices = await base44.entities.Notice.filter({ 
        school_id: userProfile.school_id 
      }, '-created_date', 50);
      
      // Filter notices based on scope
      return allNotices.filter(notice => {
        if (notice.scope === 'SCHOOL') return true;
        if (notice.scope === 'CLASSROOM' && classroomIds.includes(notice.classroom_id)) return true;
        if (notice.scope === 'STUDENT' && studentIds.includes(notice.student_id)) return true;
        return false;
      });
    },
    enabled: !!userProfile,
  });

  const filteredNotices = filterPriority === 'all' 
    ? notices 
    : notices.filter(n => n.priority === filterPriority);

  if (isLoading) return <LoadingScreen message="Cargando avisos..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Avisos"
        showBack
        backTo={createPageUrl('Home')}
        action={
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4" />
          </Button>
        }
      />

      {/* Filters */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-4"
        >
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger>
              <SelectValue placeholder="Filtrar por prioridad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los avisos</SelectItem>
              <SelectItem value="URGENT">Solo urgentes</SelectItem>
              <SelectItem value="IMPORTANT">Solo importantes</SelectItem>
              <SelectItem value="NORMAL">Solo normales</SelectItem>
            </SelectContent>
          </Select>
        </motion.div>
      )}

      {filteredNotices.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Sin avisos"
          description="No hay avisos para mostrar."
        />
      ) : (
        <div className="space-y-4">
          {filteredNotices.map((notice, index) => (
            <motion.div
              key={notice.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <NoticeCard
                notice={notice}
                onClick={() => setSelectedNotice(notice)}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Notice Detail Modal */}
      <Dialog open={!!selectedNotice} onOpenChange={() => setSelectedNotice(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedNotice?.title}</DialogTitle>
          </DialogHeader>
          
          {selectedNotice && (
            <div className="space-y-4">
              <div className="text-sm text-slate-500">
                {format(new Date(selectedNotice.created_date), "d 'de' MMMM, yyyy 'a las' HH:mm", { locale: es })}
              </div>
              
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-slate-700 whitespace-pre-wrap">{selectedNotice.content}</p>
              </div>
              
              {selectedNotice.author_name && (
                <p className="text-xs text-slate-400 text-center">
                  Enviado por {selectedNotice.author_name}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}