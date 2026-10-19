// Capacitor 7 writes Windows separators into generated Swift package paths.
const fs = require('node:fs');
const file = 'ios/App/CapApp-SPM/Package.swift';
if (fs.existsSync(file)) {
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace(/path: "([^"]+)"/g, (_, path) => `path: "${path.replaceAll('\\', '/')}"`));
}
