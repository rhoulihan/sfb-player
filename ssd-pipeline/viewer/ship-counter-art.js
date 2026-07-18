// Hand-drawn hull-class line drawings for the ship map counters — original art (generic top-down starship
// forms, not traced from ADB's SSD artwork), one per hull class. Each is inner-SVG markup on a square
// COUNTER_VIEW×COUNTER_VIEW viewBox, drawn FORWARD = UP, stroked in currentColor so the host tints it per
// fleet. Kept as markup strings (not .svg files) so both the battle map and the verify preview can inline
// them into their SVG DOM — an <image href> could not be tinted.
export const COUNTER_VIEW = 64;

export const COUNTER_ART = {
  // saucer + neck + secondary hull + twin aft nacelles
  'fed-cruiser': `<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="32" cy="19" r="12.5"/>
    <circle cx="32" cy="19" r="3.5"/>
    <path d="M32,31.5 L32,37.5"/>
    <rect x="27.5" y="38" width="9" height="17" rx="4.5"/>
    <path d="M29,44 L20.5,48 M35,44 L43.5,48"/>
    <rect x="14.5" y="45" width="6" height="17" rx="3"/>
    <rect x="43.5" y="45" width="6" height="17" rx="3"/>
  </g>`,
  // command bulb + long boom + swept wing plate + wing-tip nacelles
  'klingon-d7': `<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
    <ellipse cx="32" cy="9.5" rx="5.5" ry="4.5"/>
    <path d="M32,14 L32,30"/>
    <path d="M32,30 L52,46 L52,50 L36,47 L32,52 L28,47 L12,50 L12,46 Z"/>
    <rect x="9" y="44" width="6" height="18" rx="3"/>
    <rect x="49" y="44" width="6" height="18" rx="3"/>
  </g>`,
  // long central hull flanked by parallel side nacelles + tail boom
  'gorn-ca': `<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
    <ellipse cx="32" cy="30" rx="7" ry="24"/>
    <circle cx="32" cy="13" r="2.6"/>
    <rect x="15.5" y="22" width="6.5" height="26" rx="3.25"/>
    <rect x="42" y="22" width="6.5" height="26" rx="3.25"/>
    <path d="M32,54 L32,60"/>
  </g>`,
  // wedge nose + boxy central hull + broad wings with tip engine pods + twin tail engines
  'kzinti-cs': `<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
    <path d="M32,6 L38,18 L38,46 L26,46 L26,18 Z"/>
    <path d="M26,26 L10,34 L10,38 L26,36 Z M38,26 L54,34 L54,38 L38,36 Z"/>
    <rect x="7" y="34" width="6" height="16" rx="3"/>
    <rect x="51" y="34" width="6" height="16" rx="3"/>
    <path d="M28.5,46 L28.5,56 M35.5,46 L35.5,56"/>
  </g>`,
};
