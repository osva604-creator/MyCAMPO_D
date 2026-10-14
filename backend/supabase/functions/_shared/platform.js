// Framework-independent handler: testable without Deno or a live Supabase project.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shapes = {
  "work_team.create": { name: "name", organization_id: "uuid?", reason: "reason" },
  "work_team.update": { id: "uuid", name: "name", reason: "reason" },
  "team.link": { work_team_id: "uuid", organization_id: "uuid", reason: "reason" },
  "organization.create": { name: "name", reason: "reason" },
  "organization.update": {
    id: "uuid",
    name: "name?",
    active: "boolean?",
    reason: "reason",
  },
  "team.create": { organization_id: "uuid", name: "name", reason: "reason" },
  "team.update": {
    id: "uuid",
    name: "name?",
    active: "boolean?",
    reason: "reason",
  },
  "membership.set": {
    user_id: "uuid",
    organization_id: "uuid",
    role: "role",
    team_ids: "uuids",
    name: "memberName",
    reason: "reason",
  },
  "membership.suspend": { user_id: "uuid", reason: "reason" },
  "invitation.approve": {
    request_id: "uuid",
    organization_id: "uuid",
    role: "role",
    team_ids: "uuids",
    reason: "reason",
  },
  "invitation.reject": { request_id: "uuid", reason: "reason" },
  "invitation.revoke": { invitation_id: "uuid", reason: "reason" },
  "invitation.resolve": {
    invitation_id: "uuid",
    outcome: "resolution",
    recipient_id: "uuid?",
    reason: "reason",
  },
  "settings.update": { messaging_scope: "scope", reason: "reason" },
};
const invalid = () => {
  throw new ApiError(
    400,
    "invalid_request",
    "Revisá los campos de la solicitud.",
  );
};
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validate(value, shape) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(shape, key))
  )
    invalid();
  for (const [key, rule] of Object.entries(shape)) {
    if (rule.endsWith("?") && value[key] === undefined) continue;
    const type = rule.replace(/\?$/, "");
    const item = value[key];
    if (type === "uuid" && !(typeof item === "string" && UUID.test(item)))
      invalid();
    if (type === "boolean" && typeof item !== "boolean") invalid();
    if (
      type === "uuids" &&
      !(
        Array.isArray(item) &&
        item.length <= 100 &&
        new Set(item).size === item.length &&
        item.every((id) => typeof id === "string" && UUID.test(id))
      )
    )
      invalid();
    const lengths = { name: [1, 120], memberName: [1, 80], reason: [10, 1000] };
    if (
      lengths[type] &&
      !(
        typeof item === "string" &&
        item.trim().length >= lengths[type][0] &&
        item.trim().length <= lengths[type][1]
      )
    )
      invalid();
    if (type === "role" && !["GERENTE", "ENCARGADO", "USUARIO"].includes(item))
      invalid();
    if (
      type === "resolution" &&
      !["confirmed_sent", "confirmed_not_sent"].includes(item)
    )
      invalid();
    if (type === "scope" && !["same_organization", "disabled"].includes(item))
      invalid();
    if (
      type === "email" &&
      !(
        typeof item === "string" &&
        item.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.trim())
      )
    )
      invalid();
  }
}
async function bodyJson(request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ApiError(415, "json_required", "La solicitud debe usar JSON.");
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new ApiError(
          413,
          "request_too_large",
          "La solicitud es demasiado grande.",
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      invalid();
    }
  } finally {
    reader.releaseLock();
  }
}
async function rpc(client, name, args = {}) {
  const result = await client.rpc(name, args);
  if (result.error) {
    const code = result.error.code;
    if (code === "42501")
      throw new ApiError(
        403,
        "forbidden",
        "No tenés permisos para realizar esta operación.",
      );
    if (code === "P0002")
      throw new ApiError(404, "not_found", "No se encontró el recurso.");
    if (["23505", "40001", "40P01"].includes(code))
      throw new ApiError(
        409,
        "conflict",
        "La operación entra en conflicto con el estado actual. Actualizá los datos antes de reintentar.",
      );
    if (["22023", "22P02", "23514", "23502", "23503"].includes(code)) invalid();
    // Never return raw PostgreSQL/Auth errors, SQL, emails, tokens or credentials.
    throw new ApiError(
      503,
      "backend_unavailable",
      "No se pudo completar la operación.",
    );
  }
  return result.data;
}
export async function dispatch(body, caller, privileged, redirectBase) {
  if (!object(body) || typeof body.action !== "string") invalid();
  const action = body.action;
  if (action === "admin.accounts") {
    validate(body, {
      action: "text",
      search: "text?",
      before_email: "text?",
      before_id: "uuid?",
    });
    if (
      (body.search !== undefined &&
        (typeof body.search !== "string" || body.search.length > 254)) ||
      (body.before_email !== undefined &&
        typeof body.before_email !== "string") ||
      (body.before_email === undefined) !== (body.before_id === undefined)
    )
      invalid();
    return await rpc(caller, "campo_accounts", {
      term: body.search || "",
      before_email: body.before_email ?? null,
      before_id: body.before_id ?? null,
    });
  }
  if (action === "content.command") {
    validate(body, {
      action: "text",
      content_action: "text",
      payload: "object",
      operation_id: "uuid",
    });
    if (
      !object(body.payload) ||
      ![
        "post.create",
        "post.status",
        "comment.create",
        "reaction.set",
        "task.create",
        "task.update",
        "conversation.open",
        "message.send",
      ].includes(body.content_action)
    )
      invalid();
    return await rpc(caller, "campo_content_command", {
      action: body.content_action,
      payload: body.payload,
      operation_id: body.operation_id,
    });
  }
  if (action === "messages.inbox" || action === "audit.conversations") {
    validate(body, { action: "text", before: "text?", before_id: "uuid?" });
    if (
      (body.before === undefined) !== (body.before_id === undefined) ||
      (body.before !== undefined &&
        (typeof body.before !== "string" ||
          !Number.isFinite(Date.parse(body.before))))
    )
      invalid();
    return await rpc(
      caller,
      action === "messages.inbox" ? "campo_inbox" : "campo_audit_conversations",
      { page_before: body.before ?? null, before_id: body.before_id ?? null },
    );
  }
  if (Object.hasOwn(shapes, action)) {
    validate(body, { action: "text", payload: "object", operation_id: "uuid" });
    validate(body.payload, shapes[action]);
    if (
      action.endsWith(".update") &&
      action !== "settings.update" &&
      body.payload.name === undefined &&
      body.payload.active === undefined
    )
      invalid();
    if (
      action === "invitation.resolve" &&
      (body.payload.outcome === "confirmed_sent") !==
        Boolean(body.payload.recipient_id)
    )
      invalid();
    return await rpc(caller, "campo_admin_command", {
      action,
      payload: body.payload,
      operation_id: body.operation_id,
    });
  }
  if (action === "access.context") {
    validate(body, { action: "text" });
    return await rpc(caller, "campo_access_context");
  }
  if (action === "invitation.request") {
    validate(body, { action: "text", organization_id: "uuid", email: "email" });
    return await rpc(caller, "campo_request_invitation", {
      org: body.organization_id,
      invite_email: body.email.trim().toLowerCase(),
    });
  }
  if (action === "invitation.activate") {
    validate(body, {
      action: "text",
      invitation_id: "uuid",
      name: "memberName",
    });
    return await rpc(caller, "campo_activate_invitation", {
      iid: body.invitation_id,
      display_name: body.name,
    });
  }
  if (action === "audit.messages") {
    validate(body, {
      action: "text",
      conversation_id: "uuid",
      reason: "reason",
      before: "text?",
      before_id: "uuid?",
    });
    if (
      (body.before === undefined) !== (body.before_id === undefined) ||
      (body.before !== undefined &&
        (typeof body.before !== "string" ||
          !Number.isFinite(Date.parse(body.before))))
    )
      invalid();
    return await rpc(caller, "campo_audit_message_page", {
      cid: body.conversation_id,
      why: body.reason,
      page_before: body.before ?? null,
      before_id: body.before_id ?? null,
    });
  }
  if (action === "invitation.send") {
    validate(body, { action: "text", invitation_id: "uuid" });
    const claim = await rpc(caller, "campo_claim_invitation", {
      iid: body.invitation_id,
    });
    if (!claim.send) return { status: claim.status };
    let outcome = "uncertain";
    let recipient = null;
    let errorCode = "transport_unknown";
    try {
      const { data, error } = await privileged.auth.admin.inviteUserByEmail(
        claim.email,
        {
          redirectTo: `${redirectBase}/activar-cuenta?invitacion=${body.invitation_id}`,
        },
      );
      if (!error && data?.user?.id) {
        outcome = "sent";
        recipient = data.user.id;
        errorCode = null;
      } else if (error?.code === "over_email_send_rate_limit") {
        outcome = "failed";
        errorCode = "over_email_send_rate_limit";
      } else {
        errorCode = "auth_delivery_unknown";
      }
    } catch {
      /* An ambiguous network result must never trigger an automatic second email. */
    }
    // Even if this RPC fails, the durable claim remains "sending" and blocks another dispatch.
    const result = await rpc(privileged, "campo_finish_invitation", {
      iid: body.invitation_id,
      claim: claim.claim,
      outcome,
      recipient,
      error_code: errorCode,
    });
    return {
      status: result.status,
      requires_review: result.status === "uncertain",
    };
  }
  invalid();
}

