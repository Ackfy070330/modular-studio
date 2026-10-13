export {};
declare global {
  interface Window {
    desktop?: { isDesktop: true; selectDirectory: () => Promise<string | null> };
  }
}
