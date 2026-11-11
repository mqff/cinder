export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(`cinder-${key}`) ?? window.localStorage.getItem(`au-${key}`);
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(`cinder-${key}`, value);
  } catch {}
}
