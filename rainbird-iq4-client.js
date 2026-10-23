/**
 * Rain Bird IQ4 cloud client (Rain Bird 2.0 app REST API).
 *
 * This is an ALTERNATIVE transport to the local LNK2/SIP client in
 * node-rainbird.js. It talks to the reverse-engineered IQ4 cloud platform
 * documented in docs/IQ4_PROTOCOL.md. It is intended primarily for read-only
 * data that the local SIP protocol does not expose (flow monitoring, full
 * program configuration).
 *
 * Authorization notes (see docs/IQ4_PROTOCOL.md):
 *  - OIDC implicit flow => access_token only, valid ~1h, NO refresh token.
 *    We therefore cache the token and transparently re-login when it expires
 *    or when the API returns 401.
 *  - The auth endpoints sit behind AWS WAF. Native Node has a different TLS
 *    fingerprint than a browser, so requests may be blocked. We send
 *    browser-like headers as a best effort and surface WAF blocks as clear
 *    errors (HTTP 403 with an HTML body).
 */

const crypto = require("crypto");
const https = require("https");
const { URL } = require("url");

/**
 * Minimal HTTPS request helper built on Node's core `https` module (no external
 * dependencies). By default it does NOT follow redirects, so the login flow can
 * read the `Location` header carrying the JWT fragment.
 *
 * Returns { statusCode, headers, body } with body as a UTF-8 string.
 */
function httpRequest(urlStr, { method = "GET", headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const u = new URL(urlStr);
		const opts = {
			method,
			hostname: u.hostname,
			port: u.port || 443,
			path: u.pathname + u.search,
			headers: { ...headers }
		};
		if (body !== undefined) {
			opts.headers["content-length"] = Buffer.byteLength(body);
		}
		const req = https.request(opts, (res) => {
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () =>
				resolve({
					statusCode: res.statusCode,
					headers: res.headers,
					body: Buffer.concat(chunks).toString("utf8")
				})
			);
		});
		req.on("error", reject);
		if (body !== undefined) req.write(body);
		req.end();
	});
}

const AUTH_BASE = "https://iq4server.rainbird.com/coreidentityserver";
const API_BASE = "https://iq4server.rainbird.com/coreapi/api";
const REDIRECT_URI = "https://iq4.rainbird.com/auth.html";
const SCOPE = "coreAPI.read coreAPI.write openid profile";

// Best-effort browser-like headers to reduce the chance of an AWS WAF block.
const BROWSER_HEADERS = {
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"accept-language": "en-US,en;q=0.9"
};

// Extra navigation headers sent on the browser-emulated auth (login) requests.
const AUTH_HEADERS = {
	...BROWSER_HEADERS,
	accept:
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
	origin: "https://iq4server.rainbird.com",
	"upgrade-insecure-requests": "1",
	"sec-fetch-dest": "document",
	"sec-fetch-mode": "navigate",
	"sec-fetch-site": "same-origin",
	"sec-fetch-user": "?1"
};

