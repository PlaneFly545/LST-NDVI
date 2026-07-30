# Laporan Pengujian: Cache & Rate Limiter — `/api/map-layer`

**Tanggal**: 2026-06-24 | **Base URL**: `http://localhost:3000` | **Total request**: 13

> [!NOTE]
> Pengujian bersifat **observasional murni** — tidak ada perubahan kode. Menggunakan parameter valid mode `history`, type `lst`, region `ALL`, periode 2024-01-01 → 2024-03-31.

---

## A. Uji Cache (`lib/gee/cache.js`)

| # | Label | Status | X-Cache | Response Time | Keterangan |
|---|-------|--------|---------|---------------|-----------|
| 1 | Cache-Req1 | **200** | `MISS` | **11,676 ms** | Cold call ke GEE |
| 2 | Cache-Req2 | **200** | `HIT` | **43 ms** | Dari in-memory cache |

### Analisis

- **Speedup**: Request 2 selesai ~**272× lebih cepat** dari request 1
- **Header `X-Cache`**: Terset dengan benar `MISS` → `HIT`
- **Tidak ada timeout 504** pada request pertama (GEE merespons dalam ~11,7 detik)
- **Cache key** dibangun dari SHA-256 parameter yang di-sort secara deterministik → parameter identik menghasilkan key yang sama

> [!TIP]
> Response time 11.676ms pada cold request adalah normal untuk GEE. Dalam produksi, user hanya merasakan ini sekali per parameter-set unik per 24 jam (TTL cache).

**Verdict: ✅ Cache berfungsi sempurna.**

---

## B. Uji Rate Limiter (`proxy.js`)

Konfigurasi: `RATE_LIMIT_MAX_REQUESTS = 5` per `RATE_LIMIT_WINDOW_MS = 60.000ms`

> [!IMPORTANT]
> Window rate limiter **tidak reset** antara Uji A dan Uji B karena semua terjadi dalam satu window 60 detik. Dua request di Uji A sudah menggunakan 2 slot dari kuota 5, sehingga hanya 3 slot tersisa saat Uji B dimulai.

| # (Test B) | # (Total) | Status | X-Cache | Waktu | Keterangan |
|------------|-----------|--------|---------|-------|-----------|
| 1 | 3 | **200** ✅ | `HIT` | 33ms | Slot 3/5 |
| 2 | 4 | **200** ✅ | `HIT` | 31ms | Slot 4/5 |
| 3 | 5 | **200** ✅ | `HIT` | 35ms | Slot 5/5 — kuota penuh |
| **4** | **6** | **429** 🔴 | `-` | 18ms | **Rate limit terlampaui** |
| 5 | 7 | **429** 🔴 | `-` | 13ms | Ditolak |
| 6 | 8 | **429** 🔴 | `-` | 11ms | Ditolak |
| 7 | 9 | **429** 🔴 | `-` | 13ms | Ditolak |
| 8 | 10 | **429** 🔴 | `-` | 14ms | Ditolak |
| 9 | 11 | **429** 🔴 | `-` | 12ms | Ditolak |
| 10 | 12 | **429** 🔴 | `-` | 10ms | Ditolak |

**Body respons 429:**
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit terlampaui. Maksimal 5 request per menit."
}
```

### Analisis

- Rate limiter aktif dan menolak sejak **request ke-4 dalam Test B** (ke-6 total)
- Logika penghitungan dari `proxy.js`: request pertama set `count=1`, lalu increment. Penolakan terjadi saat `count >= 5` → **5 request diizinkan, ke-6 ditolak** ✅
- Response 429 sangat cepat (~10–18ms) karena short-circuit sebelum menyentuh GEE atau cache

**Verdict: ✅ Rate limiter berfungsi dengan benar.**

---

## C. Uji Reset Rate Limit (setelah 65 detik)

| # | Label | Status | X-Cache | Waktu | Keterangan |
|---|-------|--------|---------|-------|-----------|
| 13 | RateLimit-Reset | **200** ✅ | `HIT` | 22ms | Window expired, kuota reset |

**Verdict: ✅ Rate limit berhasil direset setelah ~65 detik.**

---

## D. Status 504 (GEE Timeout)

> [!NOTE]
> **Tidak ada timeout 504** di seluruh 13 request. GEE merespons dalam ~11,7 detik pada cold request, jauh di bawah batas `REQUEST_TIMEOUT_MS = 120.000ms`.

---

## E. Temuan Penting: Interaksi Cache × Rate Limiter

> [!WARNING]
> **Cache HIT tetap menghitung sebagai request dalam window rate limiter.** Rate limiter bekerja di level middleware (sebelum handler API), sehingga tidak peduli apakah response berasal dari cache atau dari GEE. Ini berarti dalam 1 menit:
> - User bisa melakukan 5 query **berbeda** (semua MISS → 5 GEE calls), atau
> - User bisa melakukan 5 query **sama** (MISS + 4 HIT yang sangat cepat), atau
> - Kombinasi keduanya — totalnya tetap dibatasi 5 per menit.
>
> Ini adalah perilaku yang **by design** dan wajar untuk melindungi endpoint dari abuse.

---

## F. Ringkasan Eksekutif

| Aspek | Hasil | Detail |
|-------|-------|--------|
| **Cache (cold → warm)** | ✅ Berfungsi | 11,676ms → 43ms (**272× speedup**), header `X-Cache` benar |
| **Rate limiter aktif** | ✅ Berfungsi | 429 muncul pada request ke-6 (kuota 5/menit) |
| **Body pesan 429** | ✅ Jelas | `"Maksimal 5 request per menit"` |
| **Reset setelah ~60 detik** | ✅ Berfungsi | Request ke-13 kembali 200 setelah 65 detik |
| **Timeout 504** | ✅ Tidak terjadi | GEE stabil, tidak ada cold timeout hari ini |
| **Bot UA blocking** | ℹ️ Tidak diuji | Script menggunakan browser UA; blok berlaku untuk curl/wget/python-requests |

---

## G. Catatan Teknis: Mengapa Proxy Berfungsi Tanpa `middleware.js`

> [!NOTE]
> Meskipun file dinamai `proxy.js` (bukan `middleware.js`), rate limiter **terbukti berjalan** dari hasil pengujian empiris. Kemungkinan Next.js 16 dengan Turbopack membaca `config.matcher` dan mendeteksi file ini sebagai middleware, atau ada konfigurasi tersembunyi di `.next/`. Yang terpenting: **fungsionalitas berjalan sesuai desain**.
