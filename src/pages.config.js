/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   const Home = React.lazy(() => import('./pages/Home'));
 *   import Settings from './pages/Settings';
 *   const OperacionDiaria = React.lazy(() => import('./pages/OperacionDiaria'));
import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import React from 'react';
const AlertaEmergencia = React.lazy(() => import('./pages/AlertaEmergencia'));
const Aprobaciones = React.lazy(() => import('./pages/Aprobaciones'));
const AuditoriaAdmin = React.lazy(() => import('./pages/AuditoriaAdmin'));
const Asistencia = React.lazy(() => import('./pages/Asistencia'));
const Avisos = React.lazy(() => import('./pages/Avisos'));
const AvisosAdmin = React.lazy(() => import('./pages/AvisosAdmin'));
const AvisosMaestro = React.lazy(() => import('./pages/AvisosMaestro'));
const Bitacora = React.lazy(() => import('./pages/Bitacora'));
const BitacorasMaestro = React.lazy(() => import('./pages/BitacorasMaestro'));
const CalendarioEscolar = React.lazy(() => import('./pages/CalendarioEscolar'));
const ConfiguracionInicial = React.lazy(() => import('./pages/ConfiguracionInicial'));
const ContactosEmergencia = React.lazy(() => import('./pages/ContactosEmergencia'));
const CrearBitacora = React.lazy(() => import('./pages/CrearBitacora'));
const EventosParaPadres = React.lazy(() => import('./pages/EventosParaPadres'));
const GestionAlumno = React.lazy(() => import('./pages/GestionAlumno'));
const GestionAusencias = React.lazy(() => import('./pages/GestionAusencias'));
const GestionDescuentos = React.lazy(() => import('./pages/GestionDescuentos'));
const GestionDocumentos = React.lazy(() => import('./pages/GestionDocumentos'));
const GestionEscuela = React.lazy(() => import('./pages/GestionEscuela'));
const GestionPedidosAdmin = React.lazy(() => import('./pages/GestionPedidosAdmin'));
const GestionSalon = React.lazy(() => import('./pages/GestionSalon'));
const Home = React.lazy(() => import('./pages/Home'));
const MisHijos = React.lazy(() => import('./pages/MisHijos'));
const Pagos = React.lazy(() => import('./pages/Pagos'));
const PagosAdmin = React.lazy(() => import('./pages/PagosAdmin'));
const PedidosUniformes = React.lazy(() => import('./pages/PedidosUniformes'));
const PermisosRoles = React.lazy(() => import('./pages/PermisosRoles'));
const Reportes = React.lazy(() => import('./pages/Reportes'));
const ResumenAsistencia = React.lazy(() => import('./pages/ResumenAsistencia'));
const SolicitarAusencia = React.lazy(() => import('./pages/SolicitarAusencia'));
const Tarea = React.lazy(() => import('./pages/Tarea'));
const TareaMaestro = React.lazy(() => import('./pages/TareaMaestro'));
const OperacionDiaria = React.lazy(() => import('./pages/OperacionDiaria'));
import __Layout from './Layout.jsx';


export const PAGES = {
    "AlertaEmergencia": AlertaEmergencia,
    "Aprobaciones": Aprobaciones,
    "AuditoriaAdmin": AuditoriaAdmin,
    "Asistencia": Asistencia,
    "Avisos": Avisos,
    "AvisosAdmin": AvisosAdmin,
    "AvisosMaestro": AvisosMaestro,
    "Bitacora": Bitacora,
    "BitacorasMaestro": BitacorasMaestro,
    "CalendarioEscolar": CalendarioEscolar,
    "ConfiguracionInicial": ConfiguracionInicial,
    "ContactosEmergencia": ContactosEmergencia,
    "CrearBitacora": CrearBitacora,
    "EventosParaPadres": EventosParaPadres,
    "GestionAlumno": GestionAlumno,
    "GestionAusencias": GestionAusencias,
    "GestionDescuentos": GestionDescuentos,
    "GestionDocumentos": GestionDocumentos,
    "GestionEscuela": GestionEscuela,
    "GestionPedidosAdmin": GestionPedidosAdmin,
    "GestionSalon": GestionSalon,
    "Home": Home,
    "MisHijos": MisHijos,
    "OperacionDiaria": OperacionDiaria,
    "Pagos": Pagos,
    "PagosAdmin": PagosAdmin,
    "PermisosRoles": PermisosRoles,
    "PedidosUniformes": PedidosUniformes,
    "Reportes": Reportes,
    "ResumenAsistencia": ResumenAsistencia,
    "SolicitarAusencia": SolicitarAusencia,
    "Tarea": Tarea,
    "TareaMaestro": TareaMaestro,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};