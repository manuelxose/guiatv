import { CommonModule, isPlatformBrowser } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Inject, Input, OnChanges, OnDestroy, PLATFORM_ID, ViewChild } from '@angular/core';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';

export interface LiveMapMarker {
  key: string;
  label: string;
  count: number;
  lng: number;
  lat: number;
  precision: 'ip' | 'country';
  /** GeoIP accuracy radius (km) when every session of the point reported the same one. */
  radiusKm?: number;
}

/** Marker diameter in px: grows with the square root of the sessions (area ∝ count), capped. */
export function markerSize(count: number): number {
  return Math.round(Math.min(64, 12 + Math.sqrt(Math.max(1, count)) * 4));
}

/** Text of a point, shared by its accessible label and its popup. */
export function markerText(point: LiveMapMarker): { title: string; count: string; note: string; aria: string } {
  const count = `${point.count} ${point.count === 1 ? 'sesión conectada' : 'sesiones conectadas'}`;
  const note = point.precision === 'ip'
    ? `Ubicación aproximada según la IP${point.radiusKm ? ` (±${point.radiusKm} km)` : ''}; no es la posición del visitante`
    : 'Solo se conoce el país: el punto marca su centro, no la posición del visitante';
  return { title: point.label, count, note, aria: `${point.label}: ${count}. ${note}` };
}

