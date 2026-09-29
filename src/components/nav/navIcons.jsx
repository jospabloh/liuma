import {
  Home, CalendarCheck, Bell, LayoutGrid, UserCheck, ClipboardList, ClipboardCheck,
  CalendarOff, Siren, Calendar, School, CreditCard, Percent, FileText, ShoppingBag,
  BarChart3, ShieldCheck, Settings, KeyRound, ScrollText, Headset, LifeBuoy, BookOpen,
  NotebookPen, Users, Shirt, PartyPopper, History, HelpCircle, MessageCircle, Circle,
} from 'lucide-react';

// String → lucide component, so navRegistry.js can stay pure (no JSX/imports).
const ICONS = {
  Home, CalendarCheck, Bell, LayoutGrid, UserCheck, ClipboardList, ClipboardCheck,
  CalendarOff, Siren, Calendar, School, CreditCard, Percent, FileText, ShoppingBag,
  BarChart3, ShieldCheck, Settings, KeyRound, ScrollText, Headset, LifeBuoy, BookOpen,
  NotebookPen, Users, Shirt, PartyPopper, History, HelpCircle, MessageCircle,
};

export function NavIcon({ name, className }) {
  const Cmp = ICONS[name] || Circle;
  return <Cmp className={className} />;
}
