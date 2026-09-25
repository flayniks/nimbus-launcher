'use strict';
const { request, postForm, postJson, HttpError } = require('./http');

/**
 * Microsoft → Xbox Live → XSTS → Minecraft sign-in.
 *
 * By default this uses Microsoft's public Minecraft client id with the live.com desktop
 * redirect, the same approach most open-source launchers take. Anyone with their own
 * Azure app (approved for the Minecraft API) can set its client id in settings instead.
 */
const LIVE = {
  clientId: '00000000402b5328',
  authorize: 'https://login.live.com/oauth20_authorize.srf',
  token: 'https://login.live.com/oauth20_token.srf',
  redirect: 'https://login.live.com/oauth20_desktop.srf',
  scope: 'service::user.auth.xboxlive.com::MBI_SSL',
  ticket: (t) => t,
};

function azure(clientId) {
  return {
    clientId,
    authorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    redirect: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
    scope: 'XboxLive.signin offline_access',
    ticket: (t) => `d=${t}`,
  };
}

function oauthConfig(customClientId) {
  return customClientId ? azure(customClientId) : LIVE;
}

function authorizeUrl(cfg) {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    scope: cfg.scope,
    redirect_uri: cfg.redirect,
    prompt: 'select_account',
  });
  return `${cfg.authorize}?${q}`;
}

const XERR = {
  2148916227: 'This Microsoft account is banned from Xbox.',
  2148916229: 'This account needs a parent to allow online play in Xbox family settings.',
  2148916233: 'This Microsoft account has no Xbox profile yet. Sign in once at minecraft.net to create one, then try again.',
  2148916234: 'This account has not accepted the Xbox terms. Sign in at xbox.com once, then try again.',
  2148916235: 'Xbox Live is not available in this account\'s country.',
  2148916236: 'This account needs adult verification (South Korea). Sign in at xbox.com first.',
  2148916237: 'This account needs adult verification (South Korea). Sign in at xbox.com first.',
  2148916238: 'This is a child account. An adult has to add it to a Microsoft family first.',
};

async function msToken(cfg, form) {
  try {
    return await postForm(cfg.token, { client_id: cfg.clientId, scope: cfg.scope, redirect_uri: cfg.redirect, ...form });
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      const e = new Error('Microsoft sign-in expired. Please sign in again.');
      e.code = 'REAUTH';
      throw e;
    }
    throw err;
  }
}

function exchangeCode(cfg, code) {
  return msToken(cfg, { code, grant_type: 'authorization_code' });
}

function refreshMicrosoft(cfg, refreshToken) {
  return msToken(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' });
}

async function xboxChain(cfg, msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: cfg.ticket(msAccessToken) },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  const uhs = xbl.DisplayClaims.xui[0].uhs;

  let xsts;
  try {
    xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      let code = null;
      try { code = JSON.parse(err.body).XErr; } catch { /* fall through */ }
      throw new Error(XERR[code] || `Xbox Live refused the sign-in (${code || 401}).`);
    }
    throw err;
  }

  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.Token}`,
  });
  return { accessToken: mc.access_token, expiresAt: Date.now() + (mc.expires_in - 60) * 1000 };
}

/** The Minecraft token is a JWT that carries the Xbox user id the game wants as --xuid. */
function xuidFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return payload.xuid || null;
  } catch { return null; }
}

async function getProfile(mcToken) {
  try {
    const res = await request('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${mcToken}` },
    });
    return res.json();
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      const e = new Error('This Microsoft account does not own Minecraft: Java Edition (or has not picked a username yet at minecraft.net).');
      e.code = 'NO_GAME';
      throw e;
    }
    throw err;
  }
}

async function completeLogin(cfg, ms) {
  const mc = await xboxChain(cfg, ms.access_token);
  const profile = await getProfile(mc.accessToken);
  const skin = (profile.skins || []).find((s) => s.state === 'ACTIVE') || profile.skins?.[0];
  return {
    uuid: profile.id,
    name: profile.name,
    skin: skin?.url || null,
    accessToken: mc.accessToken,
    expiresAt: mc.expiresAt,
    xuid: xuidFromToken(mc.accessToken),
    refreshToken: ms.refresh_token,
  };
}

async function loginWithCode(cfg, code) {
  return completeLogin(cfg, await exchangeCode(cfg, code));
}

/** Refreshes the whole chain from the stored Microsoft refresh token. */
async function refresh(cfg, refreshToken) {
  return completeLogin(cfg, await refreshMicrosoft(cfg, refreshToken));
}

module.exports = { LIVE, oauthConfig, authorizeUrl, loginWithCode, refresh, getProfile, xuidFromToken };