// AWS WAF challenge retry policy (mirrors the reference implementation).
const WAF_RETRY_MAX = 3;
const WAF_BACKOFF_INITIAL_MS = 10000;
const WAF_BACKOFF_INCREMENT_MS = 10000;
const WAF_BACKOFF_MAX_MS = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RainbirdIQ4Client {
	constructor() {
		this.email = null;
		this.password = null;
		this.clientId = null;

		this.token = null;
		this.tokenExpiry = 0; // epoch ms
		this.manualToken = null; // optional token supplied out-of-band
		this.wafToken = null; // optional aws-waf-token cookie (from a browser)

		this._loginPromise = null; // mutex: at most one login in flight

		this.logger = {
			log: console.log,
			warn: console.warn,
			error: console.error
		};
	}

	setCredentials(email, password) {
		this.email = email;
		this.password = password;
	}

	setClientId(clientId) {
		this.clientId = clientId;
	}

	// Optional: a Bearer access token obtained manually (e.g. from the browser),
	// used to bypass the AWS WAF-protected headless login. When set, the client
	// skips the login flow entirely and uses this token for API calls.
	setManualToken(token) {
		this.manualToken = token || null;
	}

	// Optional: an aws-waf-token cookie value copied from a browser session.
	// Injected into every request so the AWS WAF challenge is satisfied (valid
	// only for the WAF token's immunity window).
	setWafToken(token) {
		this.wafToken = token || null;
	}

	setLogger(logger) {
		if (logger) this.logger = logger;
	}

	destroy() {
		this.token = null;
		this.tokenExpiry = 0;
		this._loginPromise = null;
	}

	// ---- internal helpers ---------------------------------------------------

	// Debug log (only surfaced when the config node has Debug enabled).
	_dbg(msg) {
		this.logger.log("IQ4: " + msg);
	}

	// Mask a secret for logs: keep length + last 6 chars only.
	static _mask(secret) {
		if (!secret) return "<none>";
		const s = String(secret);
		return `<len=${s.length}…${s.slice(-6)}>`;
	}

	// Heuristic: does an HTML body look like an AWS WAF / CAPTCHA challenge?
	static _looksLikeWaf(html) {
		if (!html) return false;
		const h = html.toLowerCase();
		return (
			h.includes("captcha") ||
			h.includes("awswaf") ||
			h.includes("challenge") ||
			h.includes("are you a robot") ||
			h.includes("token-challenge")
		);
	}

	// Build an Error tagged as a (retryable) WAF challenge.
	static _wafError(message) {
		const e = new Error(message);
		e.waf = true;
		return e;
	}

	static _randHex(bytes) {
		return crypto.randomBytes(bytes).toString("hex");
	}

	// Mirror Python's urllib.parse.quote(s, safe="/"): percent-encode, but keep
	// slashes literal. ASP.NET/WAF often reject encoded slashes (%2F) with 500.
	static _quote(s) {
		return encodeURIComponent(s).replace(/%2F/g, "/");
	}

	_buildReturnUrl(state, nonce) {
		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: REDIRECT_URI,
			response_type: "id_token token",
			scope: SCOPE,
			state,
			nonce
		});
		return `/coreidentityserver/connect/authorize/callback?${params.toString()}`;
	}

	// Collect Set-Cookie values into a "name=value; name=value" Cookie header.
	static _mergeCookies(jar, setCookie) {
		if (!setCookie) return;
		const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
		for (const c of arr) {
			const pair = c.split(";")[0];
			const eq = pair.indexOf("=");
			if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
		}
	}

	static _cookieHeader(jar) {
		return Object.entries(jar)
			.map(([k, v]) => `${k}=${v}`)
			.join("; ");
	}

	/**
	 * Perform the full username/password login flow and cache the token.
	 * Throws with a descriptive message on any failure.
	 */
	async _login() {
		if (!this.email || !this.password) {
			throw new Error("IQ4: missing email/password credentials");
		}
		if (!this.clientId) {
			throw new Error("IQ4: missing APP_CLIENT_ID (UUID)");
		}

		const state = RainbirdIQ4Client._randHex(8);
		const nonce = RainbirdIQ4Client._randHex(8);
		const returnUrl = this._buildReturnUrl(state, nonce);
		const jar = {};
		// Seed the jar with the browser-supplied WAF token so every request in
		// the flow presents it (needed to pass the AWS WAF challenge).
		if (this.wafToken) jar["aws-waf-token"] = this.wafToken;

		this._dbg(
			`login start: user=${this.email} clientId=${this.clientId}` +
				(this.wafToken ? " (with aws-waf-token)" : "")
		);

		// 1. GET login page -> antiforgery cookie + CSRF token in the HTML.
		const loginUrl = `${AUTH_BASE}/Account/Login?ReturnUrl=${RainbirdIQ4Client._quote(returnUrl)}`;
		const getRes = await httpRequest(loginUrl, {
			method: "GET",
			headers: {
				...AUTH_HEADERS,
				...(this.wafToken ? { cookie: RainbirdIQ4Client._cookieHeader(jar) } : {})
			}
		});
		RainbirdIQ4Client._mergeCookies(jar, getRes.headers["set-cookie"]);
		const html = getRes.body;
		this._dbg(
			`GET login page: HTTP ${getRes.statusCode}, ${html.length} bytes, ` +
				`cookies=[${Object.keys(jar).join(",")}]`
		);

		// AWS WAF issues a 202 (or 403) interstitial challenge to non-browser clients.
		if (
			getRes.statusCode === 202 ||
			getRes.statusCode === 403 ||
			(getRes.statusCode === 200 && RainbirdIQ4Client._looksLikeWaf(html))
		) {
			this._dbg("WAF body snippet: " + html.slice(0, 300).replace(/\s+/g, " "));
			throw RainbirdIQ4Client._wafError(
				`IQ4: login page blocked by AWS WAF (HTTP ${getRes.statusCode})`
			);
		}
		if (getRes.statusCode !== 200) {
			throw new Error(`IQ4: unexpected status ${getRes.statusCode} fetching login page`);
		}

		// The token input may appear as name-then-value or value-then-name.
		let csrfMatch = html.match(
			/name=["']__RequestVerificationToken["'][^>]*?value=["']([^"']+)["']/i
		);
		if (!csrfMatch) {
			csrfMatch = html.match(
				/value=["']([^"']+)["'][^>]*?name=["']__RequestVerificationToken["']/i
			);
		}
		if (!csrfMatch) {
			throw new Error("IQ4: could not extract __RequestVerificationToken (login page changed?)");
		}
		const csrfToken = csrfMatch[1];
		this._dbg(`CSRF token extracted (${csrfToken.length} chars)`);

		// 2. POST credentials (ReturnUrl unencoded in the body). No auto-redirect
		//    so we can walk the redirect chain ourselves.
		const form = new URLSearchParams({
			Username: this.email,
			Password: this.password,
			ReturnUrl: returnUrl,
			__RequestVerificationToken: csrfToken
		});
		const postRes = await httpRequest(loginUrl, {
			method: "POST",
			headers: {
				...AUTH_HEADERS,
				referer: loginUrl,
				"content-type": "application/x-www-form-urlencoded",
				cookie: RainbirdIQ4Client._cookieHeader(jar)
			},
			body: form.toString()
		});
		RainbirdIQ4Client._mergeCookies(jar, postRes.headers["set-cookie"]);
		this._dbg(
			`POST credentials: HTTP ${postRes.statusCode}, ` +
				`location=${postRes.headers["location"] ? "yes" : "no"}`
		);

		if (postRes.statusCode === 202 || postRes.statusCode === 403) {
			throw RainbirdIQ4Client._wafError(
				`IQ4: login POST blocked by AWS WAF (HTTP ${postRes.statusCode})`
			);
		}
		if (postRes.statusCode === 200) {
			// Login page re-rendered => bad credentials or a WAF challenge.
			if (RainbirdIQ4Client._looksLikeWaf(postRes.body)) {
				throw RainbirdIQ4Client._wafError("IQ4: login POST returned a WAF challenge (HTTP 200)");
			}
			throw new Error("IQ4: authentication failed (check email/password)");
		}
		if (postRes.statusCode < 300 || postRes.statusCode >= 400 || !postRes.headers["location"]) {
			throw new Error(`IQ4: unexpected status ${postRes.statusCode} submitting credentials`);
		}

		// 3. Follow the redirect chain until we reach the redirect URI, whose
		//    fragment carries the JWT (callback -> ... -> auth.html#access_token=).
		const { accessToken, expiresIn } = await this._followRedirects(
			postRes.headers["location"],
			jar
		);

		this.token = accessToken;
		this.tokenExpiry = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000;
		this._dbg(
			`authenticated: token=${RainbirdIQ4Client._mask(accessToken)}, ` +
				`valid for ~${Math.round((this.tokenExpiry - Date.now()) / 1000)}s`
		);
		return this.token;
	}

	/**
	 * Run _login() with retry+backoff on AWS WAF challenges (202/403/captcha).
	 * The WAF challenge is often transient, so a delayed retry can succeed.
	 */
	async _loginWithRetry() {
		let backoff = WAF_BACKOFF_INITIAL_MS;
		for (let attempt = 0; ; attempt++) {
			try {
				return await this._login();
			} catch (err) {
				if (err && err.waf && attempt < WAF_RETRY_MAX) {
					this.logger.warn(
						`IQ4: AWS WAF challenge (${err.message}); retrying in ${backoff / 1000}s ` +
							`(attempt ${attempt + 1}/${WAF_RETRY_MAX})`
					);
					await sleep(backoff);
					backoff = Math.min(backoff + WAF_BACKOFF_INCREMENT_MS, WAF_BACKOFF_MAX_MS);
					continue;
				}
				throw err;
			}
		}
	}

	/**
	 * Walk the 30x redirect chain (without auto-following) until the redirect
	 * URI is reached, then parse access_token/expires_in from its URL fragment.
	 */
	async _followRedirects(location, jar) {
		const MAX_REDIRECTS = 10;
		for (let i = 0; i < MAX_REDIRECTS; i++) {
			if (!location) break;

			if (location.indexOf(REDIRECT_URI) === 0) {
				this._dbg(`redirect hop ${i}: reached redirect URI`);
				const hashIndex = location.indexOf("#");
				if (hashIndex === -1) {
					throw new Error("IQ4: reached redirect URI but no token fragment present");
				}
				const frag = new URLSearchParams(location.slice(hashIndex + 1));
				const accessToken = frag.get("access_token");
				if (!accessToken) {
					const err = frag.get("error");
					throw new Error(`IQ4: no access_token in response${err ? " (" + err + ")" : ""}`);
				}
				return { accessToken, expiresIn: parseInt(frag.get("expires_in"), 10) };
			}

			const url = location.startsWith("/") ? `https://iq4server.rainbird.com${location}` : location;
			// Log only the path/host, never query params (may carry the token).
			this._dbg(`redirect hop ${i}: GET ${url.split("?")[0]}`);
			const res = await httpRequest(url, {
				method: "GET",
				headers: { ...AUTH_HEADERS, cookie: RainbirdIQ4Client._cookieHeader(jar) }
			});
			RainbirdIQ4Client._mergeCookies(jar, res.headers["set-cookie"]);
			if (res.statusCode < 300 || res.statusCode >= 400) {
				throw new Error(`IQ4: redirect chain stopped at HTTP ${res.statusCode}`);
			}
			location = res.headers["location"];
		}
		throw new Error("IQ4: could not retrieve access token from redirect chain");
	}

	/**
	 * Return a valid token, logging in if needed. A single login is shared by
	 * concurrent callers (mutex) so multiple nodes don't hammer the WAF.
	 */
	async _ensureToken(force) {
		// Manual-token mode: bypass the WAF-protected login entirely.
		if (this.manualToken) {
			if (force) {
				// The supplied token was rejected; we cannot silently re-login.
				throw new Error(
					"IQ4: the provided access token was rejected (401/expired) - paste a fresh token from the browser"
				);
			}
			this._dbg(`using manual access token ${RainbirdIQ4Client._mask(this.manualToken)}`);
			return this.manualToken;
		}
		if (force) {
			this.token = null;
		} else if (this.token && Date.now() < this.tokenExpiry - 60000) {
			return this.token;
		}
		if (!this._loginPromise) {
			this._loginPromise = this._loginWithRetry().finally(() => {
				this._loginPromise = null;
			});
		}
		return this._loginPromise;
	}

	/**
	 * Perform an authenticated API request. Retries once after a forced
	 * re-login if the token is rejected (401).
	 */
	async _api(method, path, { query, body } = {}) {
		const doCall = async () => {
			const token = await this._ensureToken(false);
			let url = `${API_BASE}/${path}`;
			if (query) {
				const qs = new URLSearchParams(query).toString();
				if (qs) url += `?${qs}`;
			}
			const headers = {
				...BROWSER_HEADERS,
				accept: "application/json",
				authorization: `Bearer ${token}`
			};
			if (this.wafToken) headers.cookie = `aws-waf-token=${this.wafToken}`;
			const opts = { method, headers };
			if (body !== undefined) {
				headers["content-type"] = "application/json";
				opts.body = JSON.stringify(body);
			}
			return httpRequest(url, opts);
		};

		let res = await doCall();
		this._dbg(`${method} ${path} -> HTTP ${res.statusCode}`);
		if (res.statusCode === 401) {
			this._dbg(`${path}: token rejected (401), forcing re-login`);
			await this._ensureToken(true); // force re-login once
			res = await doCall();
			this._dbg(`${method} ${path} (retry) -> HTTP ${res.statusCode}`);
		}

		const text = res.body;
		if (res.statusCode < 200 || res.statusCode >= 300) {
			throw new Error(`IQ4: ${method} ${path} failed (HTTP ${res.statusCode})`);
		}
		if (!text) return null;
		try {
			return JSON.parse(text);
		} catch (e) {
			throw new Error(`IQ4: ${method} ${path} returned non-JSON response`);
		}
	}

	// ---- public API ---------------------------------------------------------

	// List all controllers (satellites) on the account, so the user can
	// discover the satelliteId to configure.
	getSatellites() {
		return this._api("GET", "Satellite/GetSatelliteList", {
			query: { includeInvisibleToCurrentUser: "false" }
		});
	}

	getSatellite(satelliteId) {
		return this._api("GET", "Satellite/GetSatellite", {
			query: { satelliteId }
		});
	}

	getFlowElements(satelliteId) {
		return this._api("GET", "FlowElement/GetFlowElements", {
			query: { satelliteId }
		});
	}

	getFlowMonitoring(satelliteId) {
		return this._api("GET", "FlowMonitoring/GetFlowMonitoringBySatelliteId", {
			query: { satelliteId }
		});
	}

	getProgramList(satelliteId) {
		return this._api("GET", "Program/GetProgramList", {
			query: { satelliteId }
		});
	}

	getProgramsAssignedRuntime(satelliteId) {
		return this._api("GET", "ProgramStep/GetProgramsAssignedAndRunTimeBySatelliteId", {
			query: { satelliteId }
		});
	}
}

module.exports = RainbirdIQ4Client;
