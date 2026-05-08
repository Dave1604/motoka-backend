# Mo AI — Mobile Integration Guide

Everything you need to add Mo to the Motoka mobile app.

---

## Credentials

| Key | Value |
|-----|-------|
| **Backend API Base URL** | `https://api.motoka.ng/api` |
| **Supabase URL** | `https://ucvnkouowpghnffvxrnb.supabase.co` |
| **Supabase Anon Key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdm5rb3Vvd3BnaG5mZnZ4cm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NjI4NzYsImV4cCI6MjA4MzIzODg3Nn0.AYDoUqwAKyceXYJeXycYTEwgHqDul6ynImrlUbtYnx8` |

> The **Supabase Anon Key** is the public client key — safe to embed in the app.
> Never expose the OpenAI key or Supabase Service Role key — those are backend-only secrets.

---

## Authentication

Mo requires a logged-in user. Use the Supabase SDK to sign in and get a session token, then pass it as a Bearer token on every request.

```
Authorization: Bearer <supabase_access_token>
```

The access token is available from `supabase.auth.getSession()` after the user logs in.

---

## Mo Chat Endpoint

```
POST https://api.motoka.ng/api/mo/chat
Content-Type: application/json
Authorization: Bearer <access_token>
```

### Request Body

```json
{
  "messages": [
    { "role": "user", "content": "What documents do I need to drive in Nigeria?" }
  ],
  "userName": "Dave",
  "userProfile": {
    "email": "user@email.com",
    "phone": "08012345678",
    "memberSince": "2024-01-15T00:00:00Z"
  },
  "cars": [
    {
      "vehicle_make": "Toyota",
      "vehicle_model": "Camry",
      "vehicle_year": 2015,
      "registration_no": "LND-123AB",
      "expiry_date": "2026-08-10"
    }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `messages` | array | Yes | Full conversation history. Each item has `role` (`"user"` or `"assistant"`) and `content` (string). Keep appending to this array as the conversation continues. |
| `userName` | string | No | User's first name. Mo uses it to personalise the greeting. |
| `userProfile` | object | No | `email`, `phone`, `memberSince`. Pass whatever you have. |
| `cars` | array | No | User's registered vehicles. Mo uses this to give car-specific advice. Pass the full list from your cars API. |

### Response

```json
{
  "success": true,
  "reply": "You need 5 documents to drive legally in Nigeria:\n1. Vehicle Licence\n2. Proof of Ownership\n3. Hackney Permit (if commercial)\n4. Motor Insurance Certificate\n5. Road Worthiness Certificate",
  "action": {
    "label": "Renew Now",
    "route": "/licenses/renew"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `success` | boolean | `true` on success, `false` on error |
| `reply` | string | Plain text. No markdown, no bold, no asterisks. Safe to display directly. |
| `action` | object \| null | CTA button Mo wants you to show. `null` when no navigation is needed. |
| `action.label` | string | Button text, e.g. `"Renew Now"` |
| `action.route` | string | Web route path — map to your mobile screen (see table below) |

---

## Action Route → Mobile Screen Mapping

When `action` is not null, show a button labelled `action.label` that navigates to the equivalent screen.

| `action.route` | Screen |
|----------------|--------|
| `/licenses/renew` | Renewal / Document Renewal screen |
| `/licenses/plate-number` | Plate Number screen |
| `/licenses/drivers-license` | Driver's Licence screen |
| `/garage` | Garage / My Cars screen |
| `/settings` | Settings (Auto-Renewal section) |
| `/ladipo` | Ladipo Marketplace screen |
| `/documents` | My Documents screen |
| `/dashboard` | Home / Dashboard screen |

---

## Conversation History

Mo is stateless — you manage history on the client. After each exchange, append both the user message and Mo's reply to the `messages` array before sending the next request.

```
// Turn 1
messages: [
  { role: "user", content: "How do I renew my car papers?" }
]

// After response, for Turn 2:
messages: [
  { role: "user",      content: "How do I renew my car papers?" },
  { role: "assistant", content: "<Mo's reply from Turn 1>" },
  { role: "user",      content: "How much does it cost?" }
]
```

To start a new conversation, send `messages` with only the new user message (clear the history).

---

## Error Handling

| HTTP Status | Meaning | What to do |
|-------------|---------|------------|
| `400` | `messages` array missing or empty | Check request body |
| `401` | Token missing or expired | Re-authenticate the user |
| `429` | Rate limit hit | Show "please wait a moment" and retry after a few seconds |
| `502` | OpenAI downstream error | Show "Mo is unavailable right now, try again shortly" |
| `500` | Server error | Same as 502 |

On any non-`200`, `success` will be `false` and `message` will contain a readable error string.

---

## Quick Actions (Suggested Prompts)

These are the pre-built prompts shown when the chat opens. Recommended to implement the same in mobile:

| Label | Sends as message |
|-------|-----------------|
| Check my expiry | `"Check my expiry"` |
| How do I renew? | `"How do I renew?"` |
| Traffic fines in Nigeria | `"Traffic fines in Nigeria"` |
| Car maintenance tips | `"Car maintenance tips"` |
| Documents I need | `"Documents I need"` |
| Driver's licence | `"Driver's licence"` |

---

## Notes

- **Mo knows Nigerian context**: FRSC/LASTMA fines, road conditions, popular Nigerian car specs, service intervals adjusted for Nigerian heat and roads. No need to add any of this on the client side.
- **Plain text replies**: Mo is instructed never to use markdown. You can display `reply` directly in a `Text` component without any markdown parser.
- **Numbered lists**: Mo formats lists as `1. item\n2. item\n3. item` — render line breaks and you're done.
- **Rate limit**: Mo has server-side rate limiting. No extra throttling needed on the client.
- **Language**: Mo automatically responds in the same language the user writes in (English or Pidgin English).
