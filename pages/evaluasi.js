// pages/evaluasi.js
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { ArrowLeft, Check, ChevronRight, ChevronLeft, AlertCircle, Activity } from 'lucide-react';

// Inisialisasi Supabase Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const ueqCategories = [
    {
        id: "attractiveness",
        title: "Daya Tarik",
        description: "Penilaian kesan pertama dan daya tarik visual aplikasi",
        items: [
            { id: 1, left: "Menjengkelkan", right: "Menyenangkan" },
            { id: 12, left: "Buruk", right: "Baik" },
            { id: 14, left: "Tidak menyenangkan", right: "Menyenangkan" },
            { id: 16, left: "Tidak ramah pengguna", right: "Ramah pengguna" },
            { id: 7, left: "Tidak menarik", right: "Menarik" },
            { id: 5, left: "Tidak bermanfaat", right: "Bermanfaat" }
        ]
    },
    {
        id: "perspicuity",
        title: "Kejelasan",
        description: "Seberapa mudah memahami dan mempelajari aplikasi",
        items: [
            { id: 2, left: "Sulit dipahami", right: "Mudah dipahami" },
            { id: 4, left: "Sulit dipelajari", right: "Mudah dipelajari" },
            { id: 13, left: "Rumit", right: "Sederhana" },
            { id: 18, left: "Membingungkan", right: "Jelas" }
        ]
    },
    {
        id: "efficiency",
        title: "Efisiensi",
        description: "Kecepatan dan ketepatan dalam menyelesaikan tugas",
        items: [
            { id: 9, left: "Lambat", right: "Cepat" },
            { id: 19, left: "Tidak praktis", right: "Praktis" },
            { id: 20, left: "Berantakan", right: "Teratur" },
            { id: 23, left: "Tidak efisien", right: "Efisien" }
        ]
    },
    {
        id: "dependability",
        title: "Ketepatan",
        description: "Keandalan dan keamanan penggunaan aplikasi",
        items: [
            { id: 8, left: "Tidak dapat diprediksi", right: "Dapat diprediksi" },
            { id: 11, left: "Menghambat", right: "Mendukung" },
            { id: 24, left: "Tidak logis", right: "Logis" },
            { id: 25, left: "Tidak aman", right: "Aman" }
        ]
    },
    {
        id: "stimulation",
        title: "Stimulasi",
        description: "Seberapa menarik dan memotivasi penggunaan aplikasi",
        items: [
            { id: 6, left: "Membosankan", right: "Mengasyikkan" },
            { id: 26, left: "Tidak memotivasi", right: "Memotivasi" },
            { id: 21, left: "Kaku", right: "Fleksibel" },
            { id: 22, left: "Sulit digunakan", right: "Mudah digunakan" }
        ]
    },
    {
        id: "novelty",
        title: "Kebaruan",
        description: "Tingkat kreativitas dan inovasi desain aplikasi",
        items: [
            { id: 3, left: "Monoton", right: "Kreatif" },
            { id: 10, left: "Konvensional", right: "Berdaya cipta" },
            { id: 15, left: "Kuno", right: "Modern" },
            { id: 17, left: "Konservatif", right: "Inovatif" }
        ]
    }
];

