/** Shared native options for the existing minicard selectors. */
export function CardMetricOptions({ vm = false }: { vm?: boolean }) {
  const disk = vm ? "Disco da VM" : "Disco";
  return <><option value="cpu,memory">CPU e RAM</option><option value="cpu,disk">CPU e {disk}</option><option value="disk,memory">{disk} e RAM</option><option value="cpu,memory,disk">CPU, RAM e {disk}</option></>;
}
