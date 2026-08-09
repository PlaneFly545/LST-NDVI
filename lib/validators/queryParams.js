// lib/validators/queryParams.js
// Input validation and sanitization for /api/map-layer query parameters.
import baliGeoJSON from '../../public/data/bali_kabkota.json';

// ── Constants ─────────────────────────────────────────────────────────────
export const ALLOWED_TYPES    = new Set(['lst', 'ndvi']);
export const ALLOWED_MODES    = new Set(['history', 'prediksi']);
export const ALLOWED_REDUCERS = new Set(['Median', 'Mean', 'Max', 'Mosaic']);
export const ALLOWED_GAP_FILL = new Set(['none', 'spatial']);

const DATE_REGEX       = /^\d{4}-\d{2}-\d{2}$/;
const MIN_ALLOWED_DATE = new Date('2013-01-01T00:00:00.000Z');
const MAX_QUERY_SIZE_BYTES = 2048;

/** Set of valid kabupaten/kota names (uppercase) from the GeoJSON file */
export const REGION_NAMES = new Set(
  (baliGeoJSON?.features || [])
    .map((f) => f?.properties?.nm_kabkota)
    .filter(Boolean)
    .map((n) => String(n).toUpperCase())
);

// ── Helpers ───────────────────────────────────────────────────────────────
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function getTotalQuerySize(queryObj) {
  return Object.entries(queryObj || {}).reduce((acc, [k, v]) => {
    const keyLen = String(k || '').length;
    const valLen = Array.isArray(v)
      ? v.map((x) => String(x || '').length).reduce((a, b) => a + b, 0)
      : String(v || '').length;
    return acc + keyLen + valLen;
  }, 0);
}

export function safeErrorLog(message, extra = {}) {
  try {
    console.error(message, extra);
  } catch {
    console.error(message);
  }
}

/**
 * Validate a date string and return a Date object.
 * Throws a descriptive Error on failure.
 *
 * @param {string} value
 * @param {string} fieldName
 * @returns {Date}
 */
