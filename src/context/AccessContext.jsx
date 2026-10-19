import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";
import { platform } from "../lib/teamApi";
import { savedAccess, rememberAccess, isConnectionFailure, clearReadCache } from '../lib/offlineStore';

const AccessContext = createContext(null);
export function AccessProvider({ children }) {
  const { user, session, offlineSession } = useAuth();
  const [state, setState] = useState({
    user_id: null,
    data: null,
    status: "loading",
    error: "",
  });
  const sequence = useRef(0),
    current = useRef(user?.id);
  current.current = user?.id;
  const inFlight = useRef(null);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    if (!user) {
      setState({ user_id: null, data: null, status: "signed_out", error: "" });
      return null;
    }
    const restoreOffline = async () => {
      const cached = await savedAccess(user.id).catch(() => null);
      if (current.current !== user.id || request !== sequence.current) return null;
      setState(previous => ({ user_id: user.id,
        data: cached || (previous.user_id === user.id ? previous.data : null), status: 'offline', error: '' }));
      return null; // Cached permissions allow local capture only; replay always needs a fresh server check.
    };
    if (!navigator.onLine || offlineSession) return restoreOffline();
    try {
      const data = await platform({ action: "access.context" });
      if (current.current !== user.id || request !== sequence.current)
        return null;
      if (
        data?.user_id !== user.id ||
        !["active", "awaiting_approval"].includes(data.status)
      )
        throw new Error("No se pudo verificar el acceso a la organización.");
      if (
        data.status === "active" &&
        (!["SUPER_ADMIN", "GERENTE_GENERAL", "GERENTE", "ENCARGADO", "USUARIO"].includes(
          data.role,
        ) ||
          !Array.isArray(data.teams) ||
          (data.role !== "SUPER_ADMIN" &&
            (!data.organization_id || !data.member_id)))
      )
        throw new Error("La respuesta de permisos no es válida.");
      setState({ user_id: user.id, data, status: data.status, error: "" });
      await rememberAccess({ ...data, offlineIdentity: { id: user.id, email: user.email } }).catch(() => {});
      if (current.current !== user.id) { await clearReadCache(user.id).catch(() => {}); return null; }
      return data;
    } catch (error) {
      if (isConnectionFailure(error)) return restoreOffline();
      if (current.current === user.id && request === sequence.current)
        setState({
          user_id: user.id,
          data: null,
          status: "error",
          error: error.message,
        });
      return null;
    }
  }, [user?.id, session?.access_token, offlineSession]);
  const reload = useCallback(() => {
    if (inFlight.current?.loader === load) return inFlight.current.promise;
    const entry = { loader: load };
    entry.promise = load().finally(() => { if (inFlight.current === entry) inFlight.current = null; });
    inFlight.current = entry;
    return entry.promise;
  }, [load]);
  useEffect(() => {
    setState((previous) =>
      previous.user_id === user?.id
        ? previous
        : { user_id: user?.id, data: null, status: "loading", error: "" },
    );
    reload();
    const online = () => reload();
    const offline = () => reload();
    const visible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", online);
    window.addEventListener('pageshow', online);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(() => {
      if (navigator.onLine) reload();
    }, 30000);
    return () => {
      sequence.current++;
      inFlight.current = null;
      clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", online);
      window.removeEventListener('pageshow', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reload]);
  const safe =
    state.user_id === user?.id
      ? state
      : { data: null, status: "loading", error: "" };
  return (
    <AccessContext.Provider value={{ ...safe, reload }}>
      {children}
    </AccessContext.Provider>
  );
}
export const useAccess = () => useContext(AccessContext);
