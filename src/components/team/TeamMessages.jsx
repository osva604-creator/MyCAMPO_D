import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { conversationMessages, platform } from "../../lib/teamApi";
import { supabase } from "../../lib/supabase";
import { preparePhoto, asDataUrl } from "../../lib/media";
import { useMutation } from "../../lib/useMutation";
import { useResource } from "../../lib/useResource";
import { Feedback, PageHeading, ResourceState, date } from "./Common";

export default function TeamMessages() {
  const { user, access, info, online, inbox } = useTeam();
  const [params, setParams] = useSearchParams();
  const cid = params.get("conversacion") || "";
  const current = useRef(cid);
  current.current = cid;
  const [search, setSearch] = useState(""),
    [body, setBody] = useState(""),
    [file, setFile] = useState(null),
    [page, setPage] = useState(0),
    [inboxCursor, setInboxCursor] = useState(null),
    [error, setError] = useState("");
  const pagedInbox = useResource(
    useCallback(
      () =>
        inboxCursor
          ? platform({
              action: "messages.inbox",
              before: inboxCursor.last_message_at,
              before_id: inboxCursor.id,
            })
          : Promise.resolve(null),
      [inboxCursor],
    ),
    { poll: 15000, events: ["messages", "message_reads"] },
  );
  const mutation = useMutation();
  const acknowledged = useRef("");
  const messages = useResource(
    useCallback(
      () =>
        cid
          ? conversationMessages(cid, page)
          : Promise.resolve({ messages: [], hasMore: false }),
      [cid, page],
    ),
    { poll: 15000, events: ["messages", "message_reads", "attachments"] },
  );
  const receipts = useResource(
    useCallback(
      () =>
        cid
          ? supabase
              .from("message_reads")
              .select("message_id,user_id")
              .eq("conversation_id", cid)
              .then(({ data, error }) => {
                if (error)
                  throw new Error("No se pudieron verificar las lecturas.");
                return data;
              })
          : Promise.resolve([]),
      [cid],
    ),
    { poll: 15000, events: ["message_reads"] },
  );
  useEffect(() => {
    setBody("");
    setFile(null);
    setPage(0);
    setError("");
    acknowledged.current = "";
  }, [cid]);
  useEffect(() => {
    const ids =
      messages.data?.messages
        .filter((m) => m.sender_id !== user.id)
        .map((m) => m.id) || [];
    const key = ids.sort().join(",");
    if (
      !online ||
      !ids.length ||
      key === acknowledged.current ||
      document.visibilityState === "hidden"
    )
      return;
    acknowledged.current = key;
    supabase
      .from("message_reads")
      .upsert(
        ids.map((message_id) => ({
          message_id,
          conversation_id: cid,
          user_id: user.id,
        })),
        { onConflict: "message_id,user_id", ignoreDuplicates: true },
      )
      .then(({ error }) => {
        if (error) {
          acknowledged.current = "";
          setError("No se pudo confirmar la lectura de los mensajes.");
        } else {
          inbox.reload();
          receipts.reload();
        }
      });
  }, [messages.data, user.id, cid, online]);
  const ownMembership = info.members.find((m) => m.user_id === user.id);
  const recipients = info.members.filter(
    (m) =>
      m.user_id !== user.id &&
      m.organization_id === ownMembership?.organization_id &&
      m.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const conversations =
    (inboxCursor
      ? pagedInbox.data?.conversations
      : inbox.data?.conversations) || [];
  const active = conversations.find((c) => c.id === cid);
  const person = (c) =>
    info.people.find(
      (p) => p.user_id === (c.user_a === user.id ? c.user_b : c.user_a),
    )?.name || "Integrante del equipo";
  async function open(recipient_id) {
    const result = await mutation.run("conversation.open", { recipient_id });
    if (result) {
      await inbox.reload();
      setParams({ conversacion: result.conversation_id });
      setSearch("");
    }
  }
  async function upload(event) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setError("");
    try {
      if (selected.size > 10485760) throw new Error("El archivo supera 10 MB.");
      const source =
        selected.type === "application/pdf"
          ? await asDataUrl(selected)
          : await preparePhoto(selected);
      setFile({ source, name: selected.name });
    } catch (failure) {
      setError(failure.message);
    }
  }
  async function send(event) {
    event.preventDefault();
    const selected = cid;
    const result = await mutation.run(
      "message.send",
      { conversation_id: cid, body: body.trim() },
      file?.source || null,
    );
    if (result && current.current === selected) {
      setBody("");
      setFile(null);
      setPage(0);
      await messages.reload();
      await inbox.reload();
    }
  }
  function more() {
    const last = conversations.at(-1);
    if (last) setInboxCursor(last);
  }
  return (
    <section>
      <PageHeading
        title="Mensajes"
        description="Conversaciones uno a uno dentro de tu organización."
      />
      {access.role === "SUPER_ADMIN" && ownMembership && (
        <p className="mb-4 text-sm text-green-800">
          Mensajería de tu membresía:{" "}
          {
            info.organizations.find(
              (o) => o.id === ownMembership.organization_id,
            )?.name
          }
          .
        </p>
      )}
      <p className="mb-5 rounded-xl border border-green-100 bg-green-50 p-4 text-sm leading-6 text-green-900">
        Solo los participantes pueden consultar la conversación. El propietario
        puede supervisar mensajes mediante un panel separado; cada consulta
        administrativa queda registrada con su motivo. Los mensajes no tienen
        cifrado de extremo a extremo.
      </p>
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="panel space-y-4">
          <h2 className="font-bold">Conversaciones</h2>
          <ResourceState resource={inboxCursor ? pagedInbox : inbox} />
          {inboxCursor && (
            <button
              className="btn-secondary"
              onClick={() => setInboxCursor(null)}
            >
              Volver al inicio
            </button>
          )}
          {ownMembership ? (
            <>
              <label className="form-label">
                Buscar una persona
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre del integrante"
                  className="form-input"
                />
              </label>
              {search && (
                <div className="space-y-1">
                  {recipients.map((m) => (
                    <button
                      key={m.id}
                      disabled={!online || mutation.busy}
                      className="block min-h-11 w-full rounded-xl bg-green-50 px-3 text-left text-sm"
                      onClick={() => open(m.user_id)}
                    >
                      {m.name}
                    </button>
                  ))}
                  {!recipients.length && (
                    <p className="text-sm text-stone-500">
                      No hay integrantes con ese nombre.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm leading-6 text-stone-500">
              Para iniciar conversaciones necesitás una membresía de
              organización.{" "}
              {access.role === "SUPER_ADMIN" && (
                <Link
                  className="text-green-800"
                  to="/dashboard/admin/auditoria"
                >
                  Abrir auditoría administrativa.
                </Link>
              )}
            </p>
          )}
          <div className="space-y-2">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setParams({ conversacion: c.id })}
                className={`block w-full rounded-xl p-3 text-left ${c.id === cid ? "bg-green-50 ring-1 ring-green-200" : "bg-stone-50"}`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                  {person(c)}
                  {Number(c.unread) > 0 && (
                    <span className="rounded-full bg-green-800 px-2 text-xs text-white">
                      {c.unread}
                    </span>
                  )}
                </span>
                <span className="mt-1 block truncate text-xs text-stone-500">
                  {c.preview || "Nueva conversación"}
                </span>
              </button>
            ))}
          </div>
          {conversations.length >= 50 && (
            <button
              disabled={pagedInbox.busy}
              onClick={more}
              className="btn-secondary w-full"
            >
              Más conversaciones
            </button>
          )}
        </aside>
        <div className="panel min-w-0">
          <h2 className="font-bold">
            {active
              ? person(active)
              : cid
                ? "Conversación seleccionada"
                : "Elegí una conversación"}
          </h2>
          <Feedback error={error || mutation.error} />
          {cid && (
            <>
              <ResourceState resource={messages} />
              <div
                aria-label="Conversación del equipo"
                aria-live="polite"
                className="my-4 flex min-h-64 max-h-[50dvh] flex-col gap-3 overflow-y-auto rounded-2xl bg-stone-50 p-3"
              >
                {[...(messages.data?.messages || [])]
                  .reverse()
                  .map((message) => {
                    const own = message.sender_id === user.id;
                    const read = receipts.data?.some(
                      (r) =>
                        r.message_id === message.id && r.user_id !== user.id,
                    );
                    return (
                      <div
                        key={message.id}
                        className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm ${own ? "self-end bg-green-800 text-white" : "self-start border border-stone-200 bg-white"}`}
                      >
                        <p>{message.body}</p>
                        {message.attachment &&
                          (message.attachment.ready &&
                          message.attachment.url ? (
                            message.attachment.mime_type ===
                            "application/pdf" ? (
                              <a
                                href={message.attachment.url}
                                download="mensaje.pdf"
                                className="mt-2 block min-h-11 underline"
                              >
                                Descargar PDF
                              </a>
                            ) : (
                              <img
                                src={message.attachment.url}
                                alt="Adjunto del mensaje"
                                className="mt-2 max-h-60 rounded-xl"
                              />
                            )
                          ) : (
                            <p className="mt-2 text-xs">
                              Adjunto pendiente de subir
                            </p>
                          ))}
                        <p className="mt-2 text-[10px] opacity-70">
                          <time dateTime={message.created_at}>
                            {date(message.created_at)}
                          </time>
                          {own && ` · ${read ? "Leído" : "Enviado"}`}
                        </p>
                      </div>
                    );
                  })}
                {messages.data && !messages.data.messages.length && (
                  <p className="text-sm text-stone-500">
                    Todavía no hay mensajes. Iniciá la conversación.
                  </p>
                )}
              </div>
              <div className="mb-4 flex gap-2">
                <button
                  className="btn-secondary"
                  disabled={!messages.data?.hasMore || messages.busy}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Mensajes anteriores
                </button>
                {page > 0 && (
                  <button
                    className="btn-secondary"
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Más recientes
                  </button>
                )}
              </div>
              <form onSubmit={send} className="space-y-3">
                <label className="sr-only" htmlFor="team-message">
                  Mensaje
                </label>
                <textarea
                  id="team-message"
                  maxLength={4000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={2}
                  placeholder="Escribí un mensaje…"
                  className="form-input"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="text-xs text-stone-500">
                    Adjuntar foto o PDF
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      disabled={!online || mutation.busy}
                      onChange={upload}
                      className="mt-1 block max-w-full text-xs"
                    />
                  </label>
                  <button
                    disabled={
                      !online ||
                      !messages.data ||
                      mutation.busy ||
                      (!body.trim() && !file)
                    }
                    className="btn-primary"
                  >
                    {mutation.busy ? "Enviando…" : "Enviar mensaje"}
                  </button>
                </div>
                {file && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-stone-50 p-3 text-sm">
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      className="min-h-11 text-green-800"
                    >
                      Quitar
                    </button>
                  </div>
                )}
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
