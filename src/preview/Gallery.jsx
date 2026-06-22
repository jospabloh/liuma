import React, { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Bell, CreditCard, ClipboardList, Inbox } from 'lucide-react';

import { NavContext } from '@/components/nav/NavContext';
import SideNav from '@/components/nav/SideNav';
import PageHeader from '@/components/ui/PageHeader';
import BigTile from '@/components/ui/BigTile';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

// A mocked nav value so the REAL SideNav renders without base44/auth.
const NAV_VALUE = {
  role: 'ADMIN',
  user: { full_name: 'María Reyes', email: 'maria@colegio.mx' },
  profile: { app_role: 'ADMIN' },
  paletteOpen: false,
  openPalette: () => {},
  closePalette: () => {},
};

const BRANDS = [
  { label: 'Índigo', rgb: '79 70 229' },
  { label: 'Teal', rgb: '13 148 136' },
  { label: 'Rosa', rgb: '219 39 119' },
  { label: 'Naranja', rgb: '234 88 12' },
];

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground/70">{title}</h2>
      {children}
    </section>
  );
}

export default function Gallery() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const setBrand = (rgb) => document.documentElement.style.setProperty('--tenant-primary-rgb', rgb);
  const toggleDark = () => document.documentElement.classList.toggle('dark');

  return (
    <MemoryRouter initialEntries={['/Home']}>
      <div className="min-h-screen bg-background text-foreground">
        {/* Controls (manual viewing; the capture script drives these via the DOM) */}
        <div className="sticky top-0 z-50 flex flex-wrap items-center gap-2 border-b border-border bg-card/90 px-4 py-2 backdrop-blur">
          <span className="text-xs font-semibold text-muted-foreground">Marca:</span>
          {BRANDS.map((b) => (
            <button
              key={b.rgb}
              data-brand={b.rgb}
              onClick={() => setBrand(b.rgb)}
              className="h-6 w-6 rounded-full ring-1 ring-border"
              style={{ background: `rgb(${b.rgb})` }}
              title={b.label}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <button data-action="toggle-dark" onClick={toggleDark} className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent">
            🌓 Tema
          </button>
          <button data-action="open-dialog" onClick={() => setDialogOpen(true)} className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent">
            Abrir diálogo
          </button>
        </div>

        <div className="mx-auto max-w-6xl space-y-10 px-6 py-8">
          <PageHeader eyebrow="Design preview" title="LIUMA · Componentes premium" subtitle="Componentes reales, datos simulados" showSearch={false} />

          <Section title="Barra de navegación (escritorio)">
            {/* The real SideNav is position:fixed; a transformed wrapper becomes its
                containing block so it renders inside this framed box. */}
            <div className="overflow-hidden rounded-2xl border border-border" style={{ position: 'relative', transform: 'translateZ(0)', height: 560, width: 256 }}>
              <NavContext.Provider value={NAV_VALUE}>
                <SideNav />
              </NavContext.Provider>
            </div>
          </Section>

          <Section title="Tiles y tarjetas (elevación)">
            <div className="grid gap-3 sm:grid-cols-2">
              <BigTile icon={Bell} title="Avisos" subtitle="3 sin leer" badge={3} onClick={() => {}} />
              <BigTile icon={CreditCard} title="Pagos" subtitle="2 vencidos" onClick={() => {}} />
              <BigTile icon={ClipboardList} title="Asistencia" subtitle="Registrar hoy" onClick={() => {}} />
              <div className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-5 ui-elevation">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            </div>
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>Tarjeta premium</CardTitle>
                <CardDescription>Elevación suave consciente del tema (claro/oscuro).</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">Contenido de ejemplo dentro de una tarjeta.</CardContent>
            </Card>
          </Section>

          <Section title="Formularios (foco de marca)">
            <div className="grid max-w-xl gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Asunto</label>
                <Input placeholder="Escribe aquí…" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Categoría</label>
                <Select defaultValue="pagos">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pagos">Pagos</SelectItem>
                    <SelectItem value="academico">Académico</SelectItem>
                    <SelectItem value="tecnico">Técnico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea rows={3} placeholder="Descripción…" />
              <div className="flex justify-end gap-2">
                <Button variant="ghost">Cancelar</Button>
                <Button>Enviar</Button>
              </div>
            </div>
          </Section>

          <Section title="Carga y estado vacío">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-border [&>div]:!min-h-[240px]">
                <LoadingScreen message="Cargando tu escuela…" />
              </div>
              <div className="rounded-xl border border-border bg-card">
                <EmptyState icon={Inbox} title="Sin avisos por ahora" description="Cuando la escuela publique un aviso, aparecerá aquí." />
              </div>
            </div>
          </Section>
        </div>

        {/* Real Dialog — opened via the control above; the capture script clicks it. */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear ticket de soporte</DialogTitle>
              <DialogDescription>Se adjunta el diagnóstico técnico automáticamente; sólo describe el problema.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Asunto" />
              <Textarea rows={3} placeholder="¿Qué pasó?" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={() => setDialogOpen(false)}>Enviar ticket</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MemoryRouter>
  );
}
