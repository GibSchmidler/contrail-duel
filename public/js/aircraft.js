// Countries and their fighters. Numbers come from public figures, scaled the same way for every
// jet so the comparisons hold: wing loading, thrust-to-weight, radar range, radar cross-section,
// sensors and weapons. Nothing is balanced on purpose; some jets are simply better.
//
// flight: game-scale values. mass = 0.875 x combat weight, S = 1.5 x wing area (the model adds
//   body lift through S), thrust = real thrust in newtons. tvc: thrust vectoring (0..1).
// rcs: frontal radar cross-section, m^2.   irst: passive infrared search-and-track range (m, 0 = none)
// irSig: infrared signature multiplier.     maws: missile approach warning fitted.
// hmd: helmet-mounted sight (lets high-off-boresight IR missiles lock far off the nose).
// ecm: self-protection jamming 0..1 (shortens enemy radar range, helps chaff).
// stations: [x, y, z, kind] in body coordinates, in right/left pairs. kind: tip | wing | body | bay.

export const COUNTRIES = {
  usa: { name: 'United States', short: 'USA', insignia: 'usa', blurb: 'Best sensors and missiles, the only fully mature stealth fighter, and AESA radars across the fleet. No IRST on most jets and limited missile-warning coverage.' },
  rus: { name: 'Russia', short: 'RUS', insignia: 'rus', blurb: 'Big, powerful, thrust-vectoring Flankers with huge radars and IRST. Missiles a step behind; the R-27ER needs your radar lock all the way to impact.' },
  chn: { name: 'China', short: 'CHN', insignia: 'chn', blurb: 'Modern AESA radars, the very long-range PL-15 and the agile PL-10. The J-20 is a capable stealth fighter, but it carries no gun.' },
  eur: { name: 'Europe', short: 'EUR', insignia: 'eur', blurb: 'Agile canard-delta fighters with excellent jamming, IRST and missile warning, and the ramjet Meteor: the hardest missile in the game to outrun.' },
};

const J = (o) => ({ gMin: -3, betaMax: 0.1, cyb: 0.9, brakeCd: 0.04, maxThrottle: 1.2, tvc: 0, wave: 0.022, k: 0.13, clA: 5.0, aStall: 0.42, aFbw: 0.43, ...o });

export const JETS = {
  // ======================= UNITED STATES =======================
  f16c: {
    code: 1, country: 'usa', name: 'F-16C Block 50', nick: 'Viper', rwr: 'F16',
    desc: 'Light, single-engine dogfighter with a bubble canopy and a 9 G airframe. Older mechanical radar, no IRST, no missile warning.',
    flight: J({ mass: 10500, S: 42, thrMil: 76000, thrAB: 129000, cd0: 0.015, gMax: 10, rollMax: 4.0 }),
    rcs: 1.2, radar: 'apg68', irst: 0, irSig: 1.0, maws: false, hmd: true, ecm: 0.1,
    gun: 'm61', ammo: 511, flares: 30, chaff: 30, size: 1.0,
    stations: [[4.95, 0, 2.0, 'tip'], [-4.95, 0, 2.0, 'tip'], [3.6, -0.35, 1.4, 'wing'], [-3.6, -0.35, 1.4, 'wing'], [2.4, -0.42, 0.9, 'wing'], [-2.4, -0.42, 0.9, 'wing']],
    loadouts: {
      air: { name: 'Air superiority', st: ['aim9x', 'aim9x', 'aim120', 'aim120', 'aim120', 'aim120'] },
      dogfight: { name: 'Dogfight', st: ['aim9x', 'aim9x', 'aim9x', 'aim9x', 'aim120', 'aim120'] },
    },
  },
  f15c: {
    code: 2, country: 'usa', name: 'F-15C Eagle', nick: 'Eagle', rwr: 'F15',
    desc: 'Big twin-engine air-superiority fighter. Huge wing, great climb and top speed, powerful AESA radar, eight missiles. Large radar target.',
    flight: J({ mass: 17700, S: 85, thrMil: 130000, thrAB: 211000, cd0: 0.016, gMax: 10, rollMax: 3.4, aFbw: 0.5, aStall: 0.44 }),
    rcs: 10, radar: 'apg63', irst: 0, irSig: 1.15, maws: false, hmd: true, ecm: 0.2,
    gun: 'm61', ammo: 940, flares: 30, chaff: 60, size: 1.25,
    stations: [[3.6, -0.15, 2.0, 'wing'], [-3.6, -0.15, 2.0, 'wing'], [2.75, -0.15, 1.8, 'wing'], [-2.75, -0.15, 1.8, 'wing'], [1.25, -1.05, -3.0, 'body'], [-1.25, -1.05, -3.0, 'body'], [1.25, -1.05, 3.2, 'body'], [-1.25, -1.05, 3.2, 'body']],
    loadouts: {
      air: { name: 'Air superiority', st: ['aim9x', 'aim9x', 'aim9x', 'aim9x', 'aim120d', 'aim120d', 'aim120d', 'aim120d'] },
      bvr: { name: 'Long range', st: ['aim9x', 'aim9x', 'aim120d', 'aim120d', 'aim120d', 'aim120d', 'aim120d', 'aim120d'] },
    },
  },
  fa18e: {
    code: 3, country: 'usa', name: 'F/A-18E Super Hornet', nick: 'Rhino', rwr: 'F18',
    desc: 'Carrier fighter with big leading-edge extensions: superb nose authority at high angle of attack, but draggy and short on thrust. AESA radar and an IRST pod.',
    flight: J({ mass: 18400, S: 70, thrMil: 124000, thrAB: 196000, cd0: 0.02, wave: 0.03, k: 0.12, clA: 5.3, aStall: 0.58, aFbw: 0.6, gMax: 8.5, rollMax: 3.2 }),
    rcs: 1.0, radar: 'apg79', irst: 32000, irSig: 1.1, maws: false, hmd: true, ecm: 0.25,
    gun: 'm61', ammo: 412, flares: 30, chaff: 30, size: 1.2,
    stations: [[6.85, 0, 2.6, 'tip'], [-6.85, 0, 2.6, 'tip'], [5.0, -0.3, 2.3, 'wing'], [-5.0, -0.3, 2.3, 'wing'], [3.4, -0.38, 1.8, 'wing'], [-3.4, -0.38, 1.8, 'wing'], [1.25, -1.3, 0.6, 'body'], [-1.25, -1.3, 0.6, 'body']],
    loadouts: {
      air: { name: 'Air superiority', st: ['aim9x', 'aim9x', 'aim120d', 'aim120d', null, null, 'aim120d', 'aim120d'] },
      heavy: { name: 'Heavy long range', st: ['aim9x', 'aim9x', 'aim120d', 'aim120d', 'aim120d', 'aim120d', 'aim120d', 'aim120d'] },
    },
  },
  f22a: {
    code: 4, country: 'usa', name: 'F-22A Raptor', nick: 'Raptor', rwr: 'F22', stealth: true,
    desc: 'Stealth air-dominance fighter. Enemy radars see it at about a tenth of their normal range, and its LPI radar barely registers on their warning receivers. Supercruise, thrust vectoring, internal weapons. No helmet sight.',
    flight: J({ mass: 23600, S: 117, thrMil: 232000, thrAB: 312000, cd0: 0.014, wave: 0.016, gMax: 10, rollMax: 3.6, aFbw: 0.7, aStall: 0.45, tvc: 0.7 }),
    rcs: 0.0002, rcsSide: 10, rcsRear: 6, radar: 'apg77', irst: 0, irSig: 0.7, maws: true, hmd: false, ecm: 0.15,
    gun: 'm61', ammo: 480, flares: 24, chaff: 24, size: 1.25,
    stations: [[1.95, -0.6, -2.0, 'bay'], [-1.95, -0.6, -2.0, 'bay'], [0.35, -0.85, -0.6, 'bay'], [-0.35, -0.85, -0.6, 'bay'], [0.7, -0.85, 0.9, 'bay'], [-0.7, -0.85, 0.9, 'bay'], [0.35, -0.85, 2.4, 'bay'], [-0.35, -0.85, 2.4, 'bay']],
    loadouts: {
      air: { name: 'Internal', st: ['aim9x', 'aim9x', 'aim120d', 'aim120d', 'aim120d', 'aim120d', 'aim120d', 'aim120d'] },
    },
  },

  // ======================= RUSSIA =======================
  mig29s: {
    code: 5, country: 'rus', name: 'MiG-29S', nick: 'Fulcrum', rwr: '29',
    desc: 'Agile twin-engine short-range fighter with an early helmet sight and an IRST. Weak radar with a wide notch, short legs, no missile warning.',
    flight: J({ mass: 13100, S: 57, thrMil: 100000, thrAB: 162000, cd0: 0.017, gMax: 10, rollMax: 3.7, aStall: 0.46, aFbw: 0.45 }),
    rcs: 5, radar: 'n019', irst: 15000, irSig: 1.15, maws: false, hmd: true, ecm: 0.05,
    gun: 'gsh301', ammo: 150, flares: 40, chaff: 20, size: 1.12,
    stations: [[4.4, -0.15, 1.9, 'wing'], [-4.4, -0.15, 1.9, 'wing'], [3.4, -0.22, 1.4, 'wing'], [-3.4, -0.22, 1.4, 'wing'], [2.45, -0.3, 0.9, 'wing'], [-2.45, -0.3, 0.9, 'wing']],
    loadouts: {
      air: { name: 'Standard', st: ['r73', 'r73', 'r77', 'r77', 'r27er', 'r27er'] },
      dogfight: { name: 'Dogfight', st: ['r73', 'r73', 'r73', 'r73', 'r77', 'r77'] },
    },
  },
  su35s: {
    code: 6, country: 'rus', name: 'Su-35S', nick: 'Flanker-E', rwr: '35',
    desc: 'Heavy thrust-vectoring super-manoeuvrable Flanker. The Irbis-E radar is the longest-ranged in the game, with an IRST and strong jamming. Big radar target, no missile warning.',
    flight: J({ mass: 22100, S: 93, thrMil: 172600, thrAB: 284000, cd0: 0.016, gMax: 10, rollMax: 3.4, aStall: 0.48, aFbw: 0.75, tvc: 1.0 }),
    rcs: 3, radar: 'irbis', irst: 30000, irSig: 1.2, maws: false, hmd: true, ecm: 0.3,
    gun: 'gsh301', ammo: 150, flares: 64, chaff: 32, size: 1.4,
    stations: [[7.5, 0, 3.8, 'tip'], [-7.5, 0, 3.8, 'tip'], [5.6, -0.2, 2.8, 'wing'], [-5.6, -0.2, 2.8, 'wing'], [4.0, -0.25, 1.8, 'wing'], [-4.0, -0.25, 1.8, 'wing'], [1.55, -1.55, 1.0, 'body'], [-1.55, -1.55, 1.0, 'body']],
    loadouts: {
      air: { name: 'Standard', st: ['r74m', 'r74m', 'r771', 'r771', 'r27er', 'r27er', 'r771', 'r771'] },
      bvr: { name: 'Long range', st: ['r74m', 'r74m', 'r771', 'r771', 'r771', 'r771', 'r771', 'r771'] },
    },
  },
  su57: {
    code: 7, country: 'rus', name: 'Su-57', nick: 'Felon', rwr: '57', stealth: true,
    desc: 'Russia\'s fifth-generation fighter: reduced radar signature (far less than the F-22 or J-20), thrust vectoring, side-looking radar arrays, IRST and missile warning. Internal R-77M and R-74M.',
    flight: J({ mass: 22750, S: 118, thrMil: 176000, thrAB: 294000, cd0: 0.015, wave: 0.018, gMax: 10, rollMax: 3.8, aStall: 0.48, aFbw: 0.75, tvc: 1.0 }),
    rcs: 0.3, rcsSide: 6, rcsRear: 5, radar: 'n036', irst: 32000, irSig: 0.85, maws: true, hmd: true, ecm: 0.3,
    gun: 'gsh301', ammo: 150, flares: 48, chaff: 48, size: 1.3,
    stations: [[2.15, -0.35, -2.6, 'bay'], [-2.15, -0.35, -2.6, 'bay'], [0.5, -0.9, 0.0, 'bay'], [-0.5, -0.9, 0.0, 'bay'], [0.5, -0.9, 2.6, 'bay'], [-0.5, -0.9, 2.6, 'bay']],
    loadouts: {
      air: { name: 'Internal', st: ['r74m', 'r74m', 'r77m', 'r77m', 'r77m', 'r77m'] },
    },
  },

  // ======================= CHINA =======================
  j10c: {
    code: 8, country: 'chn', name: 'J-10C', nick: 'Vigorous Dragon', rwr: 'J10',
    desc: 'Single-engine canard delta with an AESA radar, IRST, missile warning and the long-range PL-15. Light, quick and well equipped.',
    flight: J({ mass: 11800, S: 59, thrMil: 84000, thrAB: 132000, cd0: 0.015, wave: 0.019, k: 0.16, clA: 4.3, aStall: 0.5, aFbw: 0.45, gMax: 10, rollMax: 4.0 }),
    rcs: 1.5, radar: 'klj7a', irst: 25000, irSig: 1.0, maws: true, hmd: true, ecm: 0.2,
    gun: 'gsh23', ammo: 220, flares: 36, chaff: 36, size: 1.1,
    stations: [[3.6, -0.35, 2.8, 'wing'], [-3.6, -0.35, 2.8, 'wing'], [2.4, -0.42, 1.8, 'wing'], [-2.4, -0.42, 1.8, 'wing'], [1.0, -1.35, 1.6, 'body'], [-1.0, -1.35, 1.6, 'body']],
    loadouts: {
      air: { name: 'Standard', st: ['pl10', 'pl10', 'pl15', 'pl15', 'pl12', 'pl12'] },
      bvr: { name: 'Long range', st: ['pl10', 'pl10', 'pl15', 'pl15', 'pl15', 'pl15'] },
    },
  },
  j16: {
    code: 9, country: 'chn', name: 'J-16', nick: 'Flanker-N', rwr: 'J16',
    desc: 'Chinese heavy Flanker with an AESA radar, IRST, missile warning, wingtip jamming pods and up to six PL-15s. No thrust vectoring and a big radar signature.',
    flight: J({ mass: 22300, S: 93, thrMil: 160000, thrAB: 264000, cd0: 0.017, gMax: 9.4, rollMax: 3.2, aStall: 0.48, aFbw: 0.5 }),
    rcs: 10, radar: 'j16r', irst: 28000, irSig: 1.2, maws: true, hmd: true, ecm: 0.25,
    gun: 'gsh301', ammo: 150, flares: 48, chaff: 48, size: 1.4,
    stations: [[5.6, -0.2, 2.8, 'wing'], [-5.6, -0.2, 2.8, 'wing'], [4.0, -0.25, 1.8, 'wing'], [-4.0, -0.25, 1.8, 'wing'], [1.55, -1.55, 1.0, 'body'], [-1.55, -1.55, 1.0, 'body'], [0.55, -0.75, 3.4, 'body'], [-0.55, -0.75, 3.4, 'body']],
    loadouts: {
      air: { name: 'Standard', st: ['pl10', 'pl10', 'pl15', 'pl15', 'pl15', 'pl15', null, null] },
      heavy: { name: 'Heavy long range', st: ['pl10', 'pl10', 'pl15', 'pl15', 'pl15', 'pl15', 'pl15', 'pl15'] },
    },
  },
  j20a: {
    code: 10, country: 'chn', name: 'J-20A', nick: 'Mighty Dragon', rwr: 'J20', stealth: true,
    desc: 'Long stealth canard delta built for long-range interception: low frontal radar signature, AESA radar, chin EOTS and internal PL-15s. No internal gun at all.',
    flight: J({ mass: 26250, S: 110, thrMil: 176000, thrAB: 284000, cd0: 0.014, wave: 0.017, k: 0.15, clA: 4.4, aStall: 0.5, aFbw: 0.5, gMax: 10, rollMax: 3.3 }),
    rcs: 0.02, rcsSide: 12, rcsRear: 8, radar: 't1475', irst: 30000, irSig: 0.9, maws: true, hmd: true, ecm: 0.2,
    gun: 'none', ammo: 0, flares: 32, chaff: 32, size: 1.35,
    stations: [[1.65, -0.5, -3.0, 'bay'], [-1.65, -0.5, -3.0, 'bay'], [0.38, -0.85, -1.0, 'bay'], [-0.38, -0.85, -1.0, 'bay'], [0.38, -0.85, 1.6, 'bay'], [-0.38, -0.85, 1.6, 'bay']],
    loadouts: {
      air: { name: 'Internal', st: ['pl10', 'pl10', 'pl15', 'pl15', 'pl15', 'pl15'] },
    },
  },

  // ======================= EUROPE =======================
  typhoon: {
    code: 11, country: 'eur', name: 'Eurofighter Typhoon', nick: 'Typhoon', rwr: 'EF',
    desc: 'Canard-delta energy fighter with outstanding thrust-to-weight and roll rate. Captor-E radar on a swivel (±100°), PIRATE IRST, DASS jamming and missile warning. Meteor and IRIS-T.',
    flight: J({ mass: 13560, S: 77, thrMil: 120000, thrAB: 180000, cd0: 0.014, wave: 0.018, k: 0.15, clA: 4.3, aStall: 0.5, aFbw: 0.45, gMax: 10, rollMax: 4.2 }),
    rcs: 0.5, radar: 'captor', irst: 35000, irSig: 1.05, maws: true, hmd: true, ecm: 0.3,
    gun: 'bk27', ammo: 150, flares: 32, chaff: 32, size: 1.08,
    stations: [[4.3, -0.3, 3.4, 'wing'], [-4.3, -0.3, 3.4, 'wing'], [3.0, -0.4, 2.5, 'wing'], [-3.0, -0.4, 2.5, 'wing'], [0.95, -1.25, -0.8, 'body'], [-0.95, -1.25, -0.8, 'body'], [0.95, -1.25, 2.6, 'body'], [-0.95, -1.25, 2.6, 'body']],
    loadouts: {
      air: { name: 'Standard', st: ['irist', 'irist', 'irist', 'irist', 'meteor', 'meteor', 'meteor', 'meteor'] },
      bvr: { name: 'Long range', st: ['irist', 'irist', 'meteor', 'meteor', 'meteor', 'meteor', 'meteor', 'meteor'] },
    },
  },
  rafale: {
    code: 12, country: 'eur', name: 'Dassault Rafale C', nick: 'Rafale', rwr: 'RF',
    desc: 'Close-coupled canard delta with the SPECTRA suite: the strongest jamming in the game, IRST and missile warning. MICA (IR or radar) and Meteor.',
    flight: J({ mass: 12700, S: 69, thrMil: 100000, thrAB: 150000, cd0: 0.015, wave: 0.02, k: 0.15, clA: 4.4, aStall: 0.5, aFbw: 0.5, gMax: 10, rollMax: 4.1 }),
    rcs: 1.0, radar: 'rbe2', irst: 30000, irSig: 1.0, maws: true, hmd: true, ecm: 0.35,
    gun: 'm791', ammo: 125, flares: 32, chaff: 32, size: 1.03,
    stations: [[5.45, 0, 4.2, 'tip'], [-5.45, 0, 4.2, 'tip'], [4.2, -0.3, 3.0, 'wing'], [-4.2, -0.3, 3.0, 'wing'], [2.9, -0.4, 2.2, 'wing'], [-2.9, -0.4, 2.2, 'wing'], [0.75, -1.1, 1.5, 'body'], [-0.75, -1.1, 1.5, 'body']],
    loadouts: {
      air: { name: 'Standard', st: ['micair', 'micair', 'micaem', 'micaem', 'meteor', 'meteor', null, null] },
      mica: { name: 'All MICA', st: ['micair', 'micair', 'micair', 'micair', 'micaem', 'micaem', 'micaem', 'micaem'] },
    },
  },
  gripen: {
    code: 13, country: 'eur', name: 'Saab Gripen E', nick: 'Gripen', rwr: 'GR',
    desc: 'Small, light single-engine canard delta with a swashplate AESA radar, IRST, missile warning and strong jamming. Small radar target; modest thrust.',
    flight: J({ mass: 10900, S: 45, thrMil: 62000, thrAB: 98000, cd0: 0.015, wave: 0.02, k: 0.15, clA: 4.4, aStall: 0.5, aFbw: 0.45, gMax: 10, rollMax: 4.2 }),
    rcs: 0.5, radar: 'raven', irst: 30000, irSig: 0.95, maws: true, hmd: true, ecm: 0.35,
    gun: 'bk27', ammo: 120, flares: 36, chaff: 36, size: 0.98,
    stations: [[4.35, 0, 3.7, 'tip'], [-4.35, 0, 3.7, 'tip'], [3.3, -0.3, 2.9, 'wing'], [-3.3, -0.3, 2.9, 'wing'], [2.2, -0.35, 2.2, 'wing'], [-2.2, -0.35, 2.2, 'wing']],
    loadouts: {
      air: { name: 'Standard', st: ['irist', 'irist', 'meteor', 'meteor', 'meteor', 'meteor'] },
      dogfight: { name: 'Dogfight', st: ['irist', 'irist', 'irist', 'irist', 'meteor', 'meteor'] },
    },
  },
};

