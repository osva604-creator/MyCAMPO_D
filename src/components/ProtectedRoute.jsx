import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export default function ProtectedRoute({ children }) {
  const { user, loading, recovery } = useAuth();
  const location = useLocation();
  if (loading) return <p role="status" className="p-8">Cargando sesión…</p>;
  if (recovery) return <Navigate to="/reset-password" replace />;
  if (supabase && !user) return <Navigate to="/login" state={{ from: location.pathname + location.search + location.hash }} replace />;
  return children;
}