/** [[west, south], [east, north]] around the points, or null with none. */
export function markerBounds(points: LiveMapMarker[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

@Component({
  selector: 'app-live-map', standalone: true, imports: [CommonModule],
  template: `
    <div #container class="map-canvas" role="region" aria-label="Mapa interactivo de las sesiones conectadas. Usa el ratón, gestos táctiles o los controles de zoom; cada punto es un botón con su detalle."></div>
    <div class="map-overlay">
      <div class="map-legend">
        <span><i class="map-legend__dot map-legend__dot--ip" aria-hidden="true"></i>Ciudad aproximada (IP)</span>
        <span><i class="map-legend__dot map-legend__dot--country" aria-hidden="true"></i>Solo país (centro)</span>
        <span>Tamaño = sesiones; pulsa un punto para el detalle.</span>
      </div>
      <p *ngIf="!markers.length && !mapError" class="map-empty" role="status">Ninguna sesión conectada tiene ubicación en este momento.</p>
      <p *ngIf="mapError" role="alert" class="map-error">No se ha podido cargar el mapa base (OpenFreeMap). Las tablas siguen mostrando las ubicaciones.</p>
    </div>
  `,
  styles: [`
    :host { display: block; position: relative; }
    .map-canvas { height: 520px; width: 100%; overflow: hidden; }
    .map-empty, .map-error { margin: 0; padding: .45rem .7rem; border-radius: var(--radius-sm); background: var(--portal-surface); color: var(--portal-text); font-size: .8125rem; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
    /* Legend and messages sit on the map's top-left corner: the activity card covers its bottom-left. */
    .map-overlay { position: absolute; z-index: 2; top: .75rem; left: .75rem; max-width: min(28rem, calc(100% - 5rem)); display: grid; gap: .4rem; }
    .map-legend { display: flex; flex-wrap: wrap; gap: .35rem 1rem; padding: .45rem .7rem; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--portal-surface) 92%, transparent); color: var(--portal-text-soft); font-size: .78rem; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
    .map-legend span { display: inline-flex; align-items: center; gap: .4rem; }
    .map-legend__dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.2); }
    .map-legend__dot--ip { background: #2563eb; }
    .map-legend__dot--country { background: #94a3b8; }
    :host ::ng-deep .activity-popup .maplibregl-popup-content { color: #202124; padding: 14px 32px 14px 16px; font-size: 14px; line-height: 1.5; max-width: 260px; }
    @media (max-width: 600px) { .map-canvas { height: 380px; } }
  `],
})
export class LiveMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() markers: LiveMapMarker[] = [];
  @ViewChild('container') container!: ElementRef<HTMLElement>;
  public mapError = false;
  private map?: MapLibreMap;
  private maplibre?: typeof import('maplibre-gl');
  private renderedMarkers: Marker[] = [];
  private destroyed = false;
  /** Key set of the last fitted view: the map only re-frames when the set of places changes, not on every poll. */
  private framedKeys = '';

  constructor(@Inject(PLATFORM_ID) private platformId: object) {}

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const maplibre = await import('maplibre-gl');
      if (this.destroyed) return;
      this.maplibre = maplibre;
      maplibre.setWorkerUrl(new URL('assets/maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
      this.map = new maplibre.Map({ container: this.container.nativeElement, style: 'https://tiles.openfreemap.org/styles/positron', center: [-3.7, 40.4], zoom: 3.6, renderWorldCopies: false });
      this.map.addControl(new maplibre.NavigationControl(), 'top-right');
      this.map.addControl(new maplibre.FullscreenControl(), 'top-right');
      this.map.on('error', () => { if (!this.map?.isStyleLoaded()) this.mapError = true; });
      this.map.on('load', () => {
        this.mapError = false;
        for (const layer of this.map!.getStyle().layers) {
          if (layer.type === 'symbol' && layer.source === 'openmaptiles' && layer['source-layer'] === 'place') {
            this.map!.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:es'], ['get', 'name:latin'], ['get', 'name']]);
          }
        }
        this.renderMarkers();
      });
    } catch {
      this.mapError = true;
    }
  }

  ngOnChanges(): void { this.renderMarkers(); }
  ngOnDestroy(): void { this.destroyed = true; this.map?.remove(); }

  private renderMarkers(): void {
    if (!this.map || !this.maplibre) return;
    this.renderedMarkers.forEach((marker) => marker.remove());
    // Larger points first so smaller ones stay clickable on top.
    const points = [...this.markers].sort((a, b) => b.count - a.count);
    this.renderedMarkers = points.map((point) => {
      const text = markerText(point);
      const size = markerSize(point.count);
      const hitSize = Math.max(44, size + 8);
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute('aria-label', text.aria);
      element.style.cssText = `width:${hitSize}px;height:${hitSize}px;padding:0;border:0;background:transparent;cursor:pointer;display:grid;place-items:center`;
      const dot = document.createElement('span');
      const ip = point.precision === 'ip';
      dot.style.cssText = `display:block;width:${size}px;height:${size}px;border:2px ${ip ? 'solid' : 'dashed'} white;border-radius:50%;background:${ip ? '#2563eb' : '#94a3b8'};opacity:${ip ? 0.9 : 0.75};box-shadow:0 0 0 4px ${ip ? 'rgba(37,99,235,.25)' : 'rgba(100,116,139,.25)'}`;
      element.appendChild(dot);
      const detail = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = text.title;
      const count = document.createElement('div');
      count.textContent = text.count;
      const note = document.createElement('div');
      note.textContent = text.note;
      detail.append(heading, count, note);
      const popup = new this.maplibre!.Popup({ offset: hitSize / 2, className: 'activity-popup' }).setDOMContent(detail);
      return new this.maplibre!.Marker({ element }).setLngLat([point.lng, point.lat]).setPopup(popup).addTo(this.map!);
    });
    this.frame(points);
  }

  /** Centres the view on the places with sessions (once per change of places, so polling never fights the user). */
  private frame(points: LiveMapMarker[]): void {
    const keys = points.map((point) => point.key).sort().join('|');
    if (!points.length || keys === this.framedKeys || typeof this.map?.fitBounds !== 'function') return;
    this.framedKeys = keys;
    const bounds = markerBounds(points)!;
    const single = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1];
    if (single) this.map.easeTo({ center: [points[0].lng, points[0].lat], zoom: points[0].precision === 'ip' ? 5.5 : 4, duration: 0 });
    else this.map.fitBounds(bounds, { padding: 64, maxZoom: 6, duration: 0 });
  }
}
