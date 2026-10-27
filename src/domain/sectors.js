/**
 * Sector profiles let one platform serve very different workplaces:
 * the hazards a worker can report change, everything else stays the same.
 */
export const SECTORS = {
  construction: { name: 'Construction', hazards: ['fall', 'electrical', 'machinery', 'heat', 'fire', 'harassment', 'other'] },
  hospital: { name: 'Hospital', hazards: ['needle', 'biohazard', 'violence', 'chemical', 'slip', 'harassment', 'other'] },
  campus: { name: 'College campus', hazards: ['electrical', 'slip', 'fire', 'chemical', 'harassment', 'other'] },
  factory: { name: 'Factory', hazards: ['machinery', 'chemical', 'noise', 'fire', 'electrical', 'harassment', 'other'] },
};

/** Defaults follow Indian labour norms: 8h day, 48h week, overtime paid at twice the ordinary rate. */
export const LABOUR = {
  dailyHours: 8,
  weeklyHours: 48,
  overtimeMultiplier: 2,
  maxShiftHours: 10,
  minRestHours: 11,
  maxConsecutiveDays: 6,
};

export const LANGS = ['en', 'hi', 'ta', 'bn'];

export const categoriesFor = (sector) => [...SECTORS[sector].hazards, 'pay'];
