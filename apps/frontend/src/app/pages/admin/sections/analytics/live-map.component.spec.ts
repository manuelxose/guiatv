import { LiveMapComponent, LiveMapMarker, markerBounds, markerSize, markerText } from './live-map.component';

describe('LiveMapComponent activity markers', () => {
  const madrid: LiveMapMarker = { key: 'madrid', label: 'Madrid, Comunidad de Madrid, España', count: 9, lng: -3.7, lat: 40.4, precision: 'ip', radiusKm: 10 };
  const mexico: LiveMapMarker = { key: 'mx', label: 'México', count: 1, lng: -102, lat: 23, precision: 'country' };

  function render(markers: LiveMapMarker[]) {
    const elements: HTMLElement[] = [];
    const details: HTMLElement[] = [];
    const coordinates: number[][] = [];
    const fits: unknown[] = [];
    class PopupDouble { setDOMContent(content: HTMLElement): this { details.push(content); return this; } }
    class MarkerDouble {
      constructor(options: { element: HTMLElement }) { elements.push(options.element); }
      setLngLat(value: number[]): this { coordinates.push(value); return this; }
      setPopup(): this { return this; }
      addTo(): this { return this; }
      remove(): void {}
    }
    const component = new LiveMapComponent({});
    (component as any).map = { fitBounds: (b: unknown) => fits.push(b), easeTo: (o: unknown) => fits.push(o) };
    (component as any).maplibre = { Popup: PopupDouble, Marker: MarkerDouble };
    component.markers = markers;
    component.ngOnChanges();
    return { component, elements, details, coordinates, fits };
  }

  it('draws only real sessions: no simulated data, larger points for more sessions, precise vs country-only', () => {
    const { elements, details, coordinates, fits } = render([mexico, madrid]);
    expect(elements.length).toBe(2);
    expect(coordinates[0]).toEqual([-3.7, 40.4]); // larger first
    expect(elements[0].getAttribute('aria-label')).toContain('9 sesiones conectadas');
    expect(details[0].textContent).toContain('±10 km');
    expect(details[1].textContent).toContain('Solo se conoce el país');
    expect(markerSize(9)).toBeGreaterThan(markerSize(1));
    expect(fits.length).toBe(1); // framed on the two places
    expect(document.body.textContent).not.toContain('simulad');
  });

  it('re-frames only when the set of places changes', () => {
    const { component, fits } = render([madrid]);
    component.markers = [{ ...madrid, count: 12 }];
    component.ngOnChanges();
    expect(fits.length).toBe(1);
    component.markers = [madrid, mexico];
    component.ngOnChanges();
    expect(fits.length).toBe(2);
  });

  it('helpers', () => {
    expect(markerBounds([])).toBeNull();
    expect(markerBounds([madrid, mexico])).toEqual([[-102, 23], [-3.7, 40.4]]);
    expect(markerText(mexico).note).toContain('no la posición del visitante');
  });
});
