// Public deployment settings for the existing MyCAMPO_D installation.
// Environment variables can override these values for another deployment.
// Credentials always come from the managed function environment.
export const deployment = {
  appUrl: "https://mycampo-d.conteolab.workers.dev",
  allowedOrigins: "https://mycampo-d.conteolab.workers.dev,http://localhost:5173,https://localhost,capacitor://localhost",
};
