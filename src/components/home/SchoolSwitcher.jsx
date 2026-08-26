import React from 'react';
import { Plus } from 'lucide-react';

/**
 * SchoolSwitcher — Módulo 18 (jospabloh/acacia-app-standard → STANDARD.md).
 *
 * Reemplaza el fila de "pills" de solo lectura que vivía dentro de
 * `AdminHome.jsx` (visible solo para ADMIN, sin `onClick`, decorativa) por un
 * control real, compartido por los tres roles, montado una sola vez en
 * `Home.jsx` — el único lugar que ya resuelve "cuál es mi escuela actual".
 *
 * Las pills solo aparecen si `options.length > 1` (nunca un control sin nada
 * que hacer). El enlace "Unirme a otra escuela" está siempre, porque es
 * justo la forma de llegar a la SEGUNDA escuela por primera vez — un
 * switcher gateado en `options.length > 1` nunca puede exponer eso.
 */
export default function SchoolSwitcher({ options, onSwitch, onJoinAnother }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 pt-3">
      {options.length > 1 && options.map((option) => (
        <button
          key={option.profile_id}
          type="button"
          onClick={() => onSwitch(option.school_id)}
          disabled={option.is_current}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            option.is_current
              ? 'bg-brand text-white cursor-default'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {option.school_name}{option.is_current ? ' · actual' : ''}
        </button>
      ))}
      <button
        type="button"
        onClick={onJoinAnother}
        className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Plus className="w-3 h-3" />
        Unirme a otra escuela
      </button>
    </div>
  );
}
