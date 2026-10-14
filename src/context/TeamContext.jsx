import { createContext, useContext } from "react";
export const TeamContext = createContext(null);
export const useTeam = () => useContext(TeamContext);
export const canManage = (access, org, team) =>
  access.role === "SUPER_ADMIN" ||
  (access.organization_id === org &&
    (access.role === "GERENTE" ||
      (access.role === "ENCARGADO" &&
        access.teams.some((t) => t.id === team))));