export default function Evaluasi() {
    const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
    const [answers, setAnswers] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);

    const currentCategory = ueqCategories[currentCategoryIndex];
    const totalCategories = ueqCategories.length;

    // Progress tracking per category
    const answeredInCategory = currentCategory.items.filter(item => answers[item.id] !== undefined).length;
    const totalInCategory = currentCategory.items.length;
    const isCategoryComplete = answeredInCategory === totalInCategory;

    // Total progress across all categories
    const totalAnswered = Object.keys(answers).length;
    const totalQuestions = ueqCategories.reduce((sum, cat) => sum + cat.items.length, 0);

    const handleSelect = (itemId, value) => {
        setAnswers(prev => ({ ...prev, [itemId]: value }));
        setErrorMessage(null);
    };

    // Isi serentak satu kategori. Butir yang sudah terjawab ikut tertimpa:
    // kalau yang terisi saja yang dilewati, hasil klik jadi bergantung urutan
    // pengisian sebelumnya dan pengguna tidak bisa menduga apa yang berubah.
    // Cakupannya sengaja dibatasi pada kategori yang sedang tampil, jadi yang
    // tertimpa selalu yang terlihat di layar.
    const handleSelectAllInCategory = (value) => {
        setAnswers(prev => {
            const next = { ...prev };
            for (const item of currentCategory.items) next[item.id] = value;
            return next;
        });
        setErrorMessage(null);
    };

    // Nilai yang sedang berlaku untuk seluruh kategori, dipakai menyorot tombol
    // isi serentak. null berarti isiannya beragam atau belum lengkap — dan itu
    // keadaan yang wajar, karena nilai per butir tetap boleh diubah sesudahnya.
    const uniformCategoryValue = (() => {
        const first = answers[currentCategory.items[0]?.id];
        if (first === undefined) return null;
        return currentCategory.items.every(item => answers[item.id] === first) ? first : null;
    })();

    const handlePrevCategory = () => {
        if (currentCategoryIndex > 0) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setCurrentCategoryIndex(prev => prev - 1);
            setErrorMessage(null);
        }
    };

    const handleNextCategory = () => {
        if (currentCategoryIndex < totalCategories - 1) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setCurrentCategoryIndex(prev => prev + 1);
            setErrorMessage(null);
        }
    };

    const handleSubmitClick = () => {
        // Validasi semua jawaban terisi dan dalam range 1-7
        for (let i = 1; i <= 26; i++) {
            const val = answers[i];
            if (val === undefined || val === null || !Number.isInteger(val) || val < 1 || val > 7) {
                setErrorMessage("Mohon lengkapi semua jawaban (1-7) sebelum menyimpan.");
                return;
            }
        }
        setShowConfirmModal(true);
    };

    const submitEvaluasi = async () => {
        setShowConfirmModal(false);
        setIsSubmitting(true);
        setErrorMessage(null);

        try {
            // Validasi akhir yang ketat sebelum dikirim ke Supabase
            const payload = {};
            for (let i = 1; i <= 26; i++) {
                const val = answers[i];
                // Pastikan nilai ada, integer, dan di antara 1-7
                if (val === undefined || val === null || !Number.isInteger(val) || val < 1 || val > 7) {
                    throw new Error("Terdapat data kuesioner yang tidak valid. Mohon isi semua pertanyaan dengan nilai 1-7.");
                }
                payload[`item_${i}`] = val;
            }

            const { error } = await supabase
                .from('ueq_responses')
                .insert([payload]);

            if (error) throw error;

            setIsSubmitting(false);
            setIsSubmitted(true);
        } catch (error) {
            console.error("Gagal menyimpan data:", error.message);
            setIsSubmitting(false);
            setErrorMessage("Gagal menyimpan data. Pastikan koneksi internet stabil atau sistem sedang dalam perbaikan.");
        }
    };

    // === HALAMAN SUKSES ===
    if (isSubmitted) {
        return (
            <div className="min-h-screen w-full bg-slate-50 text-slate-800 flex items-center justify-center p-6 font-sans">
                <Head><title>Evaluasi Selesai — Spatio-Temporal Analysis Engine</title></Head>
                <div className="text-center max-w-md animate-fade-in">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-6">
                        <Check size={32} className="text-emerald-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">Data Berhasil Disimpan</h1>
                    <p className="text-slate-500 text-sm mb-8 leading-relaxed">Terima kasih atas partisipasi Anda. Data evaluasi telah berhasil direkam untuk keperluan analisis penelitian.</p>
                    <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 text-white rounded-xl font-semibold text-sm hover:bg-slate-900 transition-colors no-underline shadow-lg">
                        <ArrowLeft size={16} />
                        Kembali ke Halaman Utama
                    </Link>
                </div>
            </div>
        );
    }

    // === HALAMAN EVALUASI ===
    return (
        <div className="min-h-screen w-full bg-slate-50 text-slate-800 flex flex-col items-center py-6 md:py-8 px-4 font-sans selection:bg-slate-200">
            <Head>
                <title>Instrumen Evaluasi UEQ — Spatio-Temporal Analysis Engine</title>
                <meta name="description" content="Instrumen evaluasi pengalaman pengguna (UEQ) untuk aplikasi analisis LST dan NDVI wilayah Bali." />
            </Head>

            {/* Confirmation Modal */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowConfirmModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-sm w-full animate-fade-in" onClick={e => e.stopPropagation()}>
                        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                            <AlertCircle size={24} className="text-slate-500" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 text-center mb-2">Konfirmasi Pengiriman</h3>
                        <p className="text-sm text-slate-500 text-center mb-6 leading-relaxed">
                            Anda yakin ingin menyimpan data evaluasi? Data yang sudah dikirim tidak dapat diubah.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowConfirmModal(false)}
                                className="flex-1 py-2.5 text-sm font-semibold text-slate-600 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                            >
                                Batal
                            </button>
                            <button
                                onClick={submitEvaluasi}
                                className="flex-1 py-2.5 text-sm font-bold text-white bg-slate-800 rounded-xl hover:bg-slate-900 transition-colors cursor-pointer"
                            >
                                Ya, Simpan
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-10">

                {/* Header */}
                <div className="border-b border-slate-200 pb-6 mb-8">
                    <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-4">
                        <div>
                            <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors no-underline mb-3">
                                <ArrowLeft size={12} />
                                Kembali ke Peta
                            </Link>
                            <div className="flex items-center gap-2.5 mb-2">
                                <Activity size={20} className="text-slate-800" />
                                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight">Evaluasi Pengalaman Pengguna</h1>
                            </div>
                            <p className="text-slate-500 text-sm">Berikan penilaian yang paling merepresentasikan pengalaman Anda.</p>
                        </div>
                        <div className="flex flex-col items-start md:items-end gap-2 self-start md:self-auto">
                            <span className="text-xs font-mono text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                                Langkah {currentCategoryIndex + 1} / {totalCategories}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                                {totalAnswered}/{totalQuestions} item terisi
                            </span>
                        </div>
                    </div>

                    {/* Global progress bar */}
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                        <div
                            className="bg-slate-800 h-full transition-all duration-500 ease-out rounded-full"
                            style={{ width: `${((currentCategoryIndex + 1) / totalCategories) * 100}%` }}
                        ></div>
                    </div>

                    {/* Category title & progress */}
                    <div className="mt-6 mb-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-lg md:text-xl font-bold text-slate-800 tracking-tight">
                                    {currentCategory.title}
                                </h2>
                                <p className="text-slate-400 text-xs mt-1">
                                    {currentCategory.description}
                                </p>
                            </div>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full transition-colors ${isCategoryComplete ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                {answeredInCategory}/{totalInCategory}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Isi serentak. Ditaruh di atas daftar, bukan di bawah, supaya
                    terbaca sebagai titik awal pengisian dan bukan sebagai
                    pembetulan setelah semua butir terlanjur dijawab. Lebar
                    kolomnya dibuat sama dengan baris butir supaya angka 1–7 di
                    sini tepat sejajar dengan angka 1–7 di bawahnya. */}
                <div className="relative mb-3 md:mb-4 flex flex-col md:flex-row items-center justify-between gap-3 md:gap-8 p-3 md:px-5 md:py-3 rounded-xl border border-dashed border-slate-200 bg-white">
                    {/* Label menempel di garis kotak, bukan di dalam salah satu
                        kolom. Latar putihnya memotong garis putus-putus supaya
                        terbaca sebagai judul kotak; kalau ditaruh di kolom kiri
                        ia akan tampak seperti kutub kiri sebuah butir. */}
                    <span className="absolute -top-2 left-4 px-1.5 bg-white text-[11px] font-medium text-slate-400 select-none">
                        Isi serentak
                    </span>

                    {/* Dua span kosong ini penyangga lebar, bukan sisa teks yang
                        terlupa: baris butir di bawah memakai label selebar 1/4 di
                        kiri dan kanan, dan tanpa penyangga yang sama angka 1–7 di
                        sini akan melenceng dari angka 1–7 di bawahnya. */}
                    <span aria-hidden="true" className="hidden md:block md:w-1/4" />

                    <div className="flex justify-center w-full md:w-auto space-x-1.5 md:space-x-3">
                        {[1, 2, 3, 4, 5, 6, 7].map((num) => {
                            const isSelected = uniformCategoryValue === num;
                            return (
                                <button
                                    key={num}
                                    onClick={() => handleSelectAllInCategory(num)}
                                    aria-label={`Isi semua butir kategori ini dengan ${num}`}
                                    className="touch-manipulation outline-none cursor-pointer"
                                >
                                    <div className={`
                                        w-9 h-11 md:w-12 md:h-14 rounded-lg md:rounded-xl border text-sm md:text-base font-bold flex items-center justify-center transition-all duration-200 select-none
                                        ${isSelected
                                            ? 'bg-slate-700 text-white border-slate-700'
                                            : 'bg-white border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 active:scale-95'
                                        }
                                    `}>
                                        {num}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <span aria-hidden="true" className="hidden md:block md:w-1/4" />
                </div>

                {/* Question Items */}
                <div className="space-y-3 md:space-y-4">
                    {currentCategory.items.map((item, index) => {
                        const isAnswered = answers[item.id] !== undefined;
                        return (
                            <div
                                key={`${currentCategory.id}-${item.id}`}
                                className={`flex flex-col md:flex-row items-center justify-between gap-4 md:gap-8 p-4 md:p-5 rounded-xl border transition-all duration-200 animate-fade-in ${isAnswered ? 'bg-white border-slate-200' : 'bg-slate-50/50 border-slate-100 hover:border-slate-200'}`}
                                style={{ animationDelay: `${index * 50}ms` }}
                            >
                                <span className="w-full md:w-1/4 text-center md:text-right text-sm font-medium text-slate-500">
                                    {item.left}
                                </span>

                                <div className="flex justify-center w-full md:w-auto space-x-1.5 md:space-x-3">
                                    {[1, 2, 3, 4, 5, 6, 7].map((num) => {
                                        const isSelected = answers[item.id] === num;
                                        return (
                                            <button
                                                key={num}
                                                onClick={() => handleSelect(item.id, num)}
                                                className="touch-manipulation outline-none cursor-pointer"
                                            >
                                                <div className={`
                                                    relative w-9 h-11 md:w-12 md:h-14 rounded-lg md:rounded-xl border text-sm md:text-base font-bold flex items-center justify-center transition-all duration-200 select-none
                                                    ${isSelected
                                                        ? 'bg-slate-800 text-white border-slate-800 scale-110 shadow-lg z-10'
                                                        : 'bg-white border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 active:scale-95'
                                                    }
                                                `}>
                                                    {num}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <span className="w-full md:w-1/4 text-center md:text-left text-sm font-medium text-slate-500">
                                    {item.right}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* Error Notification */}
                {errorMessage && (
                    <div className="mt-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start md:items-center gap-3 animate-fade-in">
                        <AlertCircle size={18} className="text-rose-500 flex-shrink-0 mt-0.5 md:mt-0" />
                        <p className="text-sm text-rose-600 leading-relaxed font-medium">{errorMessage}</p>
                    </div>
                )}

                {/* Navigation */}
                <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col-reverse md:flex-row justify-between items-center gap-4">
                    <button
                        disabled={currentCategoryIndex === 0}
                        onClick={handlePrevCategory}
                        className="w-full md:w-auto px-5 py-3 text-sm font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl disabled:opacity-0 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                        <ChevronLeft size={16} />
                        Kembali
                    </button>

                    {currentCategoryIndex === totalCategories - 1 ? (
                        <button
                            disabled={!isCategoryComplete || isSubmitting}
                            onClick={handleSubmitClick}
                            className={`w-full md:w-auto px-8 py-3 text-sm font-bold rounded-xl transition-all duration-300 shadow-lg flex items-center justify-center gap-2 cursor-pointer
                                ${isCategoryComplete
                                    ? 'bg-slate-800 text-white hover:bg-slate-900 shadow-slate-300'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                                }`}
                        >
                            {isSubmitting ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Menyimpan Data...
                                </>
                            ) : (
                                <>
                                    <Check size={16} />
                                    Simpan Data
                                </>
                            )}
                        </button>
                    ) : (
                        <button
                            disabled={!isCategoryComplete}
                            onClick={handleNextCategory}
                            className={`w-full md:w-auto px-8 py-3 text-sm font-bold rounded-xl transition-all duration-300 shadow-lg flex items-center justify-center gap-2 cursor-pointer
                                ${isCategoryComplete
                                    ? 'bg-slate-800 text-white hover:bg-slate-900 shadow-slate-300'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                                }`}
                        >
                            Selanjutnya
                            <ChevronRight size={16} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}