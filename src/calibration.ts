/** Optical parameter conversion follows Looking Glass's Apache-2.0 WebXR
 * LookingGlassConfig.ts. Independent Portrait-only parser and validation.
 * https://github.com/Looking-Glass/looking-glass-webxr */
export interface Calibration {
  serial: string; pitch: number; slope: number; center: number; DPI: number;
  screenW: number; screenH: number; viewCone: number; invView: number;
  flipImageX: number; flipImageY: number; flipSubp: number;
}
export function parseCalibration(input: unknown): Calibration {
  if (!input || typeof input !== 'object') throw new Error('Expected a Visual.json calibration object.');
  const root = input as Record<string, unknown>;
  const data = (root.calibration ?? root) as Record<string, unknown>;
  if (!data || typeof data !== 'object') throw new Error('Invalid calibration wrapper.');
  function field(name: string, fallback?: number): number {
    const raw = data[name];
    const n = raw && typeof raw === 'object' ? (raw as {value: unknown}).value : raw;
    if (n === undefined && fallback !== undefined) return fallback;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`Calibration ${name} must be a finite number.`);
    return n;
  }
  const serial = data.serial;
  if (typeof serial !== 'string' || !serial.trim()) throw new Error('Calibration is missing its device serial.');
  const c: Calibration = {
    serial, pitch: field('pitch'), slope: field('slope'), center: field('center'),
    DPI: field('DPI'), screenW: field('screenW'), screenH: field('screenH'),
    viewCone: field('viewCone'), invView: field('invView'),
    flipImageX: field('flipImageX', 0), flipImageY: field('flipImageY', 0), flipSubp: field('flipSubp', 0),
  };
  if (c.screenW !== 1536 || c.screenH !== 2048) throw new Error('This version supports the original 1536 × 2048 Looking Glass Portrait only.');
  if (c.pitch <= 0 || c.pitch > 1000 || c.DPI < 1 || c.DPI > 2000 || Math.abs(c.slope) < 0.01 || Math.abs(c.slope) > 1000 || Math.abs(c.center) > 100 || c.viewCone <= 0 || c.viewCone >= 90)
    throw new Error('Calibration optical values are outside supported ranges.');
  for (const name of ['invView', 'flipImageX', 'flipImageY', 'flipSubp'] as const)
    if (c[name] !== 0 && c[name] !== 1) throw new Error(`${name} must be 0 or 1.`);
  if (Array.isArray(data.subpixelCells) && data.subpixelCells.length) throw new Error('Subpixel-cell calibrations are not supported by this Portrait renderer.');
  return c;
}
export function opticalUniforms(c: Calibration) {
  const direction = c.flipImageX ? -1 : 1;
  return {
    pitch: c.pitch * c.screenW / c.DPI * Math.cos(Math.atan(1 / c.slope)),
    tilt: c.screenH / (c.screenW * c.slope) * direction,
    subp: direction / (c.screenW * 3),
  };
}
export const profiles = {
  eco: { label: 'Eco', columns: 6, rows: 4, tileW: 240, tileH: 320, fps: 24 },
  balanced: { label: 'Balanced', columns: 8, rows: 6, tileW: 315, tileH: 420, fps: 30 },
  detail: { label: 'Detail', columns: 8, rows: 6, tileW: 420, tileH: 560, fps: 30 },
} as const;
export type Profile = keyof typeof profiles;
export function viewOffset(index: number, count: number, distance: number, coneDegrees: number) {
  return distance * Math.tan((index + 0.5) / count * coneDegrees * Math.PI / 180 - coneDegrees * Math.PI / 360);
}
