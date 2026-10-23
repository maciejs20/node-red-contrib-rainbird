# Rain Bird IQ4 Cloud — Implementation Status & Plan

_Last updated: 2026-07-13_

Companion to [IQ4_PROTOCOL.md](IQ4_PROTOCOL.md) (the protocol reference). This
document tracks **what is built, what works, what is blocked, and what comes
next** for the optional IQ4 **cloud** transport — an alternative to the local
LNK2/SIP nodes, aimed at data the local protocol does not expose (flow
monitoring, full program configuration).

---

## 1. Summary (TL;DR)

- The cloud nodes are **implemented and load cleanly** (pure Node core, **no
  external dependencies**).
- **Automated headless login is blocked by an AWS WAF JavaScript challenge** and
  is **not solvable** by any plain HTTP client (confirmed for both this client
  and the reference `pyrainbird`/`aiohttp`).
- **The data API (`coreapi`) is _not_ behind the WAF.** It is reachable from
  Node with just a valid Bearer JWT.
- **Working path today:** paste a browser-obtained **access token (JWT)** into
  the config node. API calls then work for ~1 hour (manual refresh).

---

## 2. What is built

| File | Node / role |
|------|-------------|
| `rainbird-iq4-client.js` | Cloud client: OIDC login flow, token cache + mutex, 401 re-login, WAF detection + backoff retry, manual-token bypass, `aws-waf-token` cookie injection, masked debug logging. Pure `https`. |
| `iq4-config.js` / `.html` | Config node `rainbird-iq4-server`: email, password, satelliteId, stable `APP_CLIENT_ID`, optional **Access token**, optional **AWS WAF token**, Debug flag. Owns one shared client. |
| `rainbird-iq4-satellites.js` / `.html` | Discovery: `Satellite/GetSatelliteList` → controllers + their `id` (the satelliteId). |
| `rainbird-iq4-flow.js` / `.html` | `FlowElement/GetFlowElements` (+ best-effort `FlowMonitoring`). |
| `rainbird-iq4-programs.js` / `.html` | `Program/GetProgramList` + `ProgramStep/GetProgramsAssignedAndRunTimeBySatelliteId`. |

Registered in `package.json` (package **v1.1.0**), `engines: node >=16`.

Client public methods available now: `getSatellites`, `getSatellite`,
`getFlowElements`, `getFlowMonitoring`, `getProgramList`,
`getProgramsAssignedRuntime`.

---

## 3. Authorization findings (empirical, from Node)

Tested directly from Node against the live service on 2026-07-13, using a
browser-obtained `aws-waf-token` cookie:

| Request | Result | Interpretation |
|---------|--------|----------------|
| `coreidentityserver/Account/Login` GET, **no** cookie | `202`, 2431 B | AWS WAF **JS challenge** (`window.awsWafCookie…`) |
| Same GET **with** `aws-waf-token` cookie | `500`, 0 B | Cookie passes WAF; origin then errors |
| `connect/authorize` GET with cookie | `302` → `/home/error?errorId=…` | OIDC request rejected (likely `client_id` not registered) |
| `.well-known/openid-configuration` with cookie | `200` | Confirms the cookie does pass the WAF |
| **`coreapi/api/Satellite/GetSatelliteList`**, no bearer, **no** cookie | **`401`** | **API tier is NOT behind the WAF** — only needs a token |
| Same, no bearer, **with** cookie | `401` | Cookie is irrelevant for `coreapi` |

**Conclusions:**
1. The AWS WAF JS challenge guards only the **login/identity** endpoints
   (`coreidentityserver`), not the **data** endpoints (`coreapi`).
2. A plain HTTP client cannot complete headless login: the challenge needs a
   browser (JS execution) or a browser TLS fingerprint (`curl_cffi`). Retry with
   backoff does not help — the challenge is persistent, not transient.
