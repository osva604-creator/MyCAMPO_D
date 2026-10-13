export const initialPosts = [
  {
    id: 'molino', author: { name: 'Juan Pérez' }, location: 'Lote Norte · Molino 3',
    image: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85',
    imageAlt: 'Paisaje rural de referencia para la incidencia del molino',
    caption: 'El molino dejó de bombear esta mañana. Se observa una rotura en la transmisión. @Carlos revisar el mecanismo antes de mover la hacienda al lote.',
    status: 'Pendiente', category: 'Infraestructura', likes: 12, createdAt: '2026-10-13T09:20:00-03:00', timeLabel: '13 oct · 09:20',
    comments: [{ id: 'm1', author: 'Carlos Díaz', text: 'Recibido, voy con herramientas después de la recorrida.' }],
  },
  {
    id: 'bebedero', author: { name: 'Lucía Fernández' }, location: 'Potrero 7 · -34.61, -60.92',
    image: 'https://images.unsplash.com/photo-1516467508483-a7212febe31a?auto=format&fit=crop&w=1200&q=85',
    imageAlt: 'Ganado en el campo, imagen de referencia del potrero',
    caption: 'Bebedero sin agua en el potrero 7. Ya cerramos la llave para revisar la pérdida. @Martin está reemplazando el flotante; verificar el nivel al finalizar.',
    status: 'En Proceso', category: 'Agua y hacienda', likes: 8, createdAt: '2026-10-13T08:10:00-03:00', timeLabel: '13 oct · 08:10',
    comments: [{ id: 'b1', author: 'Martín López', text: 'Flotante nuevo instalado. Estoy comprobando que vuelva a llenar.' }, { id: 'b2', author: 'Lucía Fernández', text: 'Gracias @Martin, aviso al equipo.' }],
  },
  {
    id: 'soja', author: { name: 'Diego Ramírez' }, location: 'Lote 12 · Soja',
    image: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=1200&q=85',
    imageAlt: 'Cultivo agrícola, imagen de referencia para el lote de soja',
    caption: 'Seguimiento del foco de plaga detectado en la cabecera del lote. @Ana completó la evaluación y confirmó el cierre de la incidencia. Continuamos con el monitoreo habitual.',
    status: 'Resuelto', category: 'Sanidad vegetal', likes: 21, createdAt: '2026-10-12T17:45:00-03:00', timeLabel: '12 oct · 17:45',
    comments: [{ id: 's1', author: 'Ana Torres', text: 'Recorrida finalizada y registro actualizado. Seguimos atentos a la evolución.' }],
  },
];

