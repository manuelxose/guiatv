// A country marker is an approximate centroid of its largest map polygon, not a user's location.
export function countryMarker(path: string): { x: number; y: number } | null {
  let largestArea = 0;
  let marker: { x: number; y: number } | null = null;
  for (const ring of path.split('M').slice(1)) {
    const points = ring.replace(/Z$/, '').split('L').map((point) => point.split(' ').map(Number));
    let area = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      const cross = x1 * y2 - x2 * y1;
      area += cross;
      x += (x1 + x2) * cross;
      y += (y1 + y2) * cross;
    }
    if (Math.abs(area) > largestArea) {
      largestArea = Math.abs(area);
      marker = { x: x / (3 * area), y: y / (3 * area) };
    }
  }
  return marker;
}
