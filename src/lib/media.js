export function asDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
    reader.readAsDataURL(blob);
  });
}

export async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Seleccioná un archivo de imagen.');
  if (file.size > 20 * 1024 * 1024) throw new Error('La foto supera 20 MB. Seleccioná una más pequeña.');
  const source = await asDataUrl(file);
  const image = new Image();
  image.src = source;
  try { await image.decode(); } catch { throw new Error('Formato no compatible. Usá una foto JPG, PNG o WebP.'); }
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este navegador no dispone de GPS. Indicá el lote manualmente.'));
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      () => reject(new Error('No se pudo obtener GPS. Revisá los permisos o indicá el lote manualmente.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
