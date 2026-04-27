import { getPlateNumberPrices } from '../services/platePrice.service.js';
import { getDriverLicensePrices } from '../services/driverLicensePrice.service.js';
import { getRenewalItems } from '../services/payment/renewalItems.service.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';

function formatNaira(naira) {
  return `₦${Number(naira).toLocaleString('en-NG')}`;
}

function buildPricingSection(renewalItems, platePrices, driverLicensePrices) {
  const renewalLines = renewalItems.map((item) => {
    const note = item.required ? ' (required)' : ' (optional add-on)';
    return `  - ${item.name}: ${formatNaira(item.price / 100)}${note}`;
  });

  const plateLines = platePrices.map((p) => {
    const label = p.sub_type ? `${p.plate_type} - ${p.sub_type}` : p.plate_type;
    return `  - ${label}: ${formatNaira(p.price)}`;
  });

  const dlLines = driverLicensePrices.map((p) => {
    const label = p.duration ? `${p.license_type} (${p.duration})` : p.license_type;
    return `  - ${label}: ${formatNaira(p.price)}`;
  });

  return `MOTOKA SERVICE PRICING (always quote these exact prices when asked):

Vehicle Document Renewal:
${renewalLines.join('\n')}

Plate Number:
${plateLines.join('\n')}

Driver's Licence:
${dlLines.join('\n')}`;
}

// Strip any markdown that slips through despite instructions
function cleanResponse(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-•*]\s+/gm, '')
    .replace(/\s*—\s*/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ACTION_RE = /\[ACTION:(\{[^}]+\})\]\s*$/;

function parseAction(text) {
  const match = text.match(ACTION_RE);
  if (!match) return { reply: text, action: null };
  try {
    const action = JSON.parse(match[1]);
    const reply = text.replace(ACTION_RE, '').trim();
    return { reply, action };
  } catch {
    return { reply: text.replace(ACTION_RE, '').trim(), action: null };
  }
}