export function createHandler({ clients, allowedOrigins, redirectBase }) {
  return async (request) => {
    const origin = request.headers.get("origin");
    const allowed = !origin || allowedOrigins.includes(origin);
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (origin && allowed) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] =
        "authorization, apikey, content-type, x-client-info";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const respond = (status, value) =>
      new Response(JSON.stringify(value), { status, headers });
    if (!allowed) return respond(403, { error: "origin_not_allowed" });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return respond(405, { error: "method_not_allowed" });
    try {
      const authorization = request.headers.get("authorization");
      if (!authorization || !/^Bearer \S+$/i.test(authorization))
        throw new ApiError(401, "unauthorized", "Ingresá para continuar.");
      const token = authorization.slice(7);
      const { caller, privileged } = clients(authorization);
      const { data, error } = await caller.auth.getUser(token);
      if (
        error ||
        !data?.user ||
        data.user.is_anonymous ||
        !data.user.email_confirmed_at
      )
        throw new ApiError(
          401,
          "unauthorized",
          "Ingresá con una cuenta confirmada para continuar.",
        );
      const result = await dispatch(
        await bodyJson(request),
        caller,
        privileged,
        redirectBase,
      );
      return respond(200, { data: result });
    } catch (error) {
      if (error instanceof ApiError)
        return respond(error.status, {
          error: error.code,
          message: error.message,
        });
      return respond(503, {
        error: "backend_unavailable",
        message: "No se pudo completar la operación.",
      });
    }
  };
}
