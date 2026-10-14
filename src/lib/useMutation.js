import { useRef, useState } from "react";
import { adminCommand, contentOperation, executeContent } from "./teamApi";

export function useMutation(after) {
  const pending = useRef(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(action, payload, media = null, admin = false) {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const signature = JSON.stringify({ action, payload, media, admin });
      if (pending.current?.signature !== signature)
        pending.current = {
          signature,
          operation: admin
            ? { operation_id: crypto.randomUUID() }
            : contentOperation(action, payload, media),
        };
      const result = admin
        ? await adminCommand(
            action,
            payload,
            pending.current.operation.operation_id,
          )
        : await executeContent(pending.current.operation);
      pending.current = null;
      setNotice("Cambios guardados.");
      await after?.(result);
      return result;
    } catch (failure) {
      setError(failure.message || "No se pudo guardar.");
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error, notice, setError };
}
