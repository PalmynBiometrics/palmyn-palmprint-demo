# Palmyn demo API

Every response has the shape `{ code, result }`, and the HTTP status matches `code`.

The client sends **regions of interest (ROIs)**, never photos: each ROI is a 224×224 grayscale
crop of the palm produced in the browser by [`web/palm_preproc.js`](../web/palm_preproc.js).

## `GET /v1/consent`

Returns `{ version, items: { es, en }, optional: { es, en } }`. Each item is a required
declaration (`id`, `title`, and optionally `summary` and `detail`). The page shows **one
unchecked box per item**, and every request carries
`consent: { version, accepted: true, items: [accepted ids] }`. The server answers
`400 consent_required` if any item is missing or the version is outdated. The optional item
(`share_stats`) is separate and never gates the demo.

## `POST /v1/enroll`

```json
{
  "consent": { "version": "2026-11-demo-4", "accepted": true, "items": ["processing", "age_own_hand", "residency"] },
  "rois": ["<base64>", "<base64>", "<base64>"]
}
```

Each ROI is base64 of either the **50,176 raw bytes** (224×224 uint8 grayscale) or a
**224×224 PNG**, with or without a `data:` prefix.

Response:

```json
{ "token": "pdm1.k1.…", "expires_at": "2027-02-10T…Z", "model": "palm_subcenter" }
```

The token is the user's biometric template, sealed with AES-256-GCM. The server does not keep
a copy.

## `POST /v1/verify`

```json
{
  "consent": { "version": "2026-11-demo-4", "accepted": true, "items": ["processing", "age_own_hand", "residency"] },
  "token": "pdm1.k1.…",
  "rois": ["<base64>", "<base64>", "<base64>"],
  "share_stats": false
}
```

Response: `{ "match": true }`. Only a yes/no answer: the similarity score is not exposed.

When the user opts in (`"share_stats": true`), the request may include
`client: { os, device, camera, resolution }`. The server stores the result, a rounded score,
days since enrollment, those device categories and the country derived from the IP at request
time. **The IP, the token and the images are never stored.**

## `POST /v1/stats/capture-fail`

`{ consent, share_stats: true, reason, mode, client }`, with
`reason` ∈ `no_hand | back | side | out_of_frame | unstable` and `mode` ∈ `enroll | verify`.
Records why a capture failed on the phone, without images. Answers `204`.

## `GET /v1/health`

Returns `{ status, model, model_id, frames }`.

## Errors

| code | `result.error` | When |
|---|---|---|
| 400 | `consent_required` | Consent missing, not accepted, a declaration missing, or an outdated version |
| 400 | `bad_json` / `token_required` | Malformed request |
| 401 | `token_invalid` | The token was tampered with, sealed with another key or is garbage |
| 409 | `token_expired` / `token_model_mismatch` | The token expired or the model changed: enroll again |
| 413 | `too_large` | Body larger than 1 MB |
| 422 | `bad_roi` | Wrong number of frames, a size other than 224×224, or a blank image |
| 429 | `rate_limited` | Too many attempts per IP or per token |
| 451 | `region_blocked` | The demo is not available in the caller's region |

## Security model

- **Sealed templates.** AES-256-GCM with a random IV. The prefix and key id are bound as
  additional authenticated data. The token embeds the model id (first 8 bytes of the model's
  SHA-256), so a token from another model fails with `409` instead of producing a false match.
  Tokens expire and keys can be rotated.
- **Anti-probing.**
  - Yes/no answers only.
  - Rate limits per IP and per token.
  - Blank images are rejected.
  - Exactly three frames per request.
  - Bounded concurrent inferences.
- **No residue.** ROI and embedding buffers are zeroed after use. Logs never contain request
  bodies or tokens, and every API response is sent with `Cache-Control: no-store`.
- **Strict page policy.** The page loads everything from its own origin under a strict
  Content Security Policy, with camera access limited to the site itself.
