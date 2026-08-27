import { useEffect, useRef } from 'react';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, OSM_ATTRIBUTION } from '@kroegentocht/shared';
import { createMapAdapter } from './LeafletAdapter.js';
import type { Bounds, LatLon, MapAdapter } from './MapAdapter.js';

/**
 * React-omhulsel om de kaartabstractie.
 *
 * De kaart beheert zijn eigen DOM, dus React mag er niet in tekenen. Dit
 * component doet niets anders dan een div aanbieden, de adapter monteren en hem
 * bij het opruimen weer afbreken. Alle interactie loopt via de adapter die aan
 * onReady wordt doorgegeven.
 */
export interface MapCanvasProps {
  center: LatLon;
  zoom: number;
  className?: string;
  onReady: (adapter: MapAdapter) => void;
  onViewportChange?: (bounds: Bounds, zoom: number) => void;
  onMapClick?: (position: LatLon) => void;
}

export function MapCanvas({
  center,
  zoom,
  className,
  onReady,
  onViewportChange,
  onMapClick,
}: MapCanvasProps) {
  const holder = useRef<HTMLDivElement | null>(null);

  // De callbacks in refs, zodat een nieuwe functie-identiteit bij het opnieuw
  // renderen de kaart niet opnieuw opbouwt.
  const onReadyRef = useRef(onReady);
  const onViewportRef = useRef(onViewportChange);
  const onClickRef = useRef(onMapClick);
  onReadyRef.current = onReady;
  onViewportRef.current = onViewportChange;
  onClickRef.current = onMapClick;

  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    const adapter = createMapAdapter();
    adapter.mount(element, {
      center,
      zoom,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      // Eigen cachende proxy, niet direct tile.openstreetmap.org.
      tileUrlTemplate: '/tiles/{z}/{x}/{y}.png',
      attribution: OSM_ATTRIBUTION,
      onViewportChange: (bounds, currentZoom) => onViewportRef.current?.(bounds, currentZoom),
      onMapClick: (position) => onClickRef.current?.(position),
    });
    onReadyRef.current(adapter);

    return () => adapter.destroy();
    // Alleen bij het monteren; latere wijzigingen van center of zoom gaan via
    // adapter.flyTo, niet door de kaart opnieuw op te bouwen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={holder} className={className} />;
}
