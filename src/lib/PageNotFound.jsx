import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

const isDev = import.meta.env?.DEV === true;

export default function PageNotFound({}) {
    const location = useLocation();
    const pageName = location.pathname.substring(1);

    const { data: authData, isFetched } = useQuery({
        queryKey: ['user'],
        queryFn: async () => {
            try {
                const user = await base44.auth.me();
                return { user, isAuthenticated: true };
            } catch (error) {
                return { user: null, isAuthenticated: false };
            }
        }
    });
    
    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-background">
            <div className="max-w-md w-full">
                <div className="text-center space-y-6">
                    {/* 404 Error Code */}
                    <div className="space-y-2">
                        <h1 className="text-7xl font-light text-slate-300 dark:text-slate-700">404</h1>
                        <div className="h-0.5 w-16 bg-slate-200 dark:bg-slate-800 mx-auto"></div>
                    </div>

                    {/* Main Message */}
                    <div className="space-y-3">
                        <h2 className="text-2xl font-medium text-slate-800 dark:text-slate-100">
                            Página no encontrada
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            No encontramos la página <span className="font-medium text-slate-700 dark:text-slate-300">"{pageName}"</span> en esta aplicación.
                        </p>
                    </div>

                    {/* Build-time hint — only shown to admins during development, never to end users in production. */}
                    {isDev && isFetched && authData.isAuthenticated && authData.user?.role === 'admin' && (
                        <div className="mt-8 p-4 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                            <div className="flex items-start space-x-3">
                                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-950/50 flex items-center justify-center mt-0.5">
                                    <div className="w-2 h-2 rounded-full bg-orange-400"></div>
                                </div>
                                <div className="text-left space-y-1">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Nota de desarrollo</p>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                        Esta ruta aún no tiene una página implementada.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Action Button — client-side navigation, no full page reload. */}
                    <div className="pt-6">
                        <Link
                            to="/"
                            className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-card border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 hover:dark:bg-slate-900 hover:border-slate-300 hover:dark:border-slate-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
                        >
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                            Ir al inicio
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}