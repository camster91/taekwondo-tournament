// Default weight class configurations
export interface WeightClassConfig {
  name: string;
  gender: 'M' | 'F' | null; // null = both
  ageMin: number;
  ageMax: number;
  weightMinLbs: number;
  weightMaxLbs: number;
}

// Default weight classes based on observed data
export const DEFAULT_WEIGHT_CLASSES: WeightClassConfig[] = [
  // Males 4-5 (usually no weight class split)

  // Males 6-7
  { name: 'Light', gender: 'M', ageMin: 6, ageMax: 7, weightMinLbs: 0, weightMaxLbs: 50 },
  { name: 'Middle', gender: 'M', ageMin: 6, ageMax: 7, weightMinLbs: 50, weightMaxLbs: 65 },
  { name: 'Heavy', gender: 'M', ageMin: 6, ageMax: 7, weightMinLbs: 65, weightMaxLbs: 999 },

  // Males 8-9
  { name: 'Light', gender: 'M', ageMin: 8, ageMax: 9, weightMinLbs: 0, weightMaxLbs: 55 },
  { name: 'Middle', gender: 'M', ageMin: 8, ageMax: 9, weightMinLbs: 55, weightMaxLbs: 75 },
  { name: 'Heavy', gender: 'M', ageMin: 8, ageMax: 9, weightMinLbs: 75, weightMaxLbs: 999 },

  // Males 10-11
  { name: 'Light', gender: 'M', ageMin: 10, ageMax: 11, weightMinLbs: 0, weightMaxLbs: 70 },
  { name: 'Middle', gender: 'M', ageMin: 10, ageMax: 11, weightMinLbs: 70, weightMaxLbs: 90 },
  { name: 'Heavy', gender: 'M', ageMin: 10, ageMax: 11, weightMinLbs: 90, weightMaxLbs: 999 },

  // Males 12-14
  { name: 'Feather', gender: 'M', ageMin: 12, ageMax: 14, weightMinLbs: 0, weightMaxLbs: 80 },
  { name: 'Light', gender: 'M', ageMin: 12, ageMax: 14, weightMinLbs: 80, weightMaxLbs: 100 },
  { name: 'Middle', gender: 'M', ageMin: 12, ageMax: 14, weightMinLbs: 100, weightMaxLbs: 130 },
  { name: 'Heavy', gender: 'M', ageMin: 12, ageMax: 14, weightMinLbs: 130, weightMaxLbs: 999 },

  // Males 15-17
  { name: 'Light', gender: 'M', ageMin: 15, ageMax: 17, weightMinLbs: 0, weightMaxLbs: 130 },
  { name: 'Middle', gender: 'M', ageMin: 15, ageMax: 17, weightMinLbs: 130, weightMaxLbs: 160 },
  { name: 'Heavy', gender: 'M', ageMin: 15, ageMax: 17, weightMinLbs: 160, weightMaxLbs: 999 },

  // Males 18-35
  { name: 'Light', gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 0, weightMaxLbs: 150 },
  { name: 'Middle', gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 150, weightMaxLbs: 180 },
  { name: 'Heavy', gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 180, weightMaxLbs: 999 },

  // Males 36+
  { name: 'Light', gender: 'M', ageMin: 36, ageMax: 99, weightMinLbs: 0, weightMaxLbs: 160 },
  { name: 'Middle', gender: 'M', ageMin: 36, ageMax: 99, weightMinLbs: 160, weightMaxLbs: 190 },
  { name: 'Heavy', gender: 'M', ageMin: 36, ageMax: 99, weightMinLbs: 190, weightMaxLbs: 999 },

  // Females 6-7
  { name: 'Light', gender: 'F', ageMin: 6, ageMax: 7, weightMinLbs: 0, weightMaxLbs: 45 },
  { name: 'Middle', gender: 'F', ageMin: 6, ageMax: 7, weightMinLbs: 45, weightMaxLbs: 55 },
  { name: 'Heavy', gender: 'F', ageMin: 6, ageMax: 7, weightMinLbs: 55, weightMaxLbs: 999 },

  // Females 8-9
  { name: 'Light', gender: 'F', ageMin: 8, ageMax: 9, weightMinLbs: 0, weightMaxLbs: 50 },
  { name: 'Middle', gender: 'F', ageMin: 8, ageMax: 9, weightMinLbs: 50, weightMaxLbs: 65 },
  { name: 'Heavy', gender: 'F', ageMin: 8, ageMax: 9, weightMinLbs: 65, weightMaxLbs: 999 },

  // Females 10-11
  { name: 'Light', gender: 'F', ageMin: 10, ageMax: 11, weightMinLbs: 0, weightMaxLbs: 60 },
  { name: 'Middle', gender: 'F', ageMin: 10, ageMax: 11, weightMinLbs: 60, weightMaxLbs: 80 },
  { name: 'Heavy', gender: 'F', ageMin: 10, ageMax: 11, weightMinLbs: 80, weightMaxLbs: 999 },

  // Females 12-14
  { name: 'Light', gender: 'F', ageMin: 12, ageMax: 14, weightMinLbs: 0, weightMaxLbs: 90 },
  { name: 'Middle', gender: 'F', ageMin: 12, ageMax: 14, weightMinLbs: 90, weightMaxLbs: 115 },
  { name: 'Heavy', gender: 'F', ageMin: 12, ageMax: 14, weightMinLbs: 115, weightMaxLbs: 999 },

  // Females 15-17
  { name: 'Light', gender: 'F', ageMin: 15, ageMax: 17, weightMinLbs: 0, weightMaxLbs: 110 },
  { name: 'Middle', gender: 'F', ageMin: 15, ageMax: 17, weightMinLbs: 110, weightMaxLbs: 135 },
  { name: 'Heavy', gender: 'F', ageMin: 15, ageMax: 17, weightMinLbs: 135, weightMaxLbs: 999 },

  // Females 18-35
  { name: 'Light', gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 0, weightMaxLbs: 120 },
  { name: 'Middle', gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 120, weightMaxLbs: 145 },
  { name: 'Heavy', gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 145, weightMaxLbs: 999 },

  // Females 36+
  { name: 'Light', gender: 'F', ageMin: 36, ageMax: 99, weightMinLbs: 0, weightMaxLbs: 130 },
  { name: 'Middle', gender: 'F', ageMin: 36, ageMax: 99, weightMinLbs: 130, weightMaxLbs: 155 },
  { name: 'Heavy', gender: 'F', ageMin: 36, ageMax: 99, weightMinLbs: 155, weightMaxLbs: 999 },
];

export function getWeightClass(
  weight: number,
  age: number,
  gender: 'M' | 'F',
  weightClasses: WeightClassConfig[] = DEFAULT_WEIGHT_CLASSES
): string | null {
  const applicable = weightClasses.find(
    (wc) =>
      (wc.gender === null || wc.gender === gender) &&
      age >= wc.ageMin &&
      age <= wc.ageMax &&
      weight >= wc.weightMinLbs &&
      weight < wc.weightMaxLbs
  );

  return applicable?.name || null;
}
