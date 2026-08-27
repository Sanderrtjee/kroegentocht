import L from 'leaflet';
import 'leaflet.markercluster';
import type {
  Bounds,
  DraggableMarkerHandle,
  HeatPoint,
  LatLon,
  LayerId,
  MapAdapter,
  MapAdapterOptions,
  MapPoint,
} from './MapAdapter.js';

/**
 * Leaflet-implementatie van MapAdapter.
 *
 * Dit is het enige bestand dat leaflet importeert. Alles wat Leaflet-specifiek
 * is zit hier: de tegellaag, de clustering, de iconen en de popups.
 *
 * De heatmaplaag is met opzet geen losse plugin. leaflet.heat is klein maar niet
 * onderhouden, en de laag hoeft alleen dichtheid te tonen: dat lukt met cirkels
 * op een canvas-renderer, met een radius en dekking naar gewicht. Een
 * afhankelijkheid minder is er ook een minder om in de gaten te houden.
 */

const MARKER_SIZE = 30;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markerIcon(kind: 'mine' | 'public', badge: string | undefined): L.DivIcon {
  const label = badge ? `<span>${escapeHtml(badge)}</span>` : '<span></span>';
  return L.divIcon({
    className: '',
    html: `<div class="kt-marker kt-marker-${kind}" style="width:${MARKER_SIZE}px;height:${MARKER_SIZE}px">${label}</div>`,
    iconSize: [MARKER_SIZE, MARKER_SIZE],
    iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
    popupAnchor: [0, -MARKER_SIZE / 2],
  });
}

function clusterIcon(kind: 'mine' | 'public') {
  return (cluster: L.MarkerCluster): L.DivIcon => {
    const count = cluster.getChildCount();
    const size = count < 10 ? 34 : count < 100 ? 42 : 50;
    return L.divIcon({
      className: '',
      html: `<div class="kt-cluster ${kind === 'public' ? 'kt-cluster-public' : ''}" style="width:${size}px;height:${size}px">${count}</div>`,
      iconSize: [size, size],
    });
  };
}

export class LeafletAdapter implements MapAdapter {
  private map: L.Map | null = null;
  private clusters: Record<'mine' | 'public', L.MarkerClusterGroup | null> = {
    mine: null,
    public: null,
  };
  private heatLayer: L.LayerGroup | null = null;
  private heatRenderer: L.Canvas | null = null;
  private visible: Record<LayerId, boolean> = { mine: true, public: true, heat: false };
  private pendingHeat: readonly HeatPoint[] = [];

  mount(element: HTMLElement, options: MapAdapterOptions): void {
    if (this.map) this.destroy();

    const map = L.map(element, {
      center: [options.center.lat, options.center.lon],
      zoom: options.zoom,
      minZoom: options.minZoom,
      maxZoom: options.maxZoom,
      zoomControl: true,
      // Canvas in plaats van svg: op een telefoon met een paar honderd punten
      // scheelt dat merkbaar in het scrollen.
      preferCanvas: true,
      worldCopyJump: false,
    });

    L.tileLayer(options.tileUrlTemplate, {
      minZoom: options.minZoom,
      maxZoom: options.maxZoom,
      // De attributie hoort in beeld te staan; dit is een voorwaarde van de
      // licentie op de kaartdata van OpenStreetMap.
      attribution: options.attribution,
      crossOrigin: false,
      // De tiles komen van onze eigen proxy, die zelf cachet.
      updateWhenIdle: true,
      keepBuffer: 2,
    }).addTo(map);

    this.clusters.mine = L.markerClusterGroup({
      iconCreateFunction: clusterIcon('mine'),
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 18,
      maxClusterRadius: 45,
    });
    this.clusters.public = L.markerClusterGroup({
      iconCreateFunction: clusterIcon('public'),
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 18,
      maxClusterRadius: 55,
    });

    this.heatRenderer = L.canvas({ padding: 0.3 });
    this.heatLayer = L.layerGroup();

    if (this.visible.mine) this.clusters.mine.addTo(map);
    if (this.visible.public) this.clusters.public.addTo(map);
    if (this.visible.heat) this.heatLayer.addTo(map);

    if (options.onViewportChange) {
      const emit = () => {
        const bounds = map.getBounds();
        options.onViewportChange?.(
          {
            minLat: bounds.getSouth(),
            minLon: bounds.getWest(),
            maxLat: bounds.getNorth(),
            maxLon: bounds.getEast(),
          },
          map.getZoom(),
        );
      };
      map.on('moveend', emit);
      map.on('zoomend', emit);
      // Eerste keer meteen, zodat de aanroeper niet op een beweging hoeft te wachten.
      map.whenReady(emit);
    }

    if (options.onMapClick) {
      map.on('click', (event: L.LeafletMouseEvent) => {
        options.onMapClick?.({ lat: event.latlng.lat, lon: event.latlng.lng });
      });
    }

    this.map = map;
    if (this.pendingHeat.length > 0) this.setHeatPoints(this.pendingHeat);
  }