export const JET_BY_CODE = Object.fromEntries(Object.entries(JETS).map(([k, j]) => [j.code, k]));
export const JETS_OF = (country) => Object.keys(JETS).filter((k) => JETS[k].country === country);
export const DEFAULT_JET = 'f16c';
export const jetOf = (key) => JETS[key] || JETS[DEFAULT_JET];

// Air-to-ground loadouts. The F-15C is a pure air-superiority fighter and carries none.
const AG_LOADOUTS = {
  f16c: {
    strike: ['Strike (laser bombs)', ['aim9x', 'aim9x', 'aim120', 'aim120', 'gbu12', 'gbu12']],
    sead: ['SEAD (HARM)', ['aim9x', 'aim9x', 'aim120', 'aim120', 'agm88', 'agm88']],
    cas: ['Close air support', ['aim9x', 'aim9x', 'agm65', 'agm65', 'hydra', 'hydra']],
    bombs: ['Iron bombs', ['aim9x', 'aim9x', 'mk82', 'mk82', 'mk82', 'mk82']],
  },
  fa18e: {
    strike: ['Strike (JDAM + laser)', ['aim9x', 'aim9x', 'gbu38', 'gbu38', 'gbu12', 'gbu12', 'aim120d', 'aim120d']],
    sead: ['SEAD (HARM + Maverick)', ['aim9x', 'aim9x', 'agm88', 'agm88', 'agm65', 'agm65', 'aim120d', 'aim120d']],
    antiship: ['Anti-ship (Harpoon)', ['aim9x', 'aim9x', 'agm84', 'agm84', null, null, 'aim120d', 'aim120d']],
    cas: ['Close air support', ['aim9x', 'aim9x', 'agm65', 'agm65', 'hydra', 'hydra', 'mk82', 'mk82']],
  },
  f22a: { strike: ['Internal strike (JDAM)', ['aim9x', 'aim9x', 'gbu38', 'gbu38', 'aim120d', 'aim120d', null, null]] },
  mig29s: {
    strike: ['Strike (Kh-29T)', ['r73', 'r73', 'ofab250', 'ofab250', 'kh29t', 'kh29t']],
    cas: ['Rockets and bombs', ['r73', 'r73', 's8', 's8', 'ofab250', 'ofab250']],
  },
  su35s: {
    strike: ['Strike (Kh-29T + KAB)', ['r74m', 'r74m', 'kh29t', 'kh29t', 'kab500', 'kab500', 'r771', 'r771']],
    sead: ['SEAD (Kh-31P)', ['r74m', 'r74m', 'kh31p', 'kh31p', 'kh31p', 'kh31p', 'r771', 'r771']],
    antiship: ['Anti-ship (Kh-35)', ['r74m', 'r74m', 'kh35', 'kh35', null, null, 'r771', 'r771']],
  },
  su57: {
    sead: ['Internal SEAD (Kh-31P)', ['r74m', 'r74m', 'kh31p', 'kh31p', 'r77m', 'r77m']],
    strike: ['Internal strike (KAB)', ['r74m', 'r74m', 'kab500', 'kab500', 'r77m', 'r77m']],
  },
  j10c: {
    strike: ['Strike (LS-6)', ['pl10', 'pl10', 'ls6', 'ls6', 'pl12', 'pl12']],
    cas: ['Close air support', ['pl10', 'pl10', 'akd10', 'akd10', 'hf90', 'hf90']],
  },
  j16: {
    strike: ['Strike (LS-6 + YJ-91)', ['pl10', 'pl10', 'yj91', 'yj91', 'ls6', 'ls6', 'pl15', 'pl15']],
    antiship: ['Anti-ship (YJ-83K)', ['pl10', 'pl10', 'yj83', 'yj83', null, null, 'pl15', 'pl15']],
    cas: ['Close air support', ['pl10', 'pl10', 'akd10', 'akd10', 'gb250', 'gb250', 'pl15', 'pl15']],
  },
  j20a: { strike: ['Internal strike (LS-6)', ['pl10', 'pl10', 'ls6', 'ls6', 'pl15', 'pl15']] },
  typhoon: {
    strike: ['Strike (Paveway IV)', ['irist', 'irist', 'pw4', 'pw4', 'meteor', 'meteor', 'meteor', 'meteor']],
    sead: ['SEAD (ALARM)', ['irist', 'irist', 'alarm', 'alarm', 'meteor', 'meteor', 'meteor', 'meteor']],
    cas: ['Close air support (Brimstone)', ['irist', 'irist', 'brim', 'brim', 'meteor', 'meteor', null, null]],
  },
  rafale: {
    strike: ['Strike (Hammer)', ['micair', 'micair', 'hammer', 'hammer', 'hammer', 'hammer', 'micaem', 'micaem']],
    antiship: ['Anti-ship (Exocet)', ['micair', 'micair', 'micaem', 'micaem', 'exocet', 'exocet', null, null]],
    cas: ['Rockets and bombs', ['micair', 'micair', 'sneb', 'sneb', 'mk82', 'mk82', 'micaem', 'micaem']],
  },
  gripen: {
    strike: ['Strike (Paveway IV)', ['irist', 'irist', 'meteor', 'meteor', 'pw4', 'pw4']],
    cas: ['Close air support', ['irist', 'irist', 'brim', 'brim', 'sneb', 'sneb']],
  },
};
for (const [k, L] of Object.entries(AG_LOADOUTS)) for (const [lk, [name, st]] of Object.entries(L)) JETS[k].loadouts[lk] = { name, st, ag: true };