3. Even with the WAF cookie, automated login still fails (500 / authorize error),
   suggesting a second blocker (the `APP_CLIENT_ID` may need to be one the
   official app registered, not an arbitrary UUID as the protocol doc claims).
4. Because `coreapi` is open, a **manual JWT** is a fully working path.

---

## 4. Working configuration (manual token)

1. Log in at `https://iq4.rainbird.com` in a browser.
2. Get the JWT — either:
   - **Network** tab → any `coreapi` request → `Authorization: Bearer eyJ…`, or
   - **Application → Session/Local Storage** → the `oidc`/user entry → `access_token`.
3. Paste it into the config node's **Access token** field. Leave **AWS WAF token** empty.
4. The client skips login and calls `coreapi` directly. Token lasts ~1 h; on 401
   it surfaces a clear "paste a fresh token" error (no silent re-login possible).

The **AWS WAF token** field remains available but is **not needed** for `coreapi`
and does **not** unblock automated login on its own.

---

## 5. Roadmap

### Phase 1 — Read MVP + manual auth  ✅ done
- Config node, discovery, flow, programs nodes.
- Manual access-token bypass; WAF detection/diagnostics; debug logging.
- Documentation: protocol reference + this status doc.

### Phase 2 — Remaining read nodes  ⬜ next (once a working token is confirmed end-to-end)
Add client methods + nodes for:
- `Station/GetStationListForSatellite` (zone metadata + station-id map)
- `ProgramStep/GetRunStationStatusForSatellite` (live zone status)
- `Satellite/GetSatellite` → rain delay / forecast fields
- `SeasonalAdjust/GetSeasonalAdjustForSite` (needs `siteId` from GetSatellite)
- `Sensor/GetSensorListBySatelliteId`, `ManualOps/GetSatelliteFirmwareVersions`
- `Satellite/isConnected`

### Phase 3 — Write nodes  ⬜ (mirror the local SIP nodes)
- Start zone → `ManualOps/StartStations` (needs zone→stationId resolution)
- Stop / advance zone → `ManualOps/AdvanceStations`
- Stop all → `Satellite/StopAllIrrigation`
- Start program → `ManualOps/StartPrograms`
- Rain delay → `Satellite/v2/UpdateBatches` (.NET-ticks + ISO start)
- Seasonal adjust → `Program/UpdateBatches`

> Zone numbers differ from cloud station **database IDs**. Reuse the
> reference's `_resolve_station_id` pattern (map local zone/terminal → `station.id`).

### Phase 4 — Token lifecycle (reduce manual work)  ⬜ investigation
- **Silent renew** via `connect/authorize?…&prompt=none` using a browser-obtained
  identity **session cookie** + the `aws-waf-token` cookie. Would auto-refresh the
  JWT without credentials, for as long as both cookies stay valid.
- Persist the token (and optionally cookies) so a Node-RED restart doesn't lose it.
- Determine the `aws-waf-token` **immunity time** (how long the cookie satisfies
  the WAF) — decides whether cookie-based automation is practical at all.

### Open investigations
- Why automated login 500s even with the WAF cookie (client-id registration?).
- Whether the official app performs a one-time client registration we can mimic.
- Whether a lightweight headless-browser challenge solver is worth the dependency
  (likely **not** for a Node-RED contrib meant to run on a Raspberry Pi).

---

## 6. Design decisions / constraints

- **No external dependencies.** The cloud client uses Node's built-in `https`
  only, to avoid `MODULE_NOT_FOUND` across Node-RED install layouts.
- **Separate node set** from the local SIP nodes — cloud semantics (station IDs,
  .NET ticks, program model) differ enough that sharing a node would be confusing.
- **One shared client per config node** with a login **mutex**, so multiple nodes
  never trigger parallel logins (WAF-friendly).
- **Local LNK2/SIP remains the primary, most stable transport.** The cloud path is
  opt-in/experimental; treat it as a supplement for cloud-only data.
