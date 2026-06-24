// components/TourOverlay.js
import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronLeft, HelpCircle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Konfigurasi langkah-langkah tour
// ─────────────────────────────────────────────────────────────
const TOUR_STEPS = [
  {
    id: 'welcome',
    targetId: null,
    title: 'Hai, aku Eko!',
    content:
      'Aku akan memandumu membaca kondisi lingkungan Bali dari citra satelit lewat panduan singkat ini.',
    placement: 'center',
    forcedClick: false,
  },
  {
    id: 'mode',
    targetId: 'tour-mode-toggle',
    title: 'Mode Analisis',
    content:
      'Pilih jenis analisis di sini: Historis menampilkan data yang sudah terekam, Prediksi memproyeksikan masa depan. Tampilan bisa tunggal atau membandingkan dua periode.',
    placement: 'right',
    forcedClick: false,
  },
  {
    id: 'scenario',
    targetId: 'tour-scenario',
    title: 'Skenario Pemodelan',
    content:
      'Tentukan rentang tanggal pengamatan, tersedia sejak Januari 2013, lalu pilih areanya dari seluruh Bali hingga per kabupaten atau kota.',
    placement: 'right',
    forcedClick: false,
  },
  {
    id: 'parameter',
    targetId: 'tour-parameter',
    title: 'Parameter Lingkungan',
    content:
      'Pilih yang ingin kamu lihat: LST untuk suhu permukaan, atau NDVI untuk kerapatan vegetasi.',
    placement: 'right',
    forcedClick: false,
  },
  {
    id: 'process',
    targetId: 'tour-process-btn',
    title: 'Proses Data',
    content:
      'Konfigurasinya sudah siap. Klik tombol di bawah, lalu aku muatkan contoh data satelitnya untukmu.',
    placement: 'right',
    forcedClick: true,
  },
  {
    id: 'map',
    targetId: 'tour-map-area',
    title: 'Peta Satelit',
    content:
      'Setiap piksel mewakili area 30 meter. Pada LST, makin merah makin panas; pada NDVI, makin hijau berarti vegetasinya makin rapat.',
    placement: 'left',
    forcedClick: false,
  },
  {
    id: 'farewell',
    targetId: null,
    title: 'Sampai jumpa!',
    content:
      'Selesai! Kamu sudah melihat simulasi peta LST Bali. Kalau berkenan, bantu kelancaran skripsi kami dengan mengisi kuesioner singkat.',
    placement: 'center',
    forcedClick: false,
    isFarewell: true,
  },
];

// ─────────────────────────────────────────────────────────────
// Helper: Hitung posisi tooltip relatif terhadap target elemen
// Mengembalikan { style, placement } — placement final dipakai
// untuk menentukan arah maskot. Mendukung auto-flip bila ruang
// di sisi yang diinginkan tidak cukup (penting untuk layar sempit).
// ─────────────────────────────────────────────────────────────
const GAP = 16;

function placeAt(rect, placement, tw, th) {
  let top, left;
  if (placement === 'right') {
    top = rect.top + rect.height / 2 - th / 2;
    left = rect.right + GAP;
  } else if (placement === 'left') {
    top = rect.top + rect.height / 2 - th / 2;
    left = rect.left - tw - GAP;
  } else if (placement === 'bottom') {
    top = rect.bottom + GAP;
    left = rect.left + rect.width / 2 - tw / 2;
  } else if (placement === 'top') {
    top = rect.top - th - GAP;
    left = rect.left + rect.width / 2 - tw / 2;
  } else {
    return null;
  }
  return { top, left };
}