export function validateDateString(value, fieldName) {
  if (!value || !DATE_REGEX.test(value)) {
    throw new Error(`Format ${fieldName} harus YYYY-MM-DD.`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${fieldName} tidak valid.`);
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (d < MIN_ALLOWED_DATE || d > today) {
    throw new Error(`${fieldName} di luar rentang yang diizinkan.`);
  }
  return d;
}

/**
 * Batas tahun kalender penuh yang benar-benar tercakup sebuah periode.
 *
 * WMO mendefinisikan periode acuan iklim sebagai rentang tahun kalender penuh,
 * 1 Januari–31 Desember, tidak pernah berawal atau berakhir di tengah tahun.
 * Alasannya berlaku persis untuk data ini: tahun yang cuma tercakup sebagian
 * hanya memuat sebagian siklus musim dan jauh lebih sedikit scene, sehingga
 * rata-rata tahunannya tidak sebanding dengan tahun lain di deret yang sama.
 * Tanpa pembatasan ini, periode yang berakhir 1 Januari 2026 akan menghitung
 * 2026 sebagai satu tahun utuh padahal isinya satu hari.
 *
 * @param {Date} startDateObj
 * @param {Date} endDateObj
 * @returns {{ startYear: number, endYear: number } | null}  null bila tidak ada tahun penuh
 */
export function resolveFullYearRange(startDateObj, endDateObj) {
  const startsOnJan1 = startDateObj.getUTCMonth() === 0 && startDateObj.getUTCDate() === 1;
  const endsOnDec31  = endDateObj.getUTCMonth() === 11 && endDateObj.getUTCDate() === 31;

  const startYear = startsOnJan1
    ? startDateObj.getUTCFullYear()
    : startDateObj.getUTCFullYear() + 1;
  const endYear = endsOnDec31
    ? endDateObj.getUTCFullYear()
    : endDateObj.getUTCFullYear() - 1;

  if (endYear < startYear) return null;
  return { startYear, endYear };
}

/**
 * Parse, validate, and normalize all query parameters from the request.
 * Returns a structured object or throws/returns an error response object.
 *
 * Usage in handler:
 *   const result = parseQueryParams(req.query);
 *   if (result.error) return res.status(result.status).json({ error: result.error });
 *
 * @param {object} query  req.query
 * @returns {{ error: string, status: number } | ParsedParams}
 */
export function parseQueryParams(query) {
  // Guard: query size
  if (getTotalQuerySize(query) > MAX_QUERY_SIZE_BYTES) {
    return { error: 'Ukuran query terlalu besar (maks 2KB).', status: 400 };
  }

  const {
    type, start_date, end_date, region_name, cloud_cover,
    reducer, vis_min, vis_max, threshold, mode, target_year, gap_fill,
  } = query;

  // Normalize strings
  const normalizedType    = String(type || 'lst').toLowerCase();
  const normalizedMode    = String(mode || 'history').toLowerCase();
  const normalizedReducer = String(reducer || 'Median');
  const normalizedGapFill = String(gap_fill || 'none').toLowerCase();
  const normalizedRegion  = String(region_name || 'ALL');

  // Whitelist checks
  if (!ALLOWED_TYPES.has(normalizedType))    return { error: 'Parameter type tidak valid.', status: 400 };
  if (!ALLOWED_MODES.has(normalizedMode))    return { error: 'Parameter mode tidak valid.', status: 400 };
  if (!ALLOWED_REDUCERS.has(normalizedReducer)) return { error: 'Parameter reducer tidak valid.', status: 400 };
  if (!ALLOWED_GAP_FILL.has(normalizedGapFill)) return { error: 'Parameter gap_fill tidak valid.', status: 400 };

  if (normalizedRegion.length > 100) return { error: 'region_name terlalu panjang.', status: 400 };
  if (normalizedRegion !== 'ALL' && !REGION_NAMES.has(normalizedRegion.toUpperCase())) {
    return { error: 'region_name tidak dikenali.', status: 400 };
  }

  // Date validation
  const startDateInput = String(start_date || '2024-01-01');
  const endDateInput   = String(end_date   || '2024-12-31');
  let startDateObj, endDateObj;

  try {
    startDateObj = validateDateString(startDateInput, 'start_date');
    endDateObj   = validateDateString(endDateInput,   'end_date');
  } catch (err) {
    return { error: err.message, status: 400 };
  }

  if (startDateObj >= endDateObj) {
    return { error: 'start_date harus lebih kecil dari end_date.', status: 400 };
  }

  // Tahun kalender penuh tetap jadi acuan, tapi ketiadaannya hanya fatal untuk
  // prediksi. Historis masih menghasilkan angka yang berarti dari periode
  // sependek apa pun — median peta dan statistik wilayah dihitung langsung dari
  // citra yang ada, tidak lewat batas tahun sama sekali. Yang berkurang cuma
  // keterwakilan musimnya, dan itu bisa diberitahukan lewat penanda.
  //
  // Prediksi tidak punya jalan keluar serupa: regresi harmonik mencocokkan suku
  // sin/cos berperiode tepat satu tahun, jadi pada jendela yang belum genap satu
  // putaran, amplitudo musim dan kemiringan tren saling tertukar — lalu
  // kemiringan yang salah tafsir itu dikalikan sepanjang horizon prediksi.
  const fullYears = resolveFullYearRange(startDateObj, endDateObj);

  if (!fullYears && normalizedMode === 'prediksi') {
    return {
      error: 'Mode prediksi butuh periode baseline yang memuat minimal satu tahun kalender penuh (1 Januari–31 Desember).',
      status: 400,
    };
  }

  // Rentang tahun penuh: dipakai sebagai baseline model dan penentu tahun mana
  // yang boleh disebut lengkap. Bila tidak ada satu pun, jatuh ke tahun mentah
  // supaya nilai turunannya (mis. tahun target) tetap punya acuan angka.
  const hasFullYear       = Boolean(fullYears);
  const baselineStartYear = fullYears ? fullYears.startYear : startDateObj.getUTCFullYear();
  const baselineEndYear   = fullYears ? fullYears.endYear   : endDateObj.getUTCFullYear();

  // Rentang tahun yang digambar di grafik tren: selalu seluruh tahun yang
  // benar-benar disentuh periode, termasuk yang tercakup sebagian. Tahun tepi
  // tidak dibuang lagi — ditandai, bukan dihilangkan, supaya pembaca tahu ada
  // datanya sekaligus tahu bahwa cakupannya belum genap.
  const seriesStartYear = startDateObj.getUTCFullYear();
  const seriesEndYear   = endDateObj.getUTCFullYear();

  // Numeric parsing & clamping
  const parsedCloud   = Number.parseInt(String(cloud_cover ?? '20'), 10);
  const cloudThreshold = Number.isNaN(parsedCloud) ? 20 : clamp(parsedCloud, 0, 100);

  // Tahun target dihitung relatif terhadap akhir periode baseline, bukan tahun
  // kalender berjalan. "+5 tahun" berarti lima tahun setelah data terakhir yang
  // dipakai model — kalau diukur dari hari ini, jarak ekstrapolasinya berubah
  // diam-diam setiap kali pengguna menggeser periode baseline. Acuannya tahun
  // penuh terakhir, jadi tanggal akhir 1 Januari 2026 bertolak dari 2025.
  const parsedTargetYear    = Number.parseInt(String(target_year ?? `${baselineEndYear + 5}`), 10);
  const clampedTargetYear   = Number.isNaN(parsedTargetYear)
    ? baselineEndYear + 5
    : clamp(parsedTargetYear, baselineEndYear + 1, baselineEndYear + 50);

  const defaultVisMin  = normalizedType === 'ndvi' ? -1  : 20;
  const defaultVisMax  = normalizedType === 'ndvi' ?  1  : 45;
  const visMinBounds   = normalizedType === 'ndvi' ? [-1, 1] : [-50, 80];
  const visMaxBounds   = normalizedType === 'ndvi' ? [-1, 1] : [-50, 80];

  const parsedVisMin = Number.parseFloat(String(vis_min ?? `${defaultVisMin}`));
  const parsedVisMax = Number.parseFloat(String(vis_max ?? `${defaultVisMax}`));

  const visMin = Number.isNaN(parsedVisMin) ? defaultVisMin : clamp(parsedVisMin, visMinBounds[0], visMinBounds[1]);
  const visMax = Number.isNaN(parsedVisMax) ? defaultVisMax : clamp(parsedVisMax, visMaxBounds[0], visMaxBounds[1]);

  if (visMin >= visMax) return { error: 'vis_min harus lebih kecil dari vis_max.', status: 400 };

  const defaultThreshold = normalizedType === 'ndvi' ? 0.5 : 30.0;
  const parsedThreshold  = Number.parseFloat(String(threshold ?? `${defaultThreshold}`));
  const thresholdVal     = Number.isNaN(parsedThreshold) ? defaultThreshold : parsedThreshold;

  return {
    normalizedType,
    normalizedMode,
    normalizedReducer,
    normalizedGapFill,
    normalizedRegion,
    startDateInput,
    endDateInput,
    startDateObj,
    endDateObj,
    baselineStartYear,
    baselineEndYear,
    seriesStartYear,
    seriesEndYear,
    hasFullYear,
    cloudThreshold,
    clampedTargetYear,
    visMin,
    visMax,
    thresholdVal,
  };
}
