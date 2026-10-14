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

const AccessContext = createContext(null);
export function AccessProvider({ children }) {
  const { user, session } = useAuth();
  const [state, setState] = useState({
    user_id: null,
    data: null,
    status: "loading",
    error: "",
  });
  const sequence = useRef(0),
    current = useRef(user?.id);
  current.current = user?.id;
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    if (!user) {
      setState({ user_id: null, data: null, status: "signed_out", error: "" });
      return null;
    }
    if (!navigator.onLine) {
      setState((previous) =>
        previous.user_id === user.id
          ? { ...previous, status: "offline", error: "" }
          : { user_id: user.id, data: null, status: "offline", error: "" },
      );
      return null;
    }
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
        (!["SUPER_ADMIN", "GERENTE", "ENCARGADO", "USUARIO"].includes(
          data.role,
        ) ||
          !Array.isArray(data.teams) ||
          (data.role !== "SUPER_ADMIN" &&
            (!data.organization_id || !data.member_id)))
      )
        throw new Error("La respuesta de permisos no es válida.");
      setState({ user_id: user.id, data, status: data.status, error: "" });
      return data;
    } catch (error) {
      if (current.current === user.id && request === sequence.current)
        setState({
          user_id: user.id,
          data: null,
          status: "error",
          error: error.message,
        });
      return null;
    }
  }, [user?.id, session?.access_token]);
  useEffect(() => {
    setState((previous) =>
      previous.user_id === user?.id
        ? previous
        : { user_id: user?.id, data: null, status: "loading", error: "" },
    );
    reload();
    const online = () => reload();
    const offline = () =>
      setState((previous) => ({ ...previous, status: "offline" }));
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", online);
    const timer = setInterval(() => {
      if (navigator.onLine) reload();
    }, 30000);
    return () => {
      sequence.current++;
      clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", online);
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
