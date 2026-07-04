// Fixed starting scenario for the direct-fire sandbox — Fed vs Klingon (all verified ships).
// Every ship is drag/rotate editable at runtime, so the player builds any firing geometry.
export const SCENARIO = [
  // facing: 0=SE 1=S 2=SW 3=NW 4=N 5=NE — fleets angled toward the centre (no due-E/W on flat-top hexes)
  { id: 'F1', code: 'FED-CA',  name: 'Federation CA',   side: 'friendly', q: 8,  r: 13, facing: 0, speed: 8 },
  { id: 'F2', code: 'FED-NCL', name: 'Federation NCL',  side: 'friendly', q: 8,  r: 17, facing: 5, speed: 8 },
  { id: 'E1', code: 'KLI-D7',  name: 'Klingon D7',      side: 'enemy',    q: 33, r: 13, facing: 2, speed: 8 },
  { id: 'E2', code: 'KLI-D7',  name: 'Klingon D7 (2)',  side: 'enemy',    q: 33, r: 17, facing: 3, speed: 8 },
];
