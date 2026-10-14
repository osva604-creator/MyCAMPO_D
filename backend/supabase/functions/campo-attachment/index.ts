import { createAttachmentHandler } from "../_shared/attachment.js";
import { runtime, notConfigured } from "../_shared/runtime.ts";
const config = runtime();
Deno.serve(config ? createAttachmentHandler(config) : notConfigured);
