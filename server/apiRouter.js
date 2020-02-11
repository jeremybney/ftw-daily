const http = require('http');
const https = require('https');
const express = require('express');
const crypto = require('crypto');
const sharetribeSdk = require('sharetribe-flex-sdk');
const Decimal = require('decimal.js');
const fs = require('fs');
const path = require('path');

const buildPath = path.resolve(__dirname, '..', 'build');
const CLIENT_ID = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
const ROOT_URL = process.env.REACT_APP_CANONICAL_ROOT_URL;
const CONSOLE_URL =
  process.env.SERVER_SHARETRIBE_CONSOLE_URL || 'https://flex-console.sharetribe.com';
const BASE_URL = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;
const TRANSIT_VERBOSE = process.env.REACT_APP_SHARETRIBE_SDK_TRANSIT_VERBOSE === 'true';
const USING_SSL = process.env.REACT_APP_SHARETRIBE_USING_SSL === 'true';

const internalErrorPage = fs.readFileSync(path.join(buildPath, '500.html'), 'utf-8');

const router = express.Router();
const stateKey = `st-${CLIENT_ID}-oauth2State`;
const codeVerifierKey = `st-${CLIENT_ID}-pkceCodeVerifier`;

// redirect_uri param used when initiating a login as authenitcation flow and
// when requesting a token useing an authorization code
const loginAsRedirectUri = `${ROOT_URL.replace(/\/$/, '')}/api/login-as`;

// Instantiate HTTP(S) Agents with keepAlive set to true.
// This will reduce the request time for consecutive requests by
// reusing the existing TCP connection, thus eliminating the time used
// for setting up new TCP connections.
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

/**
 * Makes a base64 string URL friendly by
 * replacing unaccepted characters.
 */
const urlifyBase64 = base64Str =>
  base64Str
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

// Creates a 302 response that redirects to start an OAuth2 Authorization code
// login flow.
router.get('/initiate-login-as', (req, res) => {
  const userId = req.query.user_id;

  if (!userId) {
    return res.status(400).send('Missing query parameter: user_id.');
  }
  if (!ROOT_URL) {
    return res.status(409).send('Marketplace canonical root URL is missing.');
  }

  const state = urlifyBase64(crypto.randomBytes(32).toString('base64'));
  const codeVerifier = urlifyBase64(crypto.randomBytes(32).toString('base64'));
  const hash = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64');
  const codeChallenge = urlifyBase64(hash);
  const authorizeServerUrl = `${CONSOLE_URL}/api/authorize-as`;

  const location = `${authorizeServerUrl}?\
response_type=code&\
client_id=${CLIENT_ID}&\
redirect_uri=${loginAsRedirectUri}&\
user_id=${userId}&\
state=${state}&\
code_challenge=${codeChallenge}&\
code_challenge_method=S256`;

  res.cookie(stateKey, state);
  res.cookie(codeVerifierKey, codeVerifier);
  return res.redirect(location);
});

// Works as the redirect_uri passed in an authorization code request. Receives
// an authorization code and uses that to log in and redirect to the landing
// page.
router.get('/login-as', (req, res) => {
  const { code, state, error } = req.query;
  const storedState = req.cookies[stateKey];

  if (state !== storedState) {
    return res.status(403).send('Invalid state parameter.');
  }

  if (error) {
    return res.status(400).send(`Failed to log in as user, error: ${error}.`);
  }

  const codeVerifier = req.cookies[codeVerifierKey];
  const baseUrl = BASE_URL ? { baseUrl: BASE_URL } : {};
  const tokenStore = sharetribeSdk.tokenStore.expressCookieStore({
    clientId: CLIENT_ID,
    req,
    res,
    secure: USING_SSL,
  });

  const sdk = sharetribeSdk.createInstance({
    transitVerbose: TRANSIT_VERBOSE,
    clientId: CLIENT_ID,
    httpAgent: httpAgent,
    httpsAgent: httpsAgent,
    tokenStore,
    typeHandlers: [
      {
        type: sharetribeSdk.types.BigDecimal,
        customType: Decimal,
        writer: v => new sharetribeSdk.types.BigDecimal(v.toString()),
        reader: v => new Decimal(v.value),
      },
    ],
    ...baseUrl,
  });

  sdk
    .login({
      code,
      redirect_uri: loginAsRedirectUri,
      code_verifier: codeVerifier,
    })
    .then(() => res.redirect('/'))
    .catch(() => res.status(500).send(internalErrorPage));
});

module.exports = router;
