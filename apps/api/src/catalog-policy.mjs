// Public catalog policy. Keep this list deliberately explicit: an arbitrary
// license string or a repository URL alone is not enough to promise remixing.
export const OPEN_SOURCE_LICENSES = Object.freeze([
  '0bsd', 'agpl-3.0-only', 'agpl-3.0-or-later', 'apache-2.0',
  'bsd-2-clause', 'bsd-3-clause', 'cc0-1.0', 'gpl-2.0-only',
  'gpl-2.0-or-later', 'gpl-3.0-only', 'gpl-3.0-or-later', 'isc',
  'lgpl-2.1-only', 'lgpl-2.1-or-later', 'lgpl-3.0-only',
  'lgpl-3.0-or-later', 'mit', 'mpl-2.0', 'unlicense',
]);

// The first public "可二创" badge is intentionally narrower than the full
// open-source set. Copyleft projects stay discoverable as open source, while
// the stronger remix promise is reserved for licenses whose redistribution
// obligations the current product can explain reliably.
export const REMIXABLE_LICENSES = Object.freeze([
  '0bsd', 'apache-2.0', 'bsd-2-clause', 'bsd-3-clause', 'cc0-1.0',
  'isc', 'mit', 'unlicense',
]);

export const isOpenSourceLicense = license =>
  Boolean(license && OPEN_SOURCE_LICENSES.includes(String(license).trim().toLowerCase()));

export const isRemixableLicense = license =>
  Boolean(license && REMIXABLE_LICENSES.includes(String(license).trim().toLowerCase()));
