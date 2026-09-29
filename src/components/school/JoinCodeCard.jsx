import React, { useState } from 'react';
import { Check, Copy, Link2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/hooks/useSubscription';
import {
  buildJoinLink,
  buildJoinShareMessage,
  buildWhatsAppShareUrl,
  formatJoinCode,
} from '@/lib/onboarding/joinCode';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The school's invite code for maestros and familias: short (ABCD-EFGH),
 * resolved server-side, with Copiar / Copiar liga / WhatsApp. Replaces the raw
 * 24-character School id the admin home used to print (audit F27).
 *
 * The code comes from getMySubscription (ADMIN only — the function generates
 * one if the school predates join_code). Renders nothing for anyone else.
 */
export default function JoinCodeCard({ className = '' }) {
  const { school, isSchoolAdmin } = useSubscription();
  const [copied, setCopied] = useState(null);
  if (!isSchoolAdmin || !school?.join_code) return null;

  const code = formatJoinCode(school.join_code);
  const link = buildJoinLink(typeof window !== 'undefined' ? window.location.origin : '', school.join_code);
  const message = buildJoinShareMessage({ schoolName: school.name, code: school.join_code, link });

  const handleCopy = async (what, text) => {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  return (
    <section
      aria-labelledby="join-code-title"
      className={`rounded-xl border border-brand/20 bg-brand/5 p-4 ${className}`}
    >
      <h2 id="join-code-title" className="text-sm font-medium text-brand">
        Código para invitar a maestros y familias
      </h2>
      <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-foreground" aria-live="polite">
        {code}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Compártelo con la liga: quien entre se registra con su correo y tú apruebas su acceso en Aprobaciones.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => handleCopy('code', code)}>
          {copied === 'code' ? <Check className="mr-1 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1 h-4 w-4" aria-hidden="true" />}
          {copied === 'code' ? 'Copiado' : 'Copiar código'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => handleCopy('link', link)}>
          {copied === 'link' ? <Check className="mr-1 h-4 w-4" aria-hidden="true" /> : <Link2 className="mr-1 h-4 w-4" aria-hidden="true" />}
          {copied === 'link' ? 'Copiada' : 'Copiar liga'}
        </Button>
        <Button asChild type="button" size="sm" className="bg-brand text-white hover:bg-brand/90">
          <a href={buildWhatsAppShareUrl(message)} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-1 h-4 w-4" aria-hidden="true" /> Compartir por WhatsApp
          </a>
        </Button>
      </div>
    </section>
  );
}
