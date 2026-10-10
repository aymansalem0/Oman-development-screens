/**
 * Leaflet 1.x ships native ESM at this distribution path. Keep Angular's
 * imports on that ESM entry while taking type declarations from @types/leaflet.
 */
declare module 'leaflet/dist/leaflet-src.esm.js' {
  export * from 'leaflet';
}
