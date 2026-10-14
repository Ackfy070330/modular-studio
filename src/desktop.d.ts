export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'error';
  currentVersion: string; received?: number; error?: string; notice?: string;
  release?: { version: string; name: string; size: number; preview: boolean; notes: string };
}
declare global {
  interface Window {
    desktop?: {
      isDesktop: true; selectDirectory: () => Promise<string | null>;
      openReleasePage: () => Promise<void>;
      updateState: () => Promise<UpdateState>; checkUpdate: () => Promise<UpdateState>;
      downloadUpdate: () => Promise<UpdateState>; cancelUpdate: () => Promise<void>; revealUpdate: () => Promise<void>;
      onUpdate: (callback: (state: UpdateState) => void) => () => void;
    };
  }
}
