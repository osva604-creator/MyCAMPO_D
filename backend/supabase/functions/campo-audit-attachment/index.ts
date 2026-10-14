import { createAuditAttachmentHandler } from "../_shared/auditAttachment.js";
import { runtime, notConfigured } from "../_shared/runtime.ts";
const config = runtime();
Deno.serve(config ? createAuditAttachmentHandler(config) : notConfigured);
