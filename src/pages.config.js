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
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import OperacionDiaria from './pages/OperacionDiaria';
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
import AlertaEmergencia from './pages/AlertaEmergencia';
import Aprobaciones from './pages/Aprobaciones';
import AuditoriaAdmin from './pages/AuditoriaAdmin';
import Asistencia from './pages/Asistencia';
import Avisos from './pages/Avisos';
import AvisosAdmin from './pages/AvisosAdmin';
import AvisosMaestro from './pages/AvisosMaestro';
import Bitacora from './pages/Bitacora';
import BitacorasMaestro from './pages/BitacorasMaestro';
import CalendarioEscolar from './pages/CalendarioEscolar';
import ConfiguracionInicial from './pages/ConfiguracionInicial';
import ContactosEmergencia from './pages/ContactosEmergencia';
import CrearBitacora from './pages/CrearBitacora';
import EventosParaPadres from './pages/EventosParaPadres';
import GestionAlumno from './pages/GestionAlumno';
import GestionAusencias from './pages/GestionAusencias';
import GestionDescuentos from './pages/GestionDescuentos';
import GestionDocumentos from './pages/GestionDocumentos';
import GestionEscuela from './pages/GestionEscuela';
import GestionPedidosAdmin from './pages/GestionPedidosAdmin';
import GestionSalon from './pages/GestionSalon';
import Home from './pages/Home';
import MisHijos from './pages/MisHijos';
import Pagos from './pages/Pagos';
import PagosAdmin from './pages/PagosAdmin';
import PedidosUniformes from './pages/PedidosUniformes';
import PermisosRoles from './pages/PermisosRoles';
import Reportes from './pages/Reportes';
import ResumenAsistencia from './pages/ResumenAsistencia';
import SolicitarAusencia from './pages/SolicitarAusencia';
import Tarea from './pages/Tarea';
import TareaMaestro from './pages/TareaMaestro';
import OperacionDiaria from './pages/OperacionDiaria';
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