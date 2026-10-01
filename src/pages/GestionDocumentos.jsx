import React, { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { schoolRead } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Upload, Loader2, Trash2, Download, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate, schoolToday } from '@/lib/dates';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';
import { guardedCreate, guardedUpdate, guardedDelete } from '@/lib/authorization/guardedWrite';
import { humanizeError } from '@/lib/errorMessages';
import FieldError from '@/components/forms/FieldError';
import { cn } from '@/lib/utils';
import {
  DOCUMENT_FIELD_ORDER,
  INVALID_FIELD_CLASS,
  firstErrorField,
  hasErrors,
  validateDocumentForm,
} from '@/lib/forms/directorForms';

const emptyDocumentForm = () => ({
  title: '',
  description: '',
  document_type: 'COMMUNICATION',
  target_audience: 'TODOS',
  valid_from: schoolToday(),
  valid_until: '',
});

export default function GestionDocumentos() {
  const { canWrite } = useCanWrite();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(emptyDocumentForm);
  const [selectedFile, setSelectedFile] = useState(null);
  const [errors, setErrors] = useState({});
  const fieldRefs = useRef({});

  const queryClient = useQueryClient();

  const { user, userProfile, isLoading: profileLoading } = useCurrentProfile();

  const { data: documents, isLoading } = useQuery({
    queryKey: ['officialDocuments', userProfile?.school_id],
    queryFn: () => schoolRead('OfficialDocument', { school_id: userProfile.school_id }, '-created_date'),
    enabled: !!userProfile?.school_id,
  });

  const uploadMutation = useMutation({
    mutationFn: async (data) => {
      // First, upload the file
      const { file_url } = await base44.integrations.Core.UploadFile({ file: data.file });
      
      // Mark previous documents of same type as not current
      if (data.document_type === 'MENU' || data.document_type === 'UNIFORM_CATALOG') {
        const previousDocs = await schoolRead('OfficialDocument', {
          school_id: userProfile.school_id,
          document_type: data.document_type,
          is_current: true
        });
        
        for (const doc of previousDocs) {
          await guardedUpdate('OfficialDocument', doc.id, { is_current: false });
        }
      }
      
      // Create the document record
      // uploaded_by / uploaded_by_name are stamped by the server from the
      // caller (P10b); the ones sent here are ignored.
      return guardedCreate('OfficialDocument', {
        school_id: userProfile.school_id,
        title: data.title,
        description: data.description,
        document_type: data.document_type,
        file_url: file_url,
        target_audience: data.target_audience,
        valid_from: data.valid_from,
        valid_until: data.valid_until || null,
        is_current: true,
        uploaded_by: user.id,
        uploaded_by_name: user.full_name,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['officialDocuments'] });
      toast.success('Documento subido exitosamente');
      setShowForm(false);
      setFormData(emptyDocumentForm());
      setSelectedFile(null);
      setErrors({});
    },
    onError: (error) => {
      // The dialog stays open with what was typed, and — because the button
      // follows uploadMutation.isPending — ready to retry.
      toast.error(`Error al subir el documento. ${humanizeError(error)}`);
      console.error(error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => guardedDelete('OfficialDocument', id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['officialDocuments'] });
      toast.success('Documento eliminado');
    },
  });

  // `mutate`, not `await mutateAsync`, and no local "uploading" flag: the old
  // handler set isUploading, awaited mutateAsync and only then cleared it, so a
  // failed upload rejected past the handler (unhandled rejection) and left the
  // button on "Subiendo..." until a reload (QA 2026-09-30). The mutation's own
  // isPending is cleared on success and on failure alike.
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, () => toast.error('Tu licencia está en modo solo lectura. Reactívala para subir documentos.'))) return;
    const found = validateDocumentForm(formData, selectedFile);
    setErrors(found);
    if (hasErrors(found)) {
      fieldRefs.current[firstErrorField(found, DOCUMENT_FIELD_ORDER)]?.focus?.();
      return;
    }
    uploadMutation.mutate({ ...formData, title: formData.title.trim(), file: selectedFile });
  };

  const isUploading = uploadMutation.isPending;

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSelectFile = (file) => {
    setSelectedFile(file || null);
    if (errors.file) setErrors((prev) => ({ ...prev, file: undefined }));
  };

  // A closed dialog unmounts its file input, so a file kept in state would be
  // uploaded next time while the reopened input reads "no file chosen".
  const handleOpenChange = (open) => {
    if (!open && isUploading) return;
    setShowForm(open);
    if (!open) {
      setSelectedFile(null);
      setErrors({});
    }
  };

  const describedBy = (field) => (errors[field] ? `doc-${field}-error` : undefined);
  const fieldRef = (field) => (el) => { fieldRefs.current[field] = el; };

  const documentTypeLabels = {
    MENU: 'Menú semanal',
    COMMUNICATION: 'Comunicación oficial',
    MINUTA: 'Minuta',
    UNIFORM_CATALOG: 'Catálogo de uniformes',
  };

  if (profileLoading || isLoading) {
    return <LoadingScreen message="Cargando documentos..." />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
        <ReadOnlyBanner />
        <PageHeader
          title="Documentos oficiales"
          subtitle="Gestiona menús, comunicaciones, minutas y catálogos"
          showBack
          action={
            <Dialog open={showForm} onOpenChange={handleOpenChange}>
              <DialogTrigger asChild>
                <Button>
                  <Upload className="w-4 h-4 mr-2" />
                  Subir Documento
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Subir documento</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  <div>
                    <Label>Tipo de documento</Label>
                    <Select
                      value={formData.document_type}
                      onValueChange={(value) => setFormData({ ...formData, document_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MENU">Menú semanal</SelectItem>
                        <SelectItem value="COMMUNICATION">Comunicación oficial</SelectItem>
                        <SelectItem value="MINUTA">Minuta</SelectItem>
                        <SelectItem value="UNIFORM_CATALOG">Catálogo de uniformes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="doc-title">Título *</Label>
                    <Input
                      id="doc-title"
                      ref={fieldRef('title')}
                      value={formData.title}
                      onChange={(e) => updateField('title', e.target.value)}
                      placeholder="Ej: Menú Semana 5"
                      aria-invalid={Boolean(errors.title)}
                      aria-describedby={describedBy('title')}
                      className={cn(errors.title && INVALID_FIELD_CLASS)}
                    />
                    <FieldError id="doc-title-error" message={errors.title} />
                  </div>

                  <div>
                    <Label htmlFor="doc-description">Descripción</Label>
                    <Textarea
                      id="doc-description"
                      ref={fieldRef('description')}
                      value={formData.description}
                      onChange={(e) => updateField('description', e.target.value)}
                      placeholder="Descripción breve del documento"
                      rows={3}
                      aria-invalid={Boolean(errors.description)}
                      aria-describedby={describedBy('description')}
                      className={cn(errors.description && INVALID_FIELD_CLASS)}
                    />
                    <FieldError id="doc-description-error" message={errors.description} />
                  </div>

                  <div>
                    <Label>Dirigido a</Label>
                    <Select
                      value={formData.target_audience}
                      onValueChange={(value) => setFormData({ ...formData, target_audience: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TODOS">Todos</SelectItem>
                        <SelectItem value="PADRES">Padres</SelectItem>
                        <SelectItem value="MAESTROS">Maestros</SelectItem>
                        <SelectItem value="ADMINS">Administradores</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="doc-valid_from">Válido desde</Label>
                      <Input
                        id="doc-valid_from"
                        ref={fieldRef('valid_from')}
                        type="date"
                        value={formData.valid_from}
                        onChange={(e) => updateField('valid_from', e.target.value)}
                        aria-invalid={Boolean(errors.valid_from)}
                        aria-describedby={describedBy('valid_from')}
                        className={cn(errors.valid_from && INVALID_FIELD_CLASS)}
                      />
                      <FieldError id="doc-valid_from-error" message={errors.valid_from} />
                    </div>
                    <div>
                      <Label htmlFor="doc-valid_until">Válido hasta (opcional)</Label>
                      <Input
                        id="doc-valid_until"
                        ref={fieldRef('valid_until')}
                        type="date"
                        min={formData.valid_from || undefined}
                        value={formData.valid_until}
                        onChange={(e) => updateField('valid_until', e.target.value)}
                        aria-invalid={Boolean(errors.valid_until)}
                        aria-describedby={describedBy('valid_until')}
                        className={cn(errors.valid_until && INVALID_FIELD_CLASS)}
                      />
                      <FieldError id="doc-valid_until-error" message={errors.valid_until} />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="doc-file">Archivo PDF *</Label>
                    <Input
                      id="doc-file"
                      ref={fieldRef('file')}
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={(e) => handleSelectFile(e.target.files?.[0])}
                      aria-invalid={Boolean(errors.file)}
                      aria-describedby={describedBy('file')}
                      className={cn(errors.file && INVALID_FIELD_CLASS)}
                    />
                    <FieldError id="doc-file-error" message={errors.file} />
                  </div>

                  <Button
                    type="submit"
                    disabled={isUploading}
                    className="w-full"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Subiendo...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Subir Documento
                      </>
                    )}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="space-y-4">
          {documents?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No hay documentos oficiales</p>
                <p className="text-sm text-muted-foreground mt-1">Comienza subiendo tu primer documento</p>
              </CardContent>
            </Card>
          ) : (
            documents?.map((doc) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <CardTitle className="text-lg">{doc.title}</CardTitle>
                          {doc.is_current && (
                            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs rounded-full">
                              Vigente
                            </span>
                          )}
                        </div>
                        <CardDescription>
                          {documentTypeLabels[doc.document_type]} • {doc.target_audience}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(doc.file_url, '_blank')}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteMutation.mutate(doc.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {doc.description && (
                      <p className="text-sm text-muted-foreground mb-2">{doc.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {parseLocalDate(doc.valid_from) ? format(parseLocalDate(doc.valid_from), 'dd MMM yyyy', { locale: es }) : '—'}
                        {parseLocalDate(doc.valid_until) && ` - ${format(parseLocalDate(doc.valid_until), 'dd MMM yyyy', { locale: es })}`}
                      </div>
                      <span>•</span>
                      <span>Por {doc.uploaded_by_name}</span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}