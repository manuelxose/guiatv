import { LiveMapComponent } from './live-map.component';

describe('LiveMapComponent activity markers', () => {
  it('shows a larger point for more sessions and provides a labelled detail', () => {
    const elements: HTMLElement[] = [];
    const details: HTMLElement[] = [];
    const coordinates: number[][] = [];
    class PopupDouble {
      setDOMContent(content: HTMLElement): this { details.push(content); return this; }
    }
    class MarkerDouble {
      constructor(options: { element: HTMLElement }) { elements.push(options.element); }
      setLngLat(value: number[]): this { coordinates.push(value); return this; }
      setPopup(): this { return this; }
      addTo(): this { return this; }
      remove(): void {}
    }
    const component = new LiveMapComponent({});
    (component as any).map = {};
    (component as any).maplibre = { Popup: PopupDouble, Marker: MarkerDouble };

    component.toggleDemo();

    const madridSize = parseFloat(elements[0].firstElementChild!.getAttribute('style')!.match(/width: ([\d.]+)/)![1]);
    const barcelonaSize = parseFloat(elements[1].firstElementChild!.getAttribute('style')!.match(/width: ([\d.]+)/)![1]);
    expect(madridSize).toBeGreaterThan(barcelonaSize * 2);
    expect(elements[0].getAttribute('aria-label')).toContain('Madrid: 400 sesiones simuladas');
    expect(details[0].textContent).toContain('Madrid');
    expect(details[0].textContent).toContain('400 sesiones simuladas');
    expect(details[0].textContent).toContain('Datos de prueba');
    component.markers = [{ key: 'madrid', label: 'Madrid, MD, ES', count: 2, lng: -3.7, lat: 40.4, precision: 'ip' }];
    component.toggleDemo();
    expect(coordinates[3]).toEqual([-3.7, 40.4]);
    expect(details[3].textContent).toContain('Ubicación aproximada según la IP');
    expect(details[3].textContent).toContain('Madrid, MD, ES');
  });
});
