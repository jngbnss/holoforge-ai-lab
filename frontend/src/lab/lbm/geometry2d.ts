// 2D 형상 → 격자 물체 마스크. 셀 중심이 다각형 안이면 물체.

export type Pt = [number, number];

/** NACA 4자리 대칭(00tt) 익형 윤곽. 시위 1, 앞전 (0,0) → 뒷전 (1,0). 뒷전을 닫는 계수 사용 */
export function naca00(thickness: number, points = 80): Pt[] {
  const half = (x: number) =>
    5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const upper: Pt[] = [];
  const lower: Pt[] = [];
  for (let i = 0; i <= points; i++) {
    // 앞전 쪽을 촘촘하게
    const x = 0.5 * (1 - Math.cos((Math.PI * i) / points));
    upper.push([x, half(x)]);
    lower.push([x, -half(x)]);
  }
  return [...upper, ...lower.reverse().slice(1, -1)];
}

/** 받음각 α(도): 앞전이 들리는 방향이 +. 1/4 시위점 기준 회전 후 크기·위치 변환 */
export function placeAirfoil(shape: Pt[], chord: number, leadingEdge: Pt, alphaDeg: number): Pt[] {
  const a = (-alphaDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return shape.map(([x, y]) => {
    const px = (x - 0.25) * chord;
    const py = y * chord;
    return [leadingEdge[0] + 0.25 * chord + c * px - s * py, leadingEdge[1] + s * px + c * py];
  });
}

export function pointInPolygon(px: number, py: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 다각형 여러 개(다요소 날개)를 마스크로. 셀 (x, y) 중심 = (x + 0.5, y + 0.5) */
export function rasterize(nx: number, ny: number, polys: Pt[][]): Uint8Array {
  const mask = new Uint8Array(nx * ny);
  for (const poly of polys) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(ny - 1, Math.ceil(maxY)); y++) {
      for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(nx - 1, Math.ceil(maxX)); x++) {
        if (pointInPolygon(x + 0.5, y + 0.5, poly)) mask[y * nx + x] = 1;
      }
    }
  }
  return mask;
}

export function circleMask(nx: number, ny: number, cx: number, cy: number, r: number): Uint8Array {
  const mask = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) mask[y * nx + x] = 1;
    }
  }
  return mask;
}
