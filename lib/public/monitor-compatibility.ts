export function needsCompatibleMonitor(userAgent: string) {
  if (/(?:iPhone|iPad|iPod)/i.test(userAgent)) {
    const system = /OS (\d+)[_.](\d+)/i.exec(userAgent);
    return !system || Number(system[1]) < 16 || Number(system[1]) === 16 && Number(system[2]) < 4;
  }
  const chromium = /(?:Chrome|Chromium|CriOS)\/(\d+)/i.exec(userAgent);
  if (chromium) return Number(chromium[1]) < 111;
  const firefox = /Firefox\/(\d+)/i.exec(userAgent);
  if (firefox) return Number(firefox[1]) < 128;
  const safari = /Version\/(\d+)(?:\.(\d+))?.*Safari\//i.exec(userAgent);
  if (safari) return Number(safari[1]) < 16 || Number(safari[1]) === 16 && Number(safari[2] ?? 0) < 4;
  return true;
}
