import { describe, it, expect } from '@jest/globals';
import {
  decodePartNumber,
  decodeFromText,
  extractPartNumbers,
  verifyExtraction,
  enrichExtractionWithOem,
} from '../../scripts/lib/ladipoFitmentVerify.js';
import { resolveModel, validateFitment } from '../../scripts/lib/vehicleCatalog.js';

describe('OEM part-number decode', () => {
  it('maps a Mercedes A167 number to GLE-Class', () => {
    const decoded = decodePartNumber('A1678204903');
    expect(decoded).toMatchObject({ make: 'Mercedes-Benz', model: 'GLE-Class', weak: false });
  });

  it('maps a Land Rover LR number', () => {
    expect(decodePartNumber('LR019830')).toMatchObject({ make: 'Land Rover', weak: false });
  });

  it('does not treat a 5+5 Toyota-style number as a veto', () => {
    expect(decodePartNumber('04465-33290')).toBeNull();
  });

  it('pulls the Mercedes number out of a messy title', () => {
    const decoded = decodeFromText('Mercedes Benz Rear Wiper Blade A1678204903 14Inch');
    expect(decoded.make).toBe('Mercedes-Benz');
    expect(decoded.model).toBe('GLE-Class');
  });

  it('extracts compact part numbers from free text', () => {
    const found = extractPartNumbers('Genuine MAF Sensor (LR019830)');
    expect(found).toContain('LR019830');
  });
});

describe('vehicle catalog referee', () => {
  it('accepts Toyota Camry 2015', () => {
    const result = validateFitment({ make: 'Toyota', model: 'Camry', year_min: 2012, year_max: 2017 });
    expect(result.ok).toBe(true);
    expect(result.value.make).toBe('Toyota');
    expect(result.value.model).toBe('Camry');
  });

  it('rejects a misspelled model', () => {
    const result = validateFitment({ make: 'Toyota', model: 'Cambry', year_min: 2015, year_max: 2018 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unknown_model/);
  });

  it('rejects a year after production ended', () => {
    const result = validateFitment({ make: 'Peugeot', model: '406', year_min: 2018, year_max: 2020 });
    expect(result.ok).toBe(false);
  });

  it('resolves garage aliases like Prado → Land Cruiser Prado', () => {
    expect(resolveModel('Toyota', 'Prado')?.name).toBe('Land Cruiser Prado');
  });
});

describe('verifyExtraction', () => {
  it('publishes a catalog-valid Camry claim', () => {
    const verdict = verifyExtraction({
      abstain: false,
      is_universal: false,
      confidence: 0.9,
      category_slug: 'spare-parts-brake-wheel-hub-bearings',
      fitment: [{ make: 'Toyota', model: 'Camry', year_min: 2012, year_max: 2017 }],
      reasoning: 'Title names Camry 2012-2017',
    }, { title: 'Bosch QuietCast Front Brake Pads Camry 2012-2017' });

    expect(verdict.status).toBe('published');
    expect(verdict.fitment.length).toBeGreaterThan(0);
    expect(verdict.fitment[0].make).toBe('Toyota');
  });

  it('stages an abstention', () => {
    const verdict = verifyExtraction({
      abstain: true,
      is_universal: false,
      confidence: 0.1,
      fitment: [],
      reasoning: 'No vehicle named',
    }, { title: 'Genuine MAF Sensor (226805RF0A)' });
    expect(verdict.status).toBe('staged');
  });

  it('rejects a Honda claim when the part number is Mercedes', () => {
    const verdict = verifyExtraction({
      abstain: false,
      is_universal: false,
      confidence: 0.9,
      part_number: 'A1678204903',
      category_slug: 'spare-parts-steering-parts',
      fitment: [{ make: 'Honda', model: 'Accord', year_min: 2013, year_max: 2017 }],
      reasoning: 'Guessed Accord',
    }, { title: 'Steering rack A1678204903' });
    expect(verdict.status).toBe('staged');
    expect(verdict.rejections.some((r) => r.startsWith('oem_make_conflict'))).toBe(true);
  });

  it('admits engine oil as universal when the category backs it up', () => {
    const verdict = verifyExtraction({
      abstain: false,
      is_universal: true,
      confidence: 0.95,
      category_slug: 'lubricants-fluids-engine-oil',
      fitment: [],
      reasoning: 'Engine oil is vehicle-agnostic',
    }, { title: 'Total Quartz 9000 5W-40 5L' });
    expect(verdict.status).toBe('universal');
  });

  it('does not let the model call a brake disc universal', () => {
    const verdict = verifyExtraction({
      abstain: false,
      is_universal: true,
      confidence: 0.9,
      category_slug: 'spare-parts-brake-wheel-hub-bearings',
      fitment: [{ make: 'Toyota', model: 'Camry', year_min: 2012, year_max: 2017 }],
      reasoning: 'Called it universal by mistake',
    }, { title: 'Bosch QuietCast Front Brake Pads Camry 2012-2017' });
    expect(verdict.status).toBe('published');
  });

  it('recovers Mercedes fitment from an OEM number after the extractor abstains', () => {
    const enriched = enrichExtractionWithOem(
      { title: 'Mercedes Benz Rear Wiper Blade A1678204903 14Inch' },
      { abstain: true, fitment: [], confidence: 0, reasoning: 'TIMEOUT' }
    );
    const verdict = verifyExtraction(enriched, {
      title: 'Mercedes Benz Rear Wiper Blade A1678204903 14Inch',
    });
    expect(verdict.status).toBe('published');
    expect(verdict.fitment.some((row) => row.model === 'GLE-Class' || row.model === 'GLE')).toBe(true);
  });
});
