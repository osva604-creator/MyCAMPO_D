import { useCallback, useEffect, useRef, useState } from "react";

export function useResource(loader, { poll = 0, events = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const sequence = useRef(0);
  const cleanup = useRef(null);
  const mounted = useRef(false);
  const dataLoader = useRef(null);
  const eventKey = events.join(",");
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setBusy(true);
    try {
      const next = await loader();
      if (!mounted.current || current !== sequence.current) {
        next?.dispose?.();
        return null;
      }
      cleanup.current?.();
      cleanup.current = next?.dispose;
      dataLoader.current = loader;
      setData(next);
      setError("");
      return next;
    } catch (failure) {
      if (mounted.current && current === sequence.current) {
        cleanup.current?.();
        cleanup.current = null;
        dataLoader.current = loader;
        setData(null);
        setError(failure.message || "No se pudieron cargar los datos.");
      }
      return null;
    } finally {
      if (mounted.current && current === sequence.current) setBusy(false);
    }
  }, [loader]);
  useEffect(() => {
    mounted.current = true;
    reload();
    const focus = () => {
      if (navigator.onLine) reload();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    let debounce;
    const changed = (event) => {
      if (
        navigator.onLine &&
        eventKey &&
        (!event.detail?.table ||
          eventKey.split(",").includes(event.detail.table))
      ) {
        clearTimeout(debounce);
        debounce = setTimeout(reload, 200);
      }
    };
    window.addEventListener("mycampo-d:team-change", changed);
    const timer = poll
      ? setInterval(() => {
          if (navigator.onLine && document.visibilityState !== "hidden")
            reload();
        }, poll)
      : null;
    return () => {
      mounted.current = false;
      sequence.current++;
      cleanup.current?.();
      cleanup.current = null;
      clearTimeout(debounce);
      window.removeEventListener("mycampo-d:team-change", changed);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      if (timer) clearInterval(timer);
    };
  }, [reload, poll, eventKey]);
  return {
    data: dataLoader.current === loader ? data : null,
    error: dataLoader.current === loader ? error : "",
    busy: busy || dataLoader.current !== loader,
    reload,
  };
}
