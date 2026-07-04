// Fixed starting scenario for the direct-fire sandbox — Fed vs Klingon (all verified ships).
// Every ship is drag/rotate editable at runtime, so the player builds any firing geometry.
export const SCENARIO = [
  { id: 'F1', code: 'FED-CA',  name: 'Federation CA',   side: 'friendly', q: 3,  r: 6, facing: 0 },
  { id: 'F2', code: 'FED-NCL', name: 'Federation NCL',  side: 'friendly', q: 3,  r: 9, facing: 0 },
  { id: 'E1', code: 'KLI-D7',  name: 'Klingon D7',      side: 'enemy',    q: 13, r: 6, facing: 3 },
  { id: 'E2', code: 'KLI-D7',  name: 'Klingon D7 (2)',  side: 'enemy',    q: 13, r: 9, facing: 3 },
];
