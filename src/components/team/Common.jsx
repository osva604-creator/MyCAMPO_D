import { Link } from "react-router-dom";

export const roleName = {
  SUPER_ADMIN: "Superadministrador",
  GERENTE_GENERAL: "Gerente general",
  GERENTE: "Gerente",
  ENCARGADO: "Encargado",
  USUARIO: "Usuario",
};
export const date = (value) =>
  value ? new Date(value).toLocaleString("es-AR") : "Sin fecha";
export function Feedback({ busy, error, notice }) {
  return (
    <>
      {busy && (
        <p role="status" className="text-sm text-stone-500">
          Guardando…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-green-800">
          {notice}
        </p>
      )}
    </>
  );
}
export function ResourceState({ resource, empty }) {
  return (
    <>
      {resource.busy && !resource.data && (
        <p role="status" className="p-5 text-sm text-stone-500">
          Cargando…
        </p>
      )}
      {resource.error && (
        <div
          role="alert"
          className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p>{resource.error}</p>
          <button
            onClick={resource.reload}
            className="mt-2 min-h-11 font-semibold"
          >
            Reintentar
          </button>
        </div>
      )}
      {!resource.busy && !resource.error && empty && (
        <p className="rounded-2xl bg-white p-6 text-sm text-stone-500">
          Todavía no hay registros para mostrar.
        </p>
      )}
    </>
  );
}
export function PageHeading({ eyebrow, title, description, children }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
          {eyebrow || "Tu equipo"}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
            {description}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}
export function LocalLink() {
  return (
    <Link to="/local" className="min-h-11 text-sm font-semibold text-green-800">
      Abrir modo local
    </Link>
  );
}
export function TeamSelect({
  teams,
  value,
  onChange,
  label = "Equipo",
  required = true,
}) {
  return (
    <label className="form-label">
      {label}
      <select
        required={required}
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Seleccionar equipo</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function RoleFields({
  organizations,
  teams,
  org,
  setOrg,
  role,
  setRole,
  selected,
  setSelected,
}) {
  return (
    <>
      <label className="form-label">
        Organización
        <select
          required
          className="form-input"
          value={org}
          onChange={(e) => {
            setOrg(e.target.value);
            setSelected([]);
          }}
        >
          <option value="">Seleccionar organización</option>
          {organizations
            .filter((o) => o.active !== false)
            .map((o) => (
              <option value={o.id} key={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </label>
      <label className="form-label">
        Rol
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setSelected([]);
          }}
          className="form-input"
        >
          {["GERENTE_GENERAL", "GERENTE", "ENCARGADO", "USUARIO"].map((r) => (
            <option key={r} value={r}>
              {roleName[r]}
            </option>
          ))}
        </select>
      </label>
      {!["GERENTE", "GERENTE_GENERAL"].includes(role) && (
        <fieldset className="rounded-xl border p-3">
          <legend className="px-1 text-sm font-semibold">
            {role === "USUARIO" ? "Un equipo activo" : "Equipos que supervisa"}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {teams
              .filter((t) => t.organization_id === org && t.active !== false)
              .map((t) => (
                <label
                  key={t.id}
                  className="flex min-h-11 items-center gap-2 text-sm"
                >
                  <input
                    type={role === "USUARIO" ? "radio" : "checkbox"}
                    name="role-team"
                    checked={selected.includes(t.id)}
                    onChange={(e) =>
                      setSelected(
                        role === "USUARIO"
                          ? [t.id]
                          : e.target.checked
                            ? [...selected, t.id]
                            : selected.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.name}
                </label>
              ))}
          </div>
          {!teams.some(
            (t) => t.organization_id === org && t.active !== false,
          ) && (
            <p className="py-2 text-xs text-stone-500">
              {org
                ? "La organización no tiene equipos activos."
                : "Seleccioná una organización para ver sus equipos."}
            </p>
          )}
        </fieldset>
      )}
    </>
  );
}
