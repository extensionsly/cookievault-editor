import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  // Service Worker entrypoint. Lifetime is bounded (~30s idle), so do
  // not hold state here — persist to chrome.storage instead.
  //
  // Future: route CRUD commands from popup via chrome.runtime.onMessage,
  // gated by zod schemas from @cookievault/shared/schema.
  console.info('[CookieVault Editor] background started');
});
