import { ApiError } from "./platform.js";

export function validFile(bytes, mime) {
  if (mime === "image/jpeg")
    return (
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (mime === "application/pdf")
    return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  return false;
}
async function bytesFrom(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_file", "Seleccioná un archivo.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 10485760) {
        await reader.cancel();
        throw new ApiError(413, "file_too_large", "El archivo supera 10 MB.");
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
  return bytes;
}
async function hash(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function createAttachmentHandler({ clients, allowedOrigins }) {
  return async (request) => {
    const origin = request.headers.get("origin");
    const allowed = !origin || allowedOrigins.includes(origin);
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (origin && allowed)
      Object.assign(headers, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers":
          "authorization, apikey, content-type, x-client-info, x-attachment-id",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
    const response = (status, data) =>
      new Response(JSON.stringify(data), { status, headers });
    if (!allowed) return response(403, { error: "origin_not_allowed" });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return response(405, { error: "method_not_allowed" });
    try {
      const authorization = request.headers.get("authorization");
      if (!authorization || !/^Bearer \S+$/i.test(authorization))
        throw new ApiError(401, "unauthorized", "Ingresá para continuar.");
      const { caller, privileged } = clients(authorization);
      const { data: identity, error: authError } = await caller.auth.getUser(
        authorization.slice(7),
      );
      if (
        authError ||
        !identity?.user?.email_confirmed_at ||
        identity.user.is_anonymous
      )
        throw new ApiError(
          401,
          "unauthorized",
          "Ingresá con una cuenta confirmada.",
        );
      const aid = request.headers.get("x-attachment-id");
      if (!aid || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(aid))
        throw new ApiError(400, "invalid_file", "Archivo inválido.");
      const { data: file, error } = await caller
        .from("attachments")
        .select("id,object_path,mime_type,size_bytes,uploaded_by,ready,sha256")
        .eq("id", aid)
        .maybeSingle();
      if (error || !file || file.uploaded_by !== identity.user.id)
        throw new ApiError(
          403,
          "forbidden",
          "No tenés permisos para subir este archivo.",
        );
      const bytes = await bytesFrom(request);
      const mime = request.headers.get("content-type")?.split(";")[0];
      if (
        bytes.length !== Number(file.size_bytes) ||
        mime !== file.mime_type ||
        !validFile(bytes, mime)
      )
        throw new ApiError(
          400,
          "invalid_file",
          "El contenido o tamaño del archivo no coincide.",
        );
      const checksum = await hash(bytes);
      const authorized = async () => {
        const { data, error } = await caller
          .from("attachments")
          .select("id")
          .eq("id", aid)
          .maybeSingle();
        if (error || !data)
          throw new ApiError(
            403,
            "forbidden",
            "El acceso cambió durante la subida.",
          );
      };
      await authorized();
      if (file.ready && file.sha256 !== checksum)
        throw new ApiError(
          409,
          "immutable_file",
          "Este archivo ya fue publicado.",
        );
      if (!file.ready) {
        const { error: uploadError } = await privileged.storage
          .from("campo-private")
          .upload(file.object_path, bytes, {
            contentType: mime,
            upsert: false,
          });
        if (uploadError) {
          if (
            String(uploadError.statusCode) !== "409" &&
            uploadError.error !== "Duplicate"
          )
            throw new ApiError(
              503,
              "upload_failed",
              "No se pudo subir el archivo. Podés reintentar.",
            );
          const { data: old, error: downloadError } = await privileged.storage
            .from("campo-private")
            .download(file.object_path);
          if (
            downloadError ||
            !old ||
            (await hash(new Uint8Array(await old.arrayBuffer()))) !== checksum
          )
            throw new ApiError(
              409,
              "immutable_file",
              "Hay un archivo diferente en esta publicación.",
            );
        }
      }
      await authorized();
      const { error: finishError } = await privileged.rpc(
        "campo_finish_attachment",
        { aid, checksum },
      );
      if (finishError)
        throw new ApiError(
          503,
          "upload_unconfirmed",
          "El archivo se subió, pero falta confirmar. Reintentá con el mismo archivo.",
        );
      return response(200, { data: { id: aid, status: "ready" } });
    } catch (error) {
      if (error instanceof ApiError)
        return response(error.status, {
          error: error.code,
          message: error.message,
        });
      return response(503, {
        error: "upload_failed",
        message: "No se pudo completar la subida.",
      });
    }
  };
}
