// LinkedIn connector — real OAuth + posting.
//
// LinkedIn's APIs come in two flavours:
//   • Member auth (a person's own feed) — uses scope `w_member_social`,
//     no app review needed for the basic posting flow.
//   • Organization auth (a Company Page) — uses scope `w_organization_social`,
//     requires the connecting user to have admin rights on the page AND
//     a LinkedIn app with "Marketing Developer Platform" access (a review
//     step that takes a few business days).
//
// For Phase 2 we implement both flows. The OAuth start URL requests both
// scopes; if the user only has personal access, LinkedIn returns just the
// member scope and we record an `account_kind: 'personal'`. If they have
// any Company Pages, we fetch them after sign-in and let them pick.
//
// References:
//   https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
//   https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/ugc-post-api
//   https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api

const AUTH_BASE  = 'https://www.linkedin.com/oauth/v2';
const API_BASE   = 'https://api.linkedin.com';

// We ask for member-feed posting + email/profile read + page-admin (optional).
// Newer LinkedIn apps use OpenID Connect scopes; classic apps use r_liteprofile.
// We request both and accept whichever the app config grants.
const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

function isConfigured() {
    return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

function buildAuthUrl({ state, redirectUri }) {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    if (!clientId) throw new Error('LINKEDIN_CLIENT_ID not configured');
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        scope: SCOPES.join(' '),
    });
    return `${AUTH_BASE}/authorization?${params.toString()}`;
}

async function exchangeCodeForToken({ code, redirectUri }) {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('LinkedIn client credentials missing');

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
    });

    const res = await fetch(`${AUTH_BASE}/accessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`LinkedIn token exchange failed (${res.status}): ${text}`);
    }
    return await res.json();
    // shape: { access_token, expires_in, scope, token_type, refresh_token?, refresh_token_expires_in? }
}

// Pull the freshly-authed user's profile so we know who to attach the
// account to. Tries the OIDC userinfo endpoint first (works for any
// new-style app), falls back to /v2/me (classic apps).
//
// Returns an array of accounts to match the multi-account connectors
// (FB Pages, IG accounts). LinkedIn only ever returns one (the
// authenticating member), but routing through the same shape keeps
// the route layer simple.
async function fetchProfile(accessToken) {
    let res = await fetch(`${API_BASE}/v2/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
        const j = await res.json();
        return [{
            external_id: j.sub,                                 // OIDC subject = LinkedIn URN-less id
            name: j.name || [j.given_name, j.family_name].filter(Boolean).join(' '),
            handle: j.email || null,
            avatar_url: j.picture || null,
            account_kind: 'personal',
            meta: { urn: `urn:li:person:${j.sub}` },
        }];
    }
    // Fallback: classic v2 /me
    res = await fetch(`${API_BASE}/v2/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`LinkedIn /me failed (${res.status})`);
    const j = await res.json();
    return [{
        external_id: j.id,
        name: [j.localizedFirstName, j.localizedLastName].filter(Boolean).join(' '),
        handle: null,
        avatar_url: null,
        account_kind: 'personal',
        meta: { urn: `urn:li:person:${j.id}` },
    }];
}

// Post text + optional image to the member's feed using UGC Posts.
// Two cases:
//   • text-only — direct ugcPosts call with shareMediaCategory: NONE
//   • with image — register an upload, PUT the image bytes, then post with
//     shareMediaCategory: IMAGE
async function publishPost({ account, accessToken, caption, imageUrl }) {
    // URN is stored in account_meta on connect; fall back to building it from
    // the external_id for rows from earlier schema versions.
    const urn = account?.meta?.urn || `urn:li:person:${account?.account_external_id}`;
    let mediaPart = { shareMediaCategory: 'NONE' };

    if (imageUrl) {
        // 1) Register upload — LinkedIn returns an asset URN + upload URL.
        const regRes = await fetch(`${API_BASE}/v2/assets?action=registerUpload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Restli-Protocol-Version': '2.0.0',
            },
            body: JSON.stringify({
                registerUploadRequest: {
                    recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                    owner: urn,
                    serviceRelationships: [{
                        relationshipType: 'OWNER',
                        identifier: 'urn:li:userGeneratedContent',
                    }],
                },
            }),
        });
        if (!regRes.ok) throw new Error(`LinkedIn registerUpload failed (${regRes.status}): ${await regRes.text()}`);
        const reg = await regRes.json();
        const asset = reg.value.asset;
        const uploadUrl = reg.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;

        // 2) Download the source image bytes + PUT them at the upload URL.
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) throw new Error(`Failed to fetch image for upload: ${imgRes.status}`);
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        const upRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: imgBuf,
        });
        if (!upRes.ok) throw new Error(`LinkedIn image upload failed (${upRes.status})`);

        mediaPart = {
            shareMediaCategory: 'IMAGE',
            media: [{
                status: 'READY',
                description: { text: caption?.slice(0, 200) || '' },
                media: asset,
                title: { text: 'SNS Card' },
            }],
        };
    }

    const ugcBody = {
        author: urn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text: caption || '' },
                ...mediaPart,
            },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    const res = await fetch(`${API_BASE}/v2/ugcPosts`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcBody),
    });
    if (!res.ok) throw new Error(`LinkedIn ugcPosts failed (${res.status}): ${await res.text()}`);
    const created = await res.json();
    // LinkedIn returns the URN of the new post via the `x-restli-id` header.
    const postUrn = res.headers.get('x-restli-id') || created.id;
    return {
        platform_post_id: postUrn,
        // LinkedIn doesn't return a direct URL; the activity id portion is
        // browseable at linkedin.com/feed/update/<urn>.
        platform_post_url: postUrn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/` : null,
    };
}

module.exports = { isConfigured, buildAuthUrl, exchangeCodeForToken, fetchProfile, publishPost };
