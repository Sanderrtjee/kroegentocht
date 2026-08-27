/**
 * Kaartabstractie.
 *
 * De rest van de frontend kent alleen deze interface. Leaflet met rastertiles
 * zit erachter (LeafletAdapter). De bedoeling is dat een overstap naar MapLibre
 * met vectortiles later een nieuwe implementatie van dit bestand is en niets
 * anders: geen enkel component importeert leaflet direct.
 *
 * Daarom staat er in deze interface ook geen enkel Leaflet-begrip. Geen LatLng,
 * geen Layer, geen Icon; alleen gewone getallen en objecten.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Bounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export type LayerId = 'mine' | 'public' | 'heat';

/** Een punt op de kaart, los van waar het vandaan komt. */
export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  /** Korte tekst in de marker zelf, bijvoorbeeld het aantal bezoeken. */
  badge?: string;
  /** HTML-vrije regels voor de popup. */
  title: string;
  lines: string[];
  /** Wordt aangeroepen als de gebruiker op "meer" klikt in de popup. */
  onSelect?: () => void;
  selectLabel?: string;
}

export interface HeatPoint {
  lat: number;
  lon: number;
  weight: number;
}

export interface MapAdapterOptions {
  center: LatLon;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  /** URL-patroon met {z}, {x} en {y}. Wijst naar de eigen cachende proxy. */
  tileUrlTemplate: string;
  attribution: string;
  onViewportChange?: (bounds: Bounds, zoom: number) => void;
  onMapClick?: (position: LatLon) => void;
}

export interface DraggableMarkerHandle {
  setPosition(position: LatLon): void;
  getPosition(): LatLon;
  remove(): void;
}

export interface MapAdapter {
  mount(element: HTMLElement, options: MapAdapterOptions): void;
  destroy(): void;

  setPoints(layer: 'mine' | 'public', points: readonly MapPoint[]): void;
  setHeatPoints(points: readonly HeatPoint[]): void;
  setLayerVisible(layer: LayerId, visible: boolean): void;
  isLayerVisible(layer: LayerId): boolean;

  flyTo(position: LatLon, zoom?: number): void;
  getBounds(): Bounds | null;
  getZoom(): number | null;
  /** Herberekent de afmetingen, nodig na het openen van een paneel ernaast. */
  invalidateSize(): void;

  addDraggableMarker(
    position: LatLon,
    onMove: (position: LatLon) => void,
  ): DraggableMarkerHandle;
}
