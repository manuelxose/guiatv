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
}

@Component({
  selector: 'app-live-map', standalone: true, imports: [CommonModule],
  template: `
    <div class="map-toolbar">
      <button type="button" (click)="toggleDemo()" [attr.aria-pressed]="demo">{{ demo ? 'Volver a datos reales' : 'Mostrar actividad de prueba' }}</button>
      <span *ngIf="demo" role="status">Actividad simulada: los puntos no representan visitantes reales.</span>
    </div>
    <div #container class="map-canvas" role="region" aria-label="Mapa interactivo de actividad. Usa el ratón, gestos táctiles o los controles de zoom."></div>
    <p class="map-legend">El tamaño del punto representa el número de sesiones, hasta un límite visual. Selecciona un punto para ver el valor exacto.</p>
    <p *ngIf="mapError" role="alert">No se ha podido cargar el mapa. Comprueba la conexión con OpenFreeMap.</p>
  `,
  styles: [`
    :host { display: block; position: relative; }
    .map-toolbar { position: absolute; z-index: 2; top: 1rem; left: 1rem; display: flex; align-items: center; flex-wrap: wrap; gap: .75rem; max-width: calc(100% - 6rem); color: var(--portal-text); font-size: .875rem; }
    .map-toolbar span { background: var(--portal-surface); padding: .5rem; border-radius: var(--radius-sm); }
    button { min-height: 44px; padding: .5rem .875rem; border: 1px solid var(--portal-border-strong); border-radius: var(--radius-md); background: var(--portal-surface); color: var(--portal-text); }
    button:focus-visible { outline: 2px solid var(--accent-streaming); outline-offset: 2px; }
    .map-legend { margin: .5rem 1rem; color: var(--portal-text-soft); font-size: .875rem; }
    :host ::ng-deep .activity-popup .maplibregl-popup-content { color: #202124; padding: 14px 32px 14px 16px; font-size: 14px; line-height: 1.5; }
    .map-canvas { height: 520px; width: 100%; overflow: hidden; }
    @media (max-width: 600px) { .map-canvas { height: 380px; } }
  `],
})
export class LiveMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() markers: LiveMapMarker[] = [];
  @ViewChild('container') container!: ElementRef<HTMLElement>;
  public demo = false;
  public mapError = false;
  private map?: MapLibreMap;
  private maplibre?: typeof import('maplibre-gl');
  private renderedMarkers: Marker[] = [];
  private destroyed = false;

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

  toggleDemo(): void {
    this.demo = !this.demo;
    this.renderMarkers();
  }

  private renderMarkers(): void {
    if (!this.map || !this.maplibre) return;
    this.renderedMarkers.forEach((marker) => marker.remove());
    const points = this.demo
      ? [{ label: 'Madrid', count: 400, lng: -3.7038, lat: 40.4168, precision: 'ip' }, { label: 'Barcelona', count: 20, lng: 2.1734, lat: 41.3851, precision: 'ip' }, { label: 'Ciudad de México', count: 3, lng: -99.1332, lat: 19.4326, precision: 'ip' }]
      : this.markers;
    this.renderedMarkers = points.map((point) => {
      const sessionWord = point.count === 1 ? 'sesión' : 'sesiones';
      const qualifier = this.demo ? (point.count === 1 ? 'simulada' : 'simuladas') : (point.count === 1 ? 'conectada mostrada' : 'conectadas mostradas');
      const label = `${point.label}: ${point.count} ${sessionWord} ${qualifier}${this.demo ? '' : ' (ubicación aproximada)'}`;
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute('aria-label', label);
      const size = Math.min(72, 12 + Math.sqrt(point.count) * 3);
      const hitSize = Math.max(44, size + 8);
      element.style.cssText = `width:${hitSize}px;height:${hitSize}px;padding:0;border:0;background:transparent;cursor:pointer;display:grid;place-items:center`;
      const dot = document.createElement('span');
      dot.style.cssText = `display:block;width:${size}px;height:${size}px;border:2px solid white;border-radius:50%;background:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.25)`;
      element.appendChild(dot);
      const detail = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = point.label;
      const count = document.createElement('div');
      count.textContent = `${point.count} ${sessionWord} ${qualifier}`;
      const note = document.createElement('div');
      note.textContent = this.demo ? 'Datos de prueba' : point.precision === 'ip' ? 'Ubicación aproximada según la IP, no es una posición exacta' : 'Centro aproximado del país; no indica la posición del visitante';
      detail.append(heading, count, note);
      const popup = new this.maplibre!.Popup({ offset: hitSize / 2, className: 'activity-popup' }).setDOMContent(detail);
      return new this.maplibre!.Marker({ element }).setLngLat([point.lng, point.lat]).setPopup(popup).addTo(this.map!);
    });
  }
}
