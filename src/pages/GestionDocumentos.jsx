import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
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
import { parseLocalDate } from '@/lib/dates';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';

export default function GestionDocumentos() {
  const { canWrite } = useCanWrite();
  const [isUploading, setIsUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    document_type: 'COMMUNICATION',
    target_audience: 'TODOS',
    valid_from: format(new Date(), 'yyyy-MM-dd'),
    valid_until: '',
  });
  const [selectedFile, setSelectedFile] = useState(null);

  const queryClient = useQueryClient();

  const { user, userProfile, isLoading: profileLoading } = useCurrentProfile();

  const { data: documents, isLoading } = useQuery({
    queryKey: ['officialDocuments', userProfile?.school_id],
    queryFn: () => base44.entities.OfficialDocument.filter({ school_id: userProfile.school_id }, '-created_date'),
    enabled: !!userProfile?.school_id,
  });

  const uploadMutation = useMutation({
    mutationFn: async (data) => {
      // First, upload the file
      const { file_url } = await base44.integrations.Core.UploadFile({ file: data.file });
      
      // Mark previous documents of same type as not current
      if (data.document_type === 'MENU' || data.document_type === 'UNIFORM_CATALOG') {
        const previousDocs = await base44.entities.OfficialDocument.filter({
          school_id: userProfile.school_id,
          document_type: data.document_type,
          is_current: true
        });
        
        for (const doc of previousDocs) {
          await base44.entities.OfficialDocument.update(doc.id, { is_current: false });
        }
      }
      
      // Create the document record
      return base44.entities.OfficialDocument.create({
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
      setFormData({
        title: '',
        description: '',
        document_type: 'COMMUNICATION',
        target_audience: 'TODOS',
        valid_from: format(new Date(), 'yyyy-MM-dd'),
        valid_until: '',
      });
      setSelectedFile(null);
    },
    onError: (error) => {
      toast.error('Error al subir el documento');
      console.error(error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.OfficialDocument.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['officialDocuments'] });
      toast.success('Documento eliminado');
    },
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, () => toast.error('Tu licencia está en modo solo lectura. Reactívala para subir documentos.'))) return;
    if (!selectedFile) {
      toast.error('Por favor selecciona un archivo PDF');
      return;
    }

    setIsUploading(true);
    await uploadMutation.mutateAsync({ ...formData, file: selectedFile });
    setIsUploading(false);
  };

  const documentTypeLabels = {
    MENU: 'Menú semanal',
    COMMUNICATION: 'Comunicación oficial',
    MINUTA: 'Minuta',
    UNIFORM_CATALOG: 'Catálogo de Uniformes',
  };

  if (profileLoading || isLoading) {
    return <LoadingScreen message="Cargando documentos..." />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
        <ReadOnlyBanner />
        <PageHeader
          title="Documentos Oficiales"
          subtitle="Gestiona menús, comunicaciones, minutas y catálogos"
          showBack
          action={
            <Dialog open={showForm} onOpenChange={setShowForm}>
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
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label>Tipo de Documento</Label>
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
                        <SelectItem value="UNIFORM_CATALOG">Catálogo de Uniformes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Título</Label>
                    <Input
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="Ej: Menú Semana 5"
                      required
                    />
                  </div>

                  <div>
                    <Label>Descripción</Label>
                    <Textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Descripción breve del documento"
                      rows={3}
                    />
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
                      <Label>Válido desde</Label>
                      <Input
                        type="date"
                        value={formData.valid_from}
                        onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Válido hasta (opcional)</Label>
                      <Input
                        type="date"
                        value={formData.valid_until}
                        onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Archivo PDF</Label>
                    <Input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setSelectedFile(e.target.files[0])}
                      required
                    />
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