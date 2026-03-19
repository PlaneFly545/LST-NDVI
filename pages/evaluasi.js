// pages/evaluasi.js
import { useState } from 'react';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';

// Inisialisasi Supabase Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const ueqCategories = [
    {
        id: "attractiveness",
        title: "Daya Tarik",
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

    // State baru untuk menampung pesan error
    const [errorMessage, setErrorMessage] = useState(null);

    const currentCategory = ueqCategories[currentCategoryIndex];
    const totalCategories = ueqCategories.length;

    const handleSelect = (itemId, value) => {
        setAnswers(prev => ({ ...prev, [itemId]: value }));
        setErrorMessage(null); // Hilangkan pesan error jika user mulai berinteraksi lagi
    };

    const handleQuickFill = (value) => {
        const newAnswers = { ...answers };
        currentCategory.items.forEach(item => {
            newAnswers[item.id] = value;
        });
        setAnswers(newAnswers);
        setErrorMessage(null);
    };

    const isCategoryComplete = currentCategory.items.every(item => answers[item.id] !== undefined);

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

    const submitEvaluasi = async () => {
        setIsSubmitting(true);
        setErrorMessage(null); // Reset error setiap kali mulai submit baru

        try {
            // Memformat data jawaban (ID 1-26) ke dalam kolom item_1 s/d item_26
            const payload = {};
            for (let i = 1; i <= 26; i++) {
                payload[`item_${i}`] = answers[i] || null;
            }

            // Mengirim data ke tabel ueq_responses di Supabase
            const { error } = await supabase
                .from('ueq_responses')
                .insert([payload]);

            if (error) throw error;

            // Jika berhasil
            setIsSubmitting(false);
            setIsSubmitted(true);
        } catch (error) {
            console.error("Gagal menyimpan data:", error.message);
            setIsSubmitting(false);
            // Set state error alih-alih menggunakan alert()
            setErrorMessage("Gagal menyimpan data. Pastikan koneksi internet stabil atau sistem sedang dalam perbaikan.");
        }
    };

    if (isSubmitted) {
        return (
            <div className="min-h-screen w-full bg-[#0a0a0a] text-gray-200 flex items-center justify-center p-6 font-sans">
                <Head><title>Evaluasi Selesai</title></Head>
                <div className="text-center max-w-md animate-fade-in">
                    <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">Data Berhasil Disimpan</h1>
                    <p className="text-gray-400 mb-8 leading-relaxed">Terima kasih atas partisipasi Anda. Data evaluasi telah berhasil direkam untuk keperluan analisis penelitian.</p>
                    <a href="/" className="px-8 py-3.5 bg-white text-black rounded-xl font-bold hover:bg-gray-200 hover:scale-105 transition-all shadow-[0_0_20px_rgba(255,255,255,0.2)] inline-block">
                        Kembali ke Halaman Utama
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full bg-[#0a0a0a] text-gray-200 flex flex-col items-center py-8 px-4 font-sans selection:bg-neutral-800">
            <Head>
                <title>Instrumen Evaluasi UEQ</title>
            </Head>

            <div className="w-full max-w-4xl bg-[#111111] border border-neutral-800/80 rounded-2xl md:rounded-3xl shadow-2xl p-5 md:p-10">

                {/* Header */}
                <div className="border-b border-neutral-800/80 pb-6 mb-8">
                    <div className="flex flex-col md:flex-row justify-between md:items-end gap-4 mb-4">
                        <div>
                            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Evaluasi Pengalaman Pengguna</h1>
                            <p className="text-gray-400 text-sm mt-2">Berikan penilaian yang paling merepresentasikan pengalaman Anda.</p>
                        </div>
                        <div className="self-start md:self-auto">
                            <span className="text-xs md:text-sm font-mono text-gray-300 bg-neutral-800 px-4 py-2 rounded-full border border-neutral-700">
                                Langkah {currentCategoryIndex + 1} dari {totalCategories}
                            </span>
                        </div>
                    </div>

                    <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden mt-2">
                        <div
                            className="bg-white h-full transition-all duration-500 ease-out"
                            style={{ width: `${((currentCategoryIndex + 1) / totalCategories) * 100}%` }}
                        ></div>
                    </div>

                    {/* Judul Kategori di Tengah */}
                    <div className="mt-8 mb-2 text-center">
                        <h2 className="text-xl md:text-2xl font-bold text-white tracking-wide">
                            {currentCategory.title}
                        </h2>
                        <p className="text-neutral-400 text-sm mt-1">
                            Fokus penilaian pada aspek {currentCategory.title.toLowerCase()} aplikasi
                        </p>
                    </div>
                </div>

                {/* Panel Penilaian Serentak - Formal dan Sejajar */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-8 bg-neutral-800/40 p-4 md:p-5 rounded-xl border border-neutral-700 mb-6 shadow-sm">
                    <span className="w-full md:w-1/4 text-center md:text-right text-sm md:text-base font-medium text-gray-300">
                        Penilaian Serentak
                    </span>

                    <div className="flex justify-center w-full md:w-auto space-x-1.5 md:space-x-3">
                        {[1, 2, 3, 4, 5, 6, 7].map((num) => (
                            <button
                                key={`quick-${num}`}
                                onClick={() => handleQuickFill(num)}
                                className="touch-manipulation outline-none"
                            >
                                <div className="relative w-9 h-11 md:w-12 md:h-14 rounded-lg md:rounded-xl border border-neutral-600 bg-neutral-800 text-gray-300 text-sm md:text-base font-bold flex items-center justify-center hover:bg-neutral-700 hover:text-white transition-all duration-200 active:scale-95">
                                    {num}
                                </div>
                            </button>
                        ))}
                    </div>

                    <span className="w-full md:w-1/4 hidden md:block"></span>
                </div>

                {/* Daftar Pertanyaan */}
                <div className="space-y-4 md:space-y-5">
                    {currentCategory.items.map((item, index) => (
                        <div
                            key={`${currentCategory.id}-${item.id}`}
                            className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-8 bg-neutral-900/50 p-4 md:p-5 rounded-xl border border-neutral-800 hover:border-neutral-700 transition-colors animate-fade-in"
                            style={{ animationDelay: `${index * 50}ms` }}
                        >
                            <span className="w-full md:w-1/4 text-center md:text-right text-sm md:text-base font-medium text-gray-300">
                                {item.left}
                            </span>

                            <div className="flex justify-center w-full md:w-auto space-x-1.5 md:space-x-3">
                                {[1, 2, 3, 4, 5, 6, 7].map((num) => {
                                    const isSelected = answers[item.id] === num;
                                    return (
                                        <button
                                            key={num}
                                            onClick={() => handleSelect(item.id, num)}
                                            className="touch-manipulation outline-none"
                                        >
                                            <div className={`
                                                relative w-9 h-11 md:w-12 md:h-14 rounded-lg md:rounded-xl border text-sm md:text-base font-bold flex items-center justify-center transition-all duration-200 select-none
                                                ${isSelected
                                                    ? 'bg-white text-black border-transparent scale-110 shadow-[0_0_15px_rgba(255,255,255,0.4)] z-10'
                                                    : 'bg-[#1a1a1a] border-neutral-700 text-gray-400 hover:border-gray-400 hover:text-gray-200 active:scale-95'
                                                }
                                            `}>
                                                {num}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <span className="w-full md:w-1/4 text-center md:text-left text-sm md:text-base font-medium text-gray-300">
                                {item.right}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Notifikasi Error (Hanya muncul jika ada error) */}
                {errorMessage && (
                    <div className="mt-8 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start md:items-center gap-3 animate-fade-in">
                        <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5 md:mt-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm text-red-200 leading-relaxed">{errorMessage}</p>
                    </div>
                )}

                {/* Navigasi Manual */}
                <div className="mt-8 pt-6 border-t border-neutral-800 flex flex-col-reverse md:flex-row justify-between items-center gap-4">
                    <button
                        disabled={currentCategoryIndex === 0}
                        onClick={handlePrevCategory}
                        className="w-full md:w-auto px-6 py-3.5 text-sm md:text-base font-medium text-gray-400 hover:text-white hover:bg-neutral-800 rounded-xl disabled:opacity-0 transition-all"
                    >
                        Kembali
                    </button>

                    {currentCategoryIndex === totalCategories - 1 ? (
                        <button
                            disabled={!isCategoryComplete || isSubmitting}
                            onClick={submitEvaluasi}
                            className={`w-full md:w-auto px-8 py-3.5 text-sm md:text-base font-bold rounded-xl transition-all duration-300 shadow-lg flex items-center justify-center gap-2
                                ${isCategoryComplete
                                    ? 'bg-white text-black hover:scale-[1.02] shadow-white/20'
                                    : 'bg-neutral-800 text-gray-600 cursor-not-allowed shadow-none'
                                }`}
                        >
                            {isSubmitting ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Menyimpan Data...
                                </>
                            ) : 'Simpan Data'}
                        </button>
                    ) : (
                        <button
                            disabled={!isCategoryComplete}
                            onClick={handleNextCategory}
                            className={`w-full md:w-auto px-8 py-3.5 text-sm md:text-base font-bold rounded-xl transition-all duration-300 shadow-lg
                                ${isCategoryComplete
                                    ? 'bg-white text-black hover:scale-[1.02] shadow-white/20'
                                    : 'bg-neutral-800 text-gray-600 cursor-not-allowed shadow-none'
                                }`}
                        >
                            Selanjutnya
                        </button>
                    )}
                </div>
            </div>

            <style jsx global>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in {
                    animation: fadeIn 0.4s ease-out forwards;
                }
            `}</style>
        </div>
    );
}