/** When this build was made (ms since epoch), set by vite.config.ts. Pages and the worker share it. */
declare const __BUILD_ID__: number;
/**
 * The research study is in this build: the x-ray and dev pages, their link, the open-tab
 * snapshots and the press times. False only in the Chrome Web Store build (vite --mode store).
 */
declare const __STUDY__: boolean;