// Firing order: internal bays and fuselage first, then wing pylons, wingtips last.
const KIND_ORDER = { bay: 0, body: 1, wing: 2, tip: 3 };
for (const j of Object.values(JETS)) {
  j.fireOrder = j.stations.map((s, i) => i).sort((a, b) => (KIND_ORDER[j.stations[a][3]] - KIND_ORDER[j.stations[b][3]]) || (Math.abs(j.stations[a][0]) - Math.abs(j.stations[b][0])) || a - b);
  j.loadoutKeys = Object.keys(j.loadouts);
}

// Gun muzzle in body coordinates (rounds start here), and the ejection seat.
const GUNPOS = {
  f16c: [-0.75, 0.4, -3.8], f15c: [1.6, 0.3, -1.0], fa18e: [0, 0.62, -7.4], f22a: [1.7, 0.25, -2.0],
  mig29s: [-1.0, 0.25, -3.5], su35s: [1.4, 0.3, -4.6], su57: [1.25, 0.3, -4.6],
  j10c: [-0.6, -1.3, -1.0], j16: [1.4, 0.3, -4.6], j20a: [0, 0, -6],
  typhoon: [1.0, 0.1, -1.0], rafale: [1.0, -0.4, -1.0], gripen: [-0.8, -0.3, -1.0],
};
for (const [k, p] of Object.entries(GUNPOS)) JETS[k].gunPos = p;
