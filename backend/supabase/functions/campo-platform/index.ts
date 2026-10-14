import { createHandler } from "../_shared/platform.js";
import { runtime, notConfigured } from "../_shared/runtime.ts";
const config = runtime();
Deno.serve(config ? createHandler(config) : notConfigured);
