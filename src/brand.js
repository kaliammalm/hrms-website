/* ==========================================================================
   Company branding & leadership (display-only metadata).
   Matching mirrors the existing name/id logic used across the app.
   No data fetching, no role decisions.
   ========================================================================== */
import rrdLogo from './assets/logos/rrd-logo-horizontal.png';
import fractioLogo from './assets/logos/fractio-logo.png';
import fractioWordmark from './assets/logos/fractio-wordmark.png';
import varnamLogo from './assets/logos/varnam-logo.png';

export const COMPANY_BRANDS = {
  1: {
    key: 'rrd',
    name: 'Ram Reddy Developers',
    legalName: 'Ram Reddy Developers',
    logo: rrdLogo,          // horizontal lockup (mark + wordmark)
    logoCompact: rrdLogo,
    ceo: 'Vasumathi',
    status: 'active',
  },
  2: {
    key: 'fractio',
    name: 'Fractio Hospitality',
    legalName: 'Fractio Holiday Homes LLP',
    logo: fractioLogo,
    logoCompact: fractioWordmark,
    ceo: 'Vinu Karthick I',
    status: 'active',
  },
  3: {
    key: 'varnam',
    name: 'Stories by Varnam',
    legalName: 'Stories by Varnam',
    logo: varnamLogo,
    logoCompact: varnamLogo,
    ceo: null,
    status: 'on-hold',
  },
};

/** Resolve a brand from a company id, name string or company object. Returns null if unknown. */
export function getCompanyBrand(company) {
  if (company === null || company === undefined || company === '') return null;
  if (typeof company === 'object') {
    return getCompanyBrand(company.id) || getCompanyBrand(company.name || company.company_name);
  }
  const asNum = Number(company);
  if (!Number.isNaN(asNum) && COMPANY_BRANDS[asNum]) return COMPANY_BRANDS[asNum];

  const s = String(company).trim().toLowerCase();
  if (!s || s === 'all companies') return null;
  if (s.includes('ram reddy') || s === 'rrd') return COMPANY_BRANDS[1];
  if (s.includes('fractio')) return COMPANY_BRANDS[2];
  if (s.includes('varnam') || s.includes('stories')) return COMPANY_BRANDS[3];
  return null;
}

/** Small logo element. `compact` uses the narrow variant where available. */
export function CompanyLogo({ company, height = 28, compact = false, className = '', style }) {
  const brand = getCompanyBrand(company);
  if (!brand) return null;
  return (
    <img
      src={compact ? brand.logoCompact : brand.logo}
      alt={brand.name}
      className={`hr-company-logo ${className}`.trim()}
      style={{ height, width: 'auto', ...style }}
      draggable="false"
    />
  );
}
