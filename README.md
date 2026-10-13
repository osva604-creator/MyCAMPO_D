# MyCAMPO_D

Base React + Vite + Tailwind CSS con iconos de lucide-react.

```sh
npm install
npm run dev
```

En Windows, si PowerShell bloquea `npm.ps1`, usar `npm.cmd install` y `npm.cmd run dev`.

`npm run build` genera `dist/`; `npm run preview` permite revisar ese build.

## Estructura

- `src/components/Navbar.jsx`: navegación y botón de cámara (`onCreatePost`).
- `src/components/PostCard.jsx`: publicación con estado, menciones, Me gusta, comentarios y compartir.
- `src/App.jsx`: tres ejemplos y creación de incidencias con fotos locales.

Los datos y las fotos nuevas viven en memoria y se pierden al recargar. Las fotos remotas de Unsplash son ilustrativas y requieren conexión. Los enlaces compartidos de publicaciones locales solo funcionan en la sesión que las creó. El avatar usa las iniciales del operario.

Esta entrega es la pantalla inicial del proyecto PWA: todavía no incluye manifest de instalación, service worker, almacenamiento offline, GPS ni backend. El selector de cámara depende del navegador y dispositivo; compartir y portapapeles requieren soporte del navegador y habitualmente HTTPS (o localhost).
