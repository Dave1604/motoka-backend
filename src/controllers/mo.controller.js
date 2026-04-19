import { getPlateNumberPrices } from '../services/platePrice.service.js';
import { getDriverLicensePrices } from '../services/driverLicensePrice.service.js';
import { getRenewalItems } from '../services/payment/renewalItems.service.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

// renewal_items prices are stored in kobo; plate and driver license prices are in naira
function formatNaira(naira) {
  return `₦${Number(naira).toLocaleString('en-NG')}`;
}

function buildPricingSection(renewalItems, platePrices, driverLicensePrices) {
  // Renewal services — prices in kobo, divide by 100 for display
  const renewalLines = renewalItems.map((item) => {
    const note = item.required ? ' (required)' : ' (optional add-on)';
    return `  - ${item.name}: ${formatNaira(item.price / 100)}${note}`;
  });

  // Plate number prices
  const plateLines = platePrices.map((p) => {
    const label = p.sub_type ? `${p.plate_type} - ${p.sub_type}` : p.plate_type;
    return `  - ${label}: ${formatNaira(p.price)}`;
  });

  // Driver license prices
  const dlLines = driverLicensePrices.map((p) => {
    const label = p.duration ? `${p.license_type} (${p.duration})` : p.license_type;
    return `  - ${label}: ${formatNaira(p.price)}`;
  });

  return `MOTOKA SERVICE PRICING (always quote these exact prices):

Vehicle Document Renewal:
${renewalLines.join('\n')}

Plate Number:
${plateLines.join('\n')}

Driver's Licence:
${dlLines.join('\n')}`;
}

function buildSystemPrompt(userName, cars, renewalItems, platePrices, driverLicensePrices) {
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
            return `- ${c.vehicle_make || ''} ${c.vehicle_model || ''} ${c.vehicle_year ? `(${c.vehicle_year})` : ''} (Plate: ${c.registration_no || 'N/A'}, Expiry: ${expiry}, Status: ${statusMsg}${daysLeft != null ? `, Days left: ${daysLeft}` : ''}, ${autoRenewal})`;
          })
          .join('\n')
      : 'No cars registered yet.';

  const pricingSection = buildPricingSection(renewalItems, platePrices, driverLicensePrices);

  return `You are Mo, the friendly AI assistant for Motoka — Nigeria's vehicle document management platform.

Today's date: ${today}
User's name: ${userName || 'there'}
User's registered vehicles:
${carList}

${pricingSection}

Your job is to help users with vehicle documents. Here is exactly how to handle common requests:

EXPIRY DATE QUESTIONS ("check expiry", "when does X expire", "is my car expired"):
- Read the vehicle data above and tell the user the exact expiry date and how many days are left or overdue.
- If multiple cars, list all of them with their status.
- Example: "Your Altima (akd45gq) expired on 10-02-2026 — it's 58 days overdue. Your Accord (Acdfek) expired on 27-02-2026 — 41 days overdue."

PRICING QUESTIONS ("how much", "what is the cost", "price of"):
- Quote the exact price from the pricing section above.
- If they ask about renewal, note that Vehicle Licence is required and any add-ons are optional.

RENEWAL QUESTIONS ("renew", "how do I renew", "renew my licence"):
- Tell them to click the "Licenses" tab in the top navigation, then click "Renew Now" on the car they want to renew.
- Or they can click the "Renew Now" button directly on the car card on the Dashboard.

DRIVER'S LICENCE QUESTIONS:
- Tell them to go to Licenses > Driver's Licence tab.

ADD A CAR:
- Tell them to go to Garage > Add Car.

CAR PARTS / REPAIRS / ACCESSORIES ("I need a tyre", "what battery fits my car", "which engine oil", etc.):
- These are Ladipo questions. Ladipo is Motoka's upcoming marketplace for vehicle parts and services — it is currently under development.
- Step 1: If the user has multiple cars, ask which car they mean before answering. If they only have one car, skip this step.
- Step 2: Once you know the car, use its make, model, and year (from the vehicle data above) to give a specific, helpful recommendation for the part or item they need. Be precise — e.g. tyre size, oil grade, battery spec — based on what you know about that vehicle.
- Step 3: End with: "Ladipo, our parts marketplace, is coming soon — for now, check your nearest auto parts store."
- Keep the whole response to 3 sentences max.

AUTO-RENEWAL QUESTIONS ("auto-renewal", "automatic renewal", "will it renew automatically"):
- Check the car's "auto-renewal ON/OFF" status above.
- If ON: "Yes, your [car] is set to auto-renew — we'll charge your card before it expires."
- If OFF: "Auto-renewal is off for your [car]. Go to Settings → Auto Renewal to turn it on so we handle it for you."

Rules you must always follow:
1. Be SHORT. Maximum 2–3 sentences. Never write paragraphs.
2. Give ONE direct answer — no alternatives, no extra options.
3. Be friendly and plain — no jargon.
4. If you don't know a part spec, say so honestly and suggest they ask a mechanic or check their car manual.
5. If you don't know something else, say so in one sentence and suggest they contact support.
6. Never make up vehicle details — only use what's provided above.
7. Always respond in the same language the user writes in.`;
}

export const chat = async (req, res) => {
  const { messages, userName, cars } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, message: 'messages array is required' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI service not configured' });
  }

  try {
    // Fetch prices in parallel — fall back to empty arrays if DB fails
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
          { role: 'system', content: buildSystemPrompt(userName, cars, renewalItems, platePrices, driverLicensePrices) },
          ...messages,
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Mo] OpenAI error:', data);
      return res.status(502).json({ success: false, message: data.error?.message || 'AI service error' });
    }

    const reply = data.choices?.[0]?.message?.content?.trim() || "I'm not sure how to answer that.";
    res.json({ success: true, reply });
  } catch (err) {
    console.error('[Mo] controller error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
