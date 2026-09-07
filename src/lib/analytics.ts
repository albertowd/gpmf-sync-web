// Analytics bootstrap. Both providers are opt-in by environment:
//   - Google Analytics 4 loads on any deployed origin, never on localhost.
//   - Vercel Web Analytics loads only in bundles produced by a Vercel build
//     (`__VERCEL_BUILD__`, injected by vite.config.ts), because its script is
//     served from `/_vercel/insights/` and exists only on Vercel deployments.
// Neither runs in `vite dev`.

const GA_MEASUREMENT_ID = "G-1YDBNGXRYF";
const GA_SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// Loopback, mDNS (`*.local`) and RFC1918 addresses all mean "someone is
// running the dev server", including from a phone on the same LAN.
const PRIVATE_IPV4 =
  /^(?:10\.|127\.|0\.0\.0\.0$|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|]$/g, "").toLowerCase();
  if (host === "" || host === "localhost" || host === "::1") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  return PRIVATE_IPV4.test(host);
}

function shouldTrack(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return false;
  if (window.location.protocol === "file:") return false;
  return !isLocalHost(window.location.hostname);
}

function gtag(..._args: unknown[]): void {
  // Deliberately forwards `arguments` rather than a rest array: gtag.js
  // identifies its commands by the Arguments object that Google's official
  // snippet pushes onto the queue.
  // biome-ignore lint/complexity/noArguments: matches the documented gtag snippet.
  window.dataLayer?.push(arguments);
}

function sendPageView(): void {
  gtag("event", "page_view", {
    page_location: window.location.href,
    page_title: document.title,
    page_referrer: document.referrer || undefined,
  });
}

// GA4 only auto-sends a page_view on the initial document load, so SPA
// navigations (History API, back/forward, hash changes) have to be reported
// by hand. `send_page_view: false` in the config keeps the initial hit from
// being counted twice.
function trackSpaNavigation(): void {
  let lastHref = window.location.href;
  const onNavigate = (): void => {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    sendPageView();
  };

  const originalPushState = history.pushState;
  history.pushState = function pushState(...args: Parameters<History["pushState"]>) {
    originalPushState.apply(this, args);
    onNavigate();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function replaceState(...args: Parameters<History["replaceState"]>) {
    originalReplaceState.apply(this, args);
    onNavigate();
  };

  window.addEventListener("popstate", onNavigate);
  window.addEventListener("hashchange", onNavigate);
}

function initGoogleAnalytics(): void {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement("script");
  script.async = true;
  script.src = GA_SCRIPT_SRC;
  document.head.appendChild(script);

  sendPageView();
  trackSpaNavigation();
}

function initVercelAnalytics(): void {
  // Statically false off Vercel, so the import below is dropped from the
  // bundle entirely rather than shipped as an unused chunk.
  if (!__VERCEL_BUILD__) return;
  void import("@vercel/analytics").then(({ inject }) => {
    inject({ framework: "vite" });
  });
}

/**
 * Loads the analytics providers enabled for this build. Safe to call once at
 * startup; a no-op during development and on localhost.
 */
export function initAnalytics(): void {
  if (!shouldTrack()) return;

  // Analytics must never compete with the app's own boot work.
  const start = (): void => {
    initGoogleAnalytics();
    initVercelAnalytics();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(start, { timeout: 3000 });
  } else {
    setTimeout(start, 0);
  }
}
