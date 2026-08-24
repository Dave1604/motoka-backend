import { GoogleGenerativeAI } from '@google/generative-ai';
import { logError, logInfo } from '../utils/logger.js';

const GEMINI_TIMEOUT_MS = 30_000;

// Module-level singleton — created once, reused across all requests
let _model = null;
function getModel() {
  if (_model) return _model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  _model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
  return _model;
}

const EXTRACT_PROMPT = `You are an expert document reader specialising in Nigerian vehicle registration documents.

Carefully analyse the image provided and extract ONLY the information that is CLEARLY and EXPLICITLY visible. 

Return a single valid JSON object with exactly these keys:
{
  "ownerName": string or null,
  "address": string or null,
  "vehicleMake": string or null,
  "vehicleModel": string or null,
  "vehicleYear": string (4 digits) or null,
  "vehicleColor": string or null,
  "registrationNo": string or null,
  "chassisNo": string or null,
  "engineNo": string or null,
  "expiryDate": string (YYYY-MM-DD) or null,
  "dateIssued": string (YYYY-MM-DD) or null,
  "carType": "private" or "commercial" or null
}

STRICT RULES — follow every one:
1. If a field is NOT clearly readable in the document, return null for that field. NEVER guess or infer.
2. Return ONLY the raw JSON object — no markdown, no explanation, no code fences.
3. vehicleMake: use the proper brand name with correct casing, e.g. "Toyota", "Honda", "Mercedes-Benz". Null if not visible.
4. vehicleModel: the model name only, e.g. "Camry", "Corolla", "C300". Null if not visible.
5. vehicleYear: exactly 4 digits e.g. "2019". Null if not on the document.
6. vehicleColor: one word, Title Case, e.g. "Black", "Silver", "White". Null if not visible.
7. registrationNo: the plate number exactly as it appears, e.g. "KUJ-443-AJ". Null if not visible.
8. chassisNo: the VIN / chassis number as printed. Null if not visible.
9. engineNo: the engine number as printed. Null if not visible.
10. expiryDate / dateIssued: convert any date format to YYYY-MM-DD. Null if the date is not present.
11. carType: return lowercase "private" if the document says Private/Personal, "commercial" if Commercial/Truck/Bus. Null if unclear.
12. ownerName: full name as printed. Null if not visible.
13. address: full address as printed. Null if not visible.`;

const EXPECTED_KEYS = [
  'ownerName', 'address', 'vehicleMake', 'vehicleModel', 'vehicleYear',
  'vehicleColor', 'registrationNo', 'chassisNo', 'engineNo',
  'expiryDate', 'dateIssued', 'carType',
];

function sanitiseExtracted(raw) {
  const data = {};
  const fieldsFound = [];

  for (const key of EXPECTED_KEYS) {
    let value = raw[key];

    // Reject anything that isn't a non-empty string
    if (typeof value !== 'string' || value.trim() === '') {
      data[key] = null;
      continue;
    }

    value = value.trim();

    // Normalise carType to lowercase enum
    if (key === 'carType') {
      const lower = value.toLowerCase();
      value = (lower === 'commercial') ? 'commercial' : 'private';
    }

    // Normalise vehicleColor to Title Case
    if (key === 'vehicleColor') {
      value = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    }

    // Normalise vehicleMake to Title Case if all-caps (e.g. "TOYOTA" → "Toyota")
    if (key === 'vehicleMake' && value === value.toUpperCase()) {
      value = value.charAt(0) + value.slice(1).toLowerCase();
    }

    data[key] = value;
    fieldsFound.push(key);
  }

  return { data, fieldsFound };
}

export async function extractDocument(req, res) {
  const model = getModel();

  if (!model) {
    return res.status(503).json({
      status: false,
      message: 'AI document extraction is not configured on this server.',
    });
  }

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ status: false, message: 'No image file provided.' });
  }

  try {
    const mimeType = req.file.mimetype || 'image/jpeg';
    const base64 = req.file.buffer.toString('base64');

    // Race Gemini against a hard timeout
    const geminiPromise = model.generateContent([
      EXTRACT_PROMPT,
      { inlineData: { mimeType, data: base64 } },
    ]);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), GEMINI_TIMEOUT_MS)
    );

    const result = await Promise.race([geminiPromise, timeoutPromise]);
    const rawText = result.response.text().trim();

    // Strip markdown code fences if model wrapped the JSON
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let extracted;
    try {
      extracted = JSON.parse(jsonText);
    } catch {
      logError('extractDocument: Gemini returned non-JSON', { rawText });
      return res.status(422).json({
        status: false,
        message: 'AI returned an unreadable response. Please try a clearer image.',
      });
    }

    const { data, fieldsFound } = sanitiseExtracted(extracted);

    logInfo('extractDocument: success', { fieldsFound });

    return res.json({ status: true, data, fieldsFound });
  } catch (err) {
    if (err.message === 'TIMEOUT') {
      logError('extractDocument: Gemini timed out');
      return res.status(504).json({
        status: false,
        message: 'The AI took too long to respond. Please try again.',
      });
    }
    logError('extractDocument: Gemini API error', err);
    return res.status(500).json({
      status: false,
      message: 'Failed to analyse the document. Please try again.',
    });
  }
}