  destroy(): void {
    this.map?.remove();
    this.map = null;
    this.clusters = { mine: null, public: null };
    this.heatLayer = null;
    this.heatRenderer = null;
  }

  setPoints(layer: 'mine' | 'public', points: readonly MapPoint[]): void {
    const group = this.clusters[layer];
    if (!group) return;

    group.clearLayers();
    const markers: L.Marker[] = [];

    for (const point of points) {
      const marker = L.marker([point.lat, point.lon], {
        icon: markerIcon(layer, point.badge),
        keyboard: true,
        title: point.title,
        alt: point.title,
      });

      const container = L.DomUtil.create('div');
      const heading = L.DomUtil.create('div', '', container);
      heading.style.fontWeight = '600';
      heading.style.marginBottom = '0.25rem';
      heading.textContent = point.title;

      for (const line of point.lines) {
        const row = L.DomUtil.create('div', '', container);
        row.style.fontSize = '0.8rem';
        row.textContent = line;
      }

      if (point.onSelect) {
        const button = L.DomUtil.create('button', '', container);
        button.type = 'button';
        button.textContent = point.selectLabel ?? 'Bekijken';
        button.style.marginTop = '0.5rem';
        button.style.textDecoration = 'underline';
        button.style.cursor = 'pointer';
        button.style.color = 'var(--color-bier-400)';
        L.DomEvent.on(button, 'click', (event) => {
          L.DomEvent.stop(event);
          point.onSelect?.();
        });
      }

      marker.bindPopup(container, { closeButton: true, autoPan: true });
      markers.push(marker);
    }

    group.addLayers(markers);
  }

  setHeatPoints(points: readonly HeatPoint[]): void {
    this.pendingHeat = points;
    if (!this.heatLayer || !this.heatRenderer) return;

    this.heatLayer.clearLayers();
    const maxWeight = points.reduce((max, p) => Math.max(max, p.weight), 1);

    for (const point of points) {
      const relative = point.weight / maxWeight;
      L.circleMarker([point.lat, point.lon], {
        renderer: this.heatRenderer,
        radius: 14 + relative * 26,
        stroke: false,
        fillColor: relative > 0.66 ? '#f0653f' : relative > 0.33 ? '#e8a33d' : '#3f7fa8',
        fillOpacity: 0.18 + relative * 0.32,
        interactive: false,
      }).addTo(this.heatLayer);
    }
  }

  setLayerVisible(layer: LayerId, visible: boolean): void {
    this.visible[layer] = visible;
    if (!this.map) return;

    const target =
      layer === 'heat' ? this.heatLayer : layer === 'mine' ? this.clusters.mine : this.clusters.public;
    if (!target) return;

    if (visible) {
      if (!this.map.hasLayer(target)) target.addTo(this.map);
    } else if (this.map.hasLayer(target)) {
      this.map.removeLayer(target);
    }
  }

  isLayerVisible(layer: LayerId): boolean {
    return this.visible[layer];
  }

  flyTo(position: LatLon, zoom?: number): void {
    this.map?.flyTo([position.lat, position.lon], zoom ?? this.map.getZoom(), {
      duration: 0.6,
    });
  }

  getBounds(): Bounds | null {
    if (!this.map) return null;
    const bounds = this.map.getBounds();
    return {
      minLat: bounds.getSouth(),
      minLon: bounds.getWest(),
      maxLat: bounds.getNorth(),
      maxLon: bounds.getEast(),
    };
  }

  getZoom(): number | null {
    return this.map?.getZoom() ?? null;
  }

  invalidateSize(): void {
    this.map?.invalidateSize();
  }

  addDraggableMarker(
    position: LatLon,
    onMove: (position: LatLon) => void,
  ): DraggableMarkerHandle {
    if (!this.map) throw new Error('Kaart is nog niet gemonteerd.');

    const marker = L.marker([position.lat, position.lon], {
      draggable: true,
      autoPan: true,
      icon: markerIcon('mine', '•'),
    }).addTo(this.map);

    marker.on('dragend', () => {
      const latLng = marker.getLatLng();
      onMove({ lat: latLng.lat, lon: latLng.lng });
    });

    return {
      setPosition(next) {
        marker.setLatLng([next.lat, next.lon]);
      },
      getPosition() {
        const latLng = marker.getLatLng();
        return { lat: latLng.lat, lon: latLng.lng };
      },
      remove: () => {
        marker.remove();
      },
    };
  }
}

/**
 * Enige plek waar een concrete implementatie wordt gekozen. Bij een overstap
 * naar MapLibre verandert alleen deze regel.
 */
export function createMapAdapter(): MapAdapter {
  return new LeafletAdapter();
}