function getTooltipPosition(rect, placement, tooltipW = 320, tooltipH = 280) {
  const centered = {
    style: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
    placement: 'center',
  };
  if (!rect) return centered;

  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const clampLeft = (l) => Math.max(GAP, Math.min(l, vpW - tooltipW - GAP));
  const clampTop = (t) => Math.max(GAP, Math.min(t, vpH - tooltipH - GAP));

  // Untuk 'bottom'/'top' cukup butuh ruang VERTIKAL (horizontal selalu dijepit
  // ke layar). Kalau tidak, balon selebar layar di pinggir kiri akan dianggap
  // "tidak muat" lalu balik menimpa target — itulah bug sebelumnya.
  const axisFits = (p, pos) => {
    if (!pos) return false;
    if (p === 'bottom') return pos.top + tooltipH <= vpH - GAP;
    if (p === 'top') return pos.top >= GAP;
    if (p === 'right') return pos.left + tooltipW <= vpW - GAP;
    if (p === 'left') return pos.left >= GAP;
    return false;
  };

  // Di layar sempit (mobile), dahulukan 'bottom' lalu 'top' agar tooltip jatuh
  // DI BAWAH target — sehingga Eko tak menutupi area/kontrol yang ditunjuk.
  const opposite = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
  const isNarrow = vpW < 768;

  // Mobile: SELALU di bawah target supaya highlight tak pernah tertutup —
  // tak peduli tinggi balon (target sudah di-scroll ke atas, ruang cukup).
  // Horizontal dijepit ke layar; vertikal dibiarkan memanjang ke bawah.
  if (isNarrow) {
    const pos = placeAt(rect, 'bottom', tooltipW, tooltipH);
    return {
      style: { top: `${clampTop(pos.top)}px`, left: `${clampLeft(pos.left)}px` },
      placement: 'bottom',
    };
  }

  const order = [placement, opposite[placement], 'bottom', 'top', 'right', 'left'];

  const seen = new Set();
  for (const p of order) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const pos = placeAt(rect, p, tooltipW, tooltipH);
    if (axisFits(p, pos)) {
      const vertical = p === 'top' || p === 'bottom';
      const top = vertical ? pos.top : clampTop(pos.top);
      const left = vertical ? clampLeft(pos.left) : pos.left;
      return { style: { top: `${top}px`, left: `${left}px` }, placement: p };
    }
  }

  // Tidak ada yang muat → pakai placement awal, jepit kedua sumbu.
  const pos = placeAt(rect, placement, tooltipW, tooltipH) ||
    placeAt(rect, 'bottom', tooltipW, tooltipH);
  return { style: { top: `${clampTop(pos.top)}px`, left: `${clampLeft(pos.left)}px` }, placement };
}

