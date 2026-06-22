import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { useNav } from '@/components/nav/NavContext';

export default function PageHeader({ 
  title, 
  subtitle,
  showBack = false,
  backTo,
  action 
}) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { openPalette } = useNav();

  const handleBack = () => {
    if (backTo) {
      navigate(backTo);
    } else {
      navigate(-1);
    }
  };
  
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between mb-6"
    >
      <div className="flex items-center gap-3 min-w-0">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Volver"
            onClick={handleBack}
            className="mobile-touch-target rounded-full"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Buscar"
          onClick={openPalette}
          className="mobile-touch-target rounded-full"
        >
          <Search className="w-5 h-5" />
        </Button>
        {action && <div>{action}</div>}
      </div>
    </motion.div>
  );
}