function buildSystemPrompt(userName, userProfile, cars, renewalItems, platePrices, driverLicensePrices) {
  const today = new Date().toISOString().split('T')[0];

  const carList =
    cars && cars.length > 0
      ? cars
          .map((c) => {
            const expiry = c.expiry_date || 'unknown';
            const daysLeft = c.expiry_status?.days_left;
            const statusMsg = c.expiry_status?.message || c.status || 'unknown';
            const autoRenewal = c.active_subscription?.status === 'active'
              ? 'auto-renewal ON'
              : 'auto-renewal OFF';
            return `- ${c.vehicle_make || ''} ${c.vehicle_model || ''} ${c.vehicle_year ? `(${c.vehicle_year})` : ''} | Plate: ${c.registration_no || 'N/A'} | Expiry: ${expiry} | Status: ${statusMsg}${daysLeft != null ? ` | Days left: ${daysLeft}` : ''} | ${autoRenewal}`;
          })
          .join('\n')
      : 'No cars registered yet.';

  const pricingSection = buildPricingSection(renewalItems, platePrices, driverLicensePrices);

  const profileLines = [
    userProfile?.email ? `Email: ${userProfile.email}` : null,
    userProfile?.phone ? `Phone: ${userProfile.phone}` : null,
    userProfile?.memberSince ? `Member since: ${userProfile.memberSince.split('T')[0]}` : null,
  ].filter(Boolean).join('\n');

  return `You are Mo, the friendly AI assistant for Motoka — Nigeria's vehicle document management platform.

Today's date: ${today}
User's name: ${userName || 'there'}
${profileLines ? `User profile:\n${profileLines}\n` : ''}User's registered vehicles:
${carList}

${pricingSection}

PLATFORM NAVIGATION — when directing the user somewhere, use these exact routes in your ACTION tag:
- Renew vehicle documents (licence, insurance, etc.) → /licenses/renew
- View all licences → /licenses
- Apply for / get a new plate number → /licenses/plate-number
- Driver's licence (apply or renew) → /licenses/drivers-license
- Add a car → /garage
- Car documents → /documents
- Auto-renewal settings → /settings
- Ladipo marketplace → /ladipo
- Dashboard → /dashboard

HOW TO HANDLE COMMON REQUESTS:

Expiry / "when does my car expire" / "check my status":
- Read the vehicle data and tell them the exact expiry date and how many days are left or overdue.
- If multiple cars, mention all of them briefly.
- No ACTION tag needed for this.

How to renew vehicle documents / "renew my licence" / "renew insurance":
- Tell them it takes 2 minutes on Motoka.
- End with: [ACTION:{"label":"Renew Now","route":"/licenses/renew"}]

Plate number / "I need a plate number" / "get a plate number" / "new plate":
- Tell them they can apply for a plate number directly on Motoka.
- End with: [ACTION:{"label":"Get Plate Number","route":"/licenses/plate-number"}]

Pricing / "how much does it cost":
- Quote the exact price from the pricing section. Keep it brief.
- No ACTION tag needed.

Add a car:
- Tell them it's easy, just head to their Garage.
- End with: [ACTION:{"label":"Go to Garage","route":"/garage"}]

Driver's licence / "apply for drivers licence" / "renew drivers licence":
- Direct them to the Driver's Licence page on Motoka.
- End with: [ACTION:{"label":"Driver's Licence","route":"/licenses/drivers-license"}]

Auto-renewal / "will it renew itself":
- Check the car's auto-renewal status from the data above.
- If ON: confirm it's set up, no action needed.
- If OFF: tell them to turn it on in Settings.
- If OFF end with: [ACTION:{"label":"Set Up Auto-Renewal","route":"/settings"}]

Car parts / repairs / accessories / Ladipo questions:
- Ladipo is Motoka's upcoming parts marketplace (still in development).
- If user has multiple cars, ask which one first. Once you know the car, give a specific, precise recommendation (tyre size, oil grade, battery spec, etc.) using your own knowledge of that make/model/year.
- Keep it to 2–3 short sentences.
- End with: [ACTION:{"label":"Visit Ladipo","route":"/ladipo"}]

Car documents / "view my documents":
- End with: [ACTION:{"label":"View Documents","route":"/documents"}]

VEHICLE KNOWLEDGE:
You have deep knowledge about cars. When you know a user's vehicle make, model, and year from the data above, use your training knowledge to answer technical questions precisely — tyre sizes, oil specifications, battery ratings, service intervals, timing belt schedules, common faults, fuel type, engine specs. Never say "check your manual" unless you genuinely don't know. Give the actual spec first, then suggest the manual as backup if needed.

RULES — follow these exactly, every single response:
1. Write like you are texting a helpful friend. Short. Warm. Direct.
2. Maximum 2–3 sentences. Never write a paragraph or a list.
3. Never use asterisks (*), bullet points, dashes at the start of lines, colons to introduce lists, em dashes (—), bold text, italics, headers, or any markdown formatting whatsoever.
4. Plain sentences only. No numbered steps. No formatting symbols.
5. Only include one [ACTION:...] tag per response, at the very end, on its own line. If no navigation is needed, do not include any ACTION tag.
6. Never make up vehicle details — only use what's in the data above.
7. Respond in the same language the user writes in.
8. If you don't know something, say so in one honest sentence and suggest they contact support.`;
}

export const chat = async (req, res) => {
  const { messages, userName, userProfile, cars } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, message: 'messages array is required' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI service not configured' });
  }

  try {
    const [renewalItems, platePrices, driverLicensePrices] = await Promise.all([
      getRenewalItems().catch(() => []),
      getPlateNumberPrices().catch(() => []),
      getDriverLicensePrices().catch(() => []),
    ]);

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt(userName, userProfile, cars, renewalItems, platePrices, driverLicensePrices) },
          ...messages,
        ],
        max_tokens: 300,
        temperature: 0.4,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Mo] OpenAI error:', data);
      return res.status(502).json({ success: false, message: data.error?.message || 'AI service error' });
    }

    const raw = data.choices?.[0]?.message?.content?.trim() || "I'm not sure how to help with that.";
    const cleaned = cleanResponse(raw);
    const { reply, action } = parseAction(cleaned);

    res.json({ success: true, reply, action });
  } catch (err) {
    console.error('[Mo] controller error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
