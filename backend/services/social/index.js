// Registry of platform connectors. Each connector exports the same shape:
//
//   isConfigured()                              → boolean   // env vars present?
//   buildAuthUrl({ state, redirectUri })        → string
//   exchangeCodeForToken({ code, redirectUri }) → { access_token, expires_in?, refresh_token?, scope? }
//   fetchProfile(accessToken)                   → Array<{ external_id, name, handle,
//                                                         avatar_url, account_kind,
//                                                         meta?, accessToken? }>
//      (always an array — single-account platforms return a one-element array.
//       `accessToken` override is used by platforms where each sub-account has
//       its own token distinct from the user token.)
//   publishPost({ account, accessToken, caption, imageUrl })
//                                               → { platform_post_id, platform_post_url? }
//
// Only LinkedIn is wired up today. To add Facebook / Instagram / X later,
// drop a connector module here and add a line to PLATFORMS — the route
// layer is platform-agnostic.

const linkedin = require('./linkedin');

const PLATFORMS = {
    linkedin,
};

function getConnector(platform) {
    const c = PLATFORMS[platform];
    if (!c) throw new Error(`Unknown platform: ${platform}`);
    return c;
}

// A platform is "configured" when its env vars are present. The route layer
// uses this to fail fast with a clean error instead of building a broken
// auth URL when the operator hasn't set up credentials yet.
function isPlatformConfigured(platform) {
    try {
        const c = getConnector(platform);
        return typeof c.isConfigured === 'function' ? !!c.isConfigured() : true;
    } catch {
        return false;
    }
}

function configuredMap() {
    return Object.keys(PLATFORMS).reduce((acc, p) => {
        acc[p] = isPlatformConfigured(p);
        return acc;
    }, {});
}

module.exports = {
    getConnector,
    isPlatformConfigured,
    configuredMap,
    PLATFORMS: Object.keys(PLATFORMS),
};
