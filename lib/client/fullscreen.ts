export async function enterFullscreen() {
  if (document.fullscreenElement) return;
  if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) throw new Error("unsupported");
  await document.documentElement.requestFullscreen();
}
