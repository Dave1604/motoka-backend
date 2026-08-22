import { GoogleGenerativeAI } from '@google/generative-ai';
import { logError, logInfo } from '../utils/logger.js';
import fs from 'fs';

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
3. vehicleMake: use the proper brand name, e.g. "Toyota", "Honda", "Mercedes-Benz". Null if not visible.
4. vehicleModel: the model name only, e.g. "Camry", "Corolla", "C300". Null if not visible.
5. vehicleYear: exactly 4 digits e.g. "2019". Null if not on the document.
6. vehicleColor: one word, e.g. "Black", "Silver", "White". Null if not visible.
7. registrationNo: the plate number exactly as it appears, e.g. "KUJ-443-AJ". Null if not visible.
8. chassisNo: the VIN / chassis number as printed. Null if not visible.
9. engineNo: the engine number as printed. Null if not visible.
10. expiryDate / dateIssued: convert any date format to YYYY-MM-DD. Null if the date is not present.
11. carType: "private" if the document says Private, "commercial" if Commercial. Null if unclear.
12. ownerName: full name as printed. Null if not visible.
13. address: full address as printed. Null if not visible.`;

export async function extractDocument(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      status: false,
      message: 'AI document extraction is not configured on this server.',
    });
  }

  if (!req.file) {
    return res.status(400).json({ status: false, message: 'No image file provided.' });
  }

  let fileBuffer;
  try {
    if (req.file.buffer) {
      fileBuffer = req.file.buffer;
    } else if (req.file.path) {
      fileBuffer = fs.readFileSync(req.file.path);
    } else {
      return res.status(400).json({ status: false, message: 'Could not read uploaded file.' });
    }
  } catch (err) {
    logError('extractDocument: failed to read file', err);
    return res.status(400).json({ status: false, message: 'Could not read uploaded file.' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const mimeType = req.file.mimetype || 'image/jpeg';
    const base64 = fileBuffer.toString('base64');

    const result = await model.generateContent([
      EXTRACT_PROMPT,
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
    ]);

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

    // Sanitise: ensure every expected key exists and nullify empty strings
    const EXPECTED_KEYS = [
      'ownerName', 'address', 'vehicleMake', 'vehicleModel', 'vehicleYear',
      'vehicleColor', 'registrationNo', 'chassisNo', 'engineNo',
      'expiryDate', 'dateIssued', 'carType',
    ];

    const data = {};
    const fieldsFound = [];

    for (const key of EXPECTED_KEYS) {
      const raw = extracted[key];
      const value = (typeof raw === 'string' && raw.trim() !== '') ? raw.trim() : null;
      data[key] = value;
      if (value !== null) fieldsFound.push(key);
    }

    logInfo('extractDocument: success', { fieldsFound });

    // Clean up temp file if disk storage was used
    if (req.file.path) {
      fs.unlink(req.file.path, () => {});
    }

    return res.json({ status: true, data, fieldsFound });
  } catch (err) {
    logError('extractDocument: Gemini API error', err);

    if (req.file?.path) fs.unlink(req.file.path, () => {});

    return res.status(500).json({
      status: false,
      message: 'Failed to analyse the document. Please try again with a clearer image.',
    });
  }
}
