import { ApiError } from "./platform.js";
export function createAuditAttachmentHandler({ clients, allowedOrigins }) {
  return async (request) => {
    const origin = request.headers.get("origin"),
      allowed = !origin || allowedOrigins.includes(origin);
    const headers = { "Cache-Control": "no-store", Vary: "Origin" };
    if (origin && allowed)
      Object.assign(headers, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers":
          "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
    const fail = (status, error, message) =>
      new Response(JSON.stringify({ error, message }), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    if (!allowed) return fail(403, "origin_not_allowed");
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return fail(405, "method_not_allowed");
    try {
      const token = request.headers.get("authorization");
      if (!token || !/^Bearer \S+$/i.test(token))
        throw new ApiError(401, "unauthorized", "Ingresá para continuar.");
      const { caller, privileged } = clients(token);
      const { data, error } = await caller.auth.getUser(token.slice(7));
      if (error || !data?.user?.email_confirmed_at || data.user.is_anonymous)
        throw new ApiError(
          401,
          "unauthorized",
          "Ingresá con una cuenta confirmada.",
        );
      const reader = request.body?.getReader();
      if (!reader)
        throw new ApiError(400, "invalid_request", "Solicitud inválida.");
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096) {
            await reader.cancel();
            throw new ApiError(
              413,
              "request_too_large",
              "Solicitud demasiado grande.",
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let body;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ApiError(400, "invalid_request", "Solicitud inválida.");
      }
      if (
        !body ||
        Object.keys(body).some(
          (key) => !["attachment_id", "reason"].includes(key),
        ) ||
        typeof body.attachment_id !== "string" ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
          body.attachment_id,
        ) ||
        typeof body.reason !== "string" ||
        body.reason.trim().length < 10 ||
        body.reason.length > 1000
      )
        throw new ApiError(
          400,
          "invalid_request",
          "Adjunto y motivo válidos requeridos.",
        );
      const result = await caller.rpc("campo_audit_attachment", {
        aid: body.attachment_id,
        why: body.reason,
      });
      if (result.error)
        throw new ApiError(
          result.error.code === "42501" ? 403 : 400,
          "forbidden",
          "No se autorizó la consulta del adjunto.",
        );
      const file = await privileged.storage
        .from("campo-private")
        .download(result.data.object_path);
      if (file.error || !file.data)
        throw new ApiError(
          503,
          "download_failed",
          "No se pudo descargar el adjunto. El intento quedó registrado.",
        );
      return new Response(file.data, {
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="adjunto-auditado"',
        },
      });
    } catch (error) {
      return error instanceof ApiError
        ? fail(error.status, error.code, error.message)
        : fail(503, "download_failed", "No se pudo completar la consulta.");
    }
  };
}
