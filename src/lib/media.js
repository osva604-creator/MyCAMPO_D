import { isNative, nativePosition } from './nativeLocation';

export function asDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
    reader.readAsDataURL(blob);
  });
}

export const PHOTO_PROFILES = {
  high: { maxSide: 2560, quality: 0.92 },
  balanced: { maxSide: 1600, quality: 0.84 },
};
export function photoFromSource(source, width, height, profile = 'high', aspectRatio = null) {
  if (!width || !height) throw new Error('Esperá a que la cámara esté lista.');
  const { maxSide, quality } = PHOTO_PROFILES[profile] || PHOTO_PROFILES.high;
  let cropWidth = width, cropHeight = height;
  if (Number.isFinite(aspectRatio) && aspectRatio > 0) {
    if (width / height > aspectRatio) cropWidth = height * aspectRatio;
    else cropHeight = width / aspectRatio;
  }
  const scale = Math.min(1, maxSide / Math.max(cropWidth, cropHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  let encoded = canvas.toDataURL('image/jpeg', quality);
  if (encoded.length > 12 * 1024 * 1024) encoded = canvas.toDataURL('image/jpeg', 0.8);
  canvas.width = 0; canvas.height = 0;
  return encoded;
}
export async function preparePhoto(file, profile = 'high', { aspectRatio = null } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Seleccioná un archivo de imagen.');
  if (file.size > 20 * 1024 * 1024) throw new Error('La foto supera 20 MB. Seleccioná una más pequeña.');
  const source = URL.createObjectURL(file);
  const image = new Image();
  image.src = source;
  try {
    try { await image.decode(); } catch { throw new Error('Formato no compatible. Usá una foto JPG, PNG o WebP.'); }
    return photoFromSource(image, image.naturalWidth || image.width, image.naturalHeight || image.height, profile, aspectRatio);
  } finally { URL.revokeObjectURL(source); }
}

export function locate({ timeout = 15000 } = {}) {
  if (isNative()) return nativePosition(timeout);
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este navegador no dispone de GPS. Indicá el lote manualmente.'));
    navigator.geolocation.getCurrentPosition(({ coords, timestamp }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy,
      timestamp: new Date(timestamp || Date.now()).toISOString() }),
      error => reject(new Error(error?.code === 1
        ? 'Permiso de ubicación denegado. Habilitá la ubicación del dispositivo y del navegador.'
        : 'No se pudo obtener una ubicación GPS. La foto se conserva; podés reintentar al aire libre o indicar el lugar manualmente.')),
      { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
}