// ─────────────────────────────────────────────────────────────
// Hook: efek "Eko sedang mengetik" — mengungkap teks huruf demi huruf
// ─────────────────────────────────────────────────────────────
function useTypewriter(text, speed = 16) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (!text) return;
    const id = setInterval(() => {
      setCount((c) => {
        if (c >= text.length) {
          clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  return { typed: text ? text.slice(0, count) : '', done: !text || count >= text.length };
}

// ─────────────────────────────────────────────────────────────
// Sub-komponen: gelembung ucapan Eko dengan teks mengetik.
// Teks penuh dirender transparan agar tinggi kotak stabil (posisi
// tidak meloncat saat teks bertambah), teks ketikan ditumpuk di atas.
// ─────────────────────────────────────────────────────────────
function EkoSpeech({ text }) {
  const { typed, done } = useTypewriter(text);
  return (
    <div className="relative leading-relaxed">
      <span className="invisible" aria-hidden="true">{text}</span>
      <span className="absolute inset-0 text-slate-200">
        {typed}
        {!done && <span className="tour-caret text-emerald-400">▍</span>}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Komponen Utama
// ─────────────────────────────────────────────────────────────
export default function TourOverlay({ onTourComplete, onDemoProcess, onStepChange }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ style: {}, placement: 'center' });
  const [demoLoading, setDemoLoading] = useState(false);
  const tooltipRef = useRef(null);

  const step = TOUR_STEPS[stepIdx];
  const isLastStep = stepIdx === TOUR_STEPS.length - 1;
  const isWelcome = step.placement === 'center';

  useEffect(() => {
    if (onStepChange) onStepChange(stepIdx, step.id);
  }, [stepIdx, step.id, onStepChange]);

  useEffect(() => {
    if (!step.targetId) {
      setTargetRect(null);
      setTooltipPos({ style: {}, placement: 'center' });
      return;
    }

    let raf;
    const updatePos = () => {
      const el = document.getElementById(step.targetId);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
      const tW = tooltipRef.current?.offsetWidth || 320;
      const tH = tooltipRef.current?.offsetHeight || 280;
      setTooltipPos(getTooltipPosition(rect, step.placement, tW, tH));
    };

    const timer = setTimeout(() => {
      updatePos();
      // Pass kedua setelah tooltip ter-render agar tinggi aslinya terukur.
      raf = requestAnimationFrame(updatePos);
    }, 120);

    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [stepIdx, step.targetId, step.placement]);

  useEffect(() => {
    if (!step.targetId) return;
    const el = document.getElementById(step.targetId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [stepIdx, step.targetId]);

  const handleNext = () => {
    if (isLastStep) {
      onTourComplete();
    } else {
      setStepIdx((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setStepIdx((prev) => Math.max(0, prev - 1));
  };

  const handleForcedProcessClick = async () => {
    setDemoLoading(true);
    await onDemoProcess();
    setDemoLoading(false);
    setStepIdx((prev) => prev + 1);
  };

  // ── SVG Spotlight Cutout ──
  const renderSpotlight = () => {
    if (!targetRect) return null;
    const PAD = 8;
    const r = 10;
    const x = targetRect.left - PAD;
    const y = targetRect.top - PAD;
    const w = targetRect.width + PAD * 2;
    const h = targetRect.height + PAD * 2;

    return (
      <svg
        className="fixed inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 9998 }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={r} fill="black" />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.72)"
          mask="url(#spotlight-mask)"
        />
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={r}
          fill="none"
          stroke="rgba(148,163,184,0.5)"
          strokeWidth="1.5"
        />
      </svg>
    );
  };

  return (
    <>
      {/* Blocker klik/interaksi layar penuh selama panduan aktif */}
      <div 
        className="fixed inset-0 bg-transparent" 
        style={{ zIndex: 9990, pointerEvents: 'auto' }} 
      />

      {/* Overlay gelap */}
      {(isWelcome || !targetRect) && (
        <div className="fixed inset-0 bg-black/75" style={{ zIndex: 9998 }} />
      )}
      {!isWelcome && renderSpotlight()}

      {isWelcome ? (
        /* ── Welcome / Farewell: Eko + balon ucapan ── */
        <div
          className="fixed z-[9999] w-[min(31rem,92vw)] flex flex-col"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Eko di atas, di tengah */}
          <div key={stepIdx} className="tour-mascot flex justify-center -mb-1 sm:-mb-3 pointer-events-none select-none">
            <img
              src="/icon.webp"
              alt="Eko, maskot pemandu EcoMonitor"
              className="tour-eko-bob w-[12.6rem] h-[12.6rem] sm:w-[21.7rem] sm:h-[21.7rem] object-contain drop-shadow-2xl"
            />
          </div>

          {/* Balon ucapan — hanya kata-kata Eko */}
          <div className="relative rounded-[28px] px-6 py-5 pt-7 sm:px-7 sm:py-6 border border-slate-700/70 ring-1 ring-white/5 shadow-2xl shadow-black/50 bg-gradient-to-br from-slate-800 to-slate-900">
            {/* buntut balon menunjuk ke Eko */}
            <div
              className="absolute -top-[14px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[14px] border-r-[14px] border-b-[15px] border-l-transparent border-r-transparent"
              style={{ borderBottomColor: 'rgba(148,163,184,0.45)' }}
            />
            <div className="absolute -top-[11px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-b-[13px] border-l-transparent border-r-transparent border-b-slate-800" />

            <h3 className="text-white font-bold text-lg sm:text-2xl leading-snug mb-1.5 text-center">{step.title}</h3>
            <div className="text-slate-200 text-center text-sm sm:text-base">
              <EkoSpeech key={stepIdx} text={step.content} />
            </div>
          </div>

          {/* Kontrol navigasi — di luar balon */}
          <div className="flex items-center gap-1.5 mt-4 mb-3 px-2">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === stepIdx
                    ? 'w-5 bg-emerald-400'
                    : i < stepIdx
                    ? 'w-1.5 bg-emerald-700/80'
                    : 'w-1.5 bg-slate-700'
                }`}
              />
            ))}
            <span className="ml-auto text-[11px] tabular-nums text-slate-500">
              {stepIdx + 1}/{TOUR_STEPS.length}
            </span>
          </div>

          {step.isFarewell ? (
            <div className="flex flex-col gap-2.5 w-full px-1">
              <a
                href="/evaluasi"
                onClick={() => onTourComplete()}
                className="flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer no-underline active:scale-95 shadow-lg shadow-emerald-900/40"
              >
                Bantu Isi Kuesioner
              </a>
              <button
                onClick={onTourComplete}
                className="flex items-center justify-center gap-2 py-2 text-slate-300 hover:text-white text-xs font-semibold rounded-xl transition-all cursor-pointer active:scale-95 border border-slate-700/80 hover:border-slate-600 bg-slate-900/50"
              >
                Jelajahi Lebih Lanjut
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-1">
              <button
                onClick={onTourComplete}
                className="text-slate-500 hover:text-slate-300 text-xs transition-colors cursor-pointer"
              >
                Lewati
              </button>
              <button
                onClick={handleNext}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer active:scale-95 shadow-lg shadow-emerald-900/40"
              >
                Lanjut <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ── Step normal ── */
        <div
          ref={tooltipRef}
          className="fixed z-[9999] w-[min(28rem,92vw)] flex flex-col"
          style={{
            ...tooltipPos.style,
            opacity: tooltipPos.style?.top ? 1 : 0,
            transition: 'opacity 160ms ease',
          }}
        >
          {/* Eko besar, berdiri di luar balon */}
          <div
            key={stepIdx}
            className="tour-mascot self-start ml-2 -mb-1 sm:-mb-4 z-10 pointer-events-none select-none"
          >
            <img
              src="/icon.webp"
              alt="Eko, maskot pemandu EcoMonitor"
              className="tour-eko-bob w-[9.8rem] h-[9.8rem] sm:w-[15.4rem] sm:h-[15.4rem] object-contain drop-shadow-2xl"
            />
          </div>

          {/* Balon ucapan Eko — hanya kata-katanya */}
          <div className="relative rounded-[26px] rounded-tl-md px-5 py-4 pt-6 sm:px-6 sm:py-5 border border-slate-700/70 ring-1 ring-white/5 shadow-2xl shadow-black/40 bg-gradient-to-br from-slate-800 to-slate-900">
            {/* buntut balon menunjuk ke Eko */}
            <div
              className="absolute -top-[14px] left-10 w-0 h-0 border-l-[14px] border-r-[14px] border-b-[15px] border-l-transparent border-r-transparent"
              style={{ borderBottomColor: 'rgba(148,163,184,0.45)' }}
            />
            <div className="absolute -top-[11px] left-[2.65rem] w-0 h-0 border-l-[12px] border-r-[12px] border-b-[13px] border-l-transparent border-r-transparent border-b-slate-800" />

            <h3 className="text-white font-bold text-base sm:text-lg mb-1.5 leading-snug">{step.title}</h3>
            <div className="text-slate-200 text-sm sm:text-base">
              <EkoSpeech key={stepIdx} text={step.content} />
            </div>
          </div>

          {/* Kontrol navigasi — di luar balon */}
          <div className="flex items-center gap-1.5 mt-4 mb-3 px-2">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === stepIdx
                    ? 'w-5 bg-emerald-400'
                    : i < stepIdx
                    ? 'w-1.5 bg-emerald-700/80'
                    : 'w-1.5 bg-slate-700'
                }`}
              />
            ))}
            <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
              {stepIdx + 1}/{TOUR_STEPS.length}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-1">
            <button
              onClick={onTourComplete}
              className="text-slate-500 hover:text-slate-300 text-xs transition-colors cursor-pointer"
            >
              Lewati
            </button>

            <div className="flex items-center gap-2">
              {stepIdx > 0 && (
                <button
                  onClick={handleBack}
                  disabled={demoLoading}
                  className="flex items-center gap-1 px-3 py-2 text-slate-300 hover:text-white text-sm font-semibold rounded-xl border border-slate-700/80 hover:border-slate-600 bg-slate-900/50 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  <ChevronLeft size={15} /> Kembali
                </button>
              )}

              {!step.forcedClick && (
                <button
                  onClick={handleNext}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer active:scale-95 shadow-lg shadow-emerald-900/40"
                >
                  {isLastStep ? 'Selesai' : 'Lanjut'}
                  {!isLastStep && <ChevronRight size={15} />}
                </button>
              )}

              {step.forcedClick && (
                <button
                  onClick={handleForcedProcessClick}
                  disabled={demoLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer active:scale-95 disabled:opacity-50 shadow-lg shadow-emerald-900/40"
                >
                  {demoLoading && <span className="animate-spin text-base">⟳</span>}
                  {demoLoading ? 'Memproses...' : 'Proses Data'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .tour-mascot {
          animation: tour-mascot-pop 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes tour-mascot-pop {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.85);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        /* Eko bergoyang halus seolah sedang berbicara */
        .tour-eko-bob {
          animation: tour-eko-bob 2.6s ease-in-out infinite;
        }
        @keyframes tour-eko-bob {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }
        /* Kursor ketik berkedip */
        .tour-caret {
          animation: tour-caret 0.9s steps(1) infinite;
        }
        @keyframes tour-caret {
          0%,
          50% {
            opacity: 1;
          }
          50.01%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}


// ─────────────────────────────────────────────────────────────
// Tombol untuk buka ulang tour (dirender di navbar)
// ─────────────────────────────────────────────────────────────
export function TourTriggerButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Buka panduan"
      className="p-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer group"
      aria-label="Buka panduan"
    >
      <HelpCircle size={20} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
    </button>
  );
}
