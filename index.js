const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Setup AI Gemini
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const steinUrl = process.env.STEIN_API_URL;

// Setup WhatsApp Bot
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('[-] SCAN QR CODE INI DENGAN WHATSAPP KAMU!');
});

client.on('ready', () => {
    console.log('[+] BOT TASKFLOW (VERSI STEIN) SUDAH AKTIF!');
});

client.on('message', async (msg) => {
    const teks = msg.body.trim();
    const teksLower = teks.toLowerCase();

    // 1. PERINTAH: /list (Melihat Tugas Belum Selesai dengan Format Tabel Terstruktur)
    if (teksLower === '/list') {
        try {
            const { data } = await axios.get(steinUrl);
            if (!data || data.length === 0) {
                return msg.reply("🎉 Yey! Tidak ada tugas sama sekali.");
            }

            // Filter data yang statusnya 'Belum Selesai'
            const tugasBelumSelesai = data.filter(row => row['Status'] === 'Belum Selesai');
            
            if (tugasBelumSelesai.length === 0) {
                return msg.reply("🎉 Yey! Tidak ada tugas yang menumpuk.");
            }

            let pesanBalasan = "*📋 DAFTAR TUGAS BELUM SELESAI*\n";
            pesanBalasan += "=============================\n\n";
            
            tugasBelumSelesai.forEach((row) => {
                pesanBalasan += `🆔 *ID:* ${row['ID']}\n`;
                pesanBalasan += `📚 *Mapel:* ${row['Mata Pelajaran']}\n`;
                pesanBalasan += `📝 *Deskripsi:* ${row['Deskripsi Tugas']}\n`;
                pesanBalasan += `📅 *Input:* ${row['Tanggal Input']}\n`;
                pesanBalasan += `⏰ *Deadline:* ${row['Deadline']}\n`;
                pesanBalasan += `🔥 *Prioritas:* ${row['Prioritas']}\n`;
                pesanBalasan += "-----------------------------------------\n";
            });
            
            return msg.reply(pesanBalasan);
        } catch (error) {
            console.error(error);
            return msg.reply('❌ Gagal mengambil data dari database.');
        }
    }

    // 2. PERINTAH: /selesai [ID] (Menandai Tugas Beres)
    if (teksLower.startsWith('/selesai ')) {
        const idTugas = teks.split(' ')[1];
        try {
            await axios.put(steinUrl, {
                condition: { "ID": idTugas },
                set: { "Status": "Selesai" }
            });
            return msg.reply(`✅ Tugas ID *${idTugas}* berhasil ditandai Selesai!`);
        } catch (error) {
            return msg.reply(`❌ Gagal memperbarui status tugas ID *${idTugas}*.`);
        }
    }

    // 3. PERINTAH: /hapus [ID] (Menghapus baris tugas dari Stein)
    if (teksLower.startsWith('/hapus ')) {
        const idTugas = teks.split(' ')[1];
        try {
            await axios.delete(steinUrl, {
                condition: { "ID": idTugas }
            });
            return msg.reply(`🗑️ Tugas ID *${idTugas}* berhasil dihapus dari database.`);
        } catch (error) {
            return msg.reply(`❌ Gagal menghapus tugas ID *${idTugas}*.`);
        }
    }

    // 4. PERINTAH: /edit [ID] [KOLOM] | [NILAI BARU]
    // Contoh: /edit 3 Deadline | 2026-06-10 23:59
    if (teksLower.startsWith('/edit ')) {
        try {
            const argumen = teks.substring(6).split('|');
            if (argumen.length < 2) {
                return msg.reply("⚠️ Format salah. Gunakan:\n`/edit [ID] [Nama Kolom] | [Nilai Baru]`\n\nContoh:\n`/edit 2 Deadline | 2026-06-08 14:00`\n`/edit 2 Status | Selesai`");
            }

            const bagianKiri = argumen[0].trim().split(' ');
            const idTugas = bagianKiri[0];
            // Menggabungkan sisa kata jika nama kolom terdiri dari beberapa kata (e.g., "Mata Pelajaran")
            const kolom = bagianKiri.slice(1).join(' '); 
            const nilaiBaru = argumen[1].trim();

            const updateObj = {};
            updateObj[kolom] = nilaiBaru;

            await axios.put(steinUrl, {
                condition: { "ID": idTugas },
                set: updateObj
            });

            return msg.reply(`📝 Tugas ID *${idTugas}* pada kolom *${kolom}* berhasil diubah menjadi: *${nilaiBaru}*`);
        } catch (error) {
            return msg.reply("❌ Gagal mengedit tugas. Pastikan nama kolom sesuai di Google Sheets (e.g., 'Deadline', 'Mata Pelajaran').");
        }
    }

    // 5. INPUT TEKS / GAMBAR UNTUK DICATAT AUTOMATIS OLEH AI
    if (teks.startsWith('/')) return; // Mengabaikan perintah tidak dikenal agar tidak masuk ke AI

    try {
        const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        // Dapatkan waktu saat ini untuk acuan AI menentukan waktu relatif (besok, lusa, jam, dll.)
        const wibTime = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        
        let promptTugas = `Analisis pesan atau gambar ini untuk mencari informasi instruksi tugas sekolah.
Waktu server saat ini adalah: ${wibTime}. 

Ekstrak data menjadi objek JSON dengan struktur murni berikut:
{
  "mata_pelajaran": "string",
  "deskripsi": "string",
  "deadline": "YYYY-MM-DD HH:mm",
  "prioritas": "Tinggi/Sedang/Rendah"
}

Aturan Penentuan Parameter:
1. "deadline": Harus menyertakan Tanggal dan Jam (Format wajib: YYYY-MM-DD HH:mm). Jika di teks hanya disebut "besok jam 12", hitung tanggal besok berdasarkan waktu saat ini (${wibTime}) lalu set jamnya ke 12:00. Jika tidak ada jam sama sekali, buat default ke "23:59".
2. "prioritas":
   - Set "Tinggi" jika terdapat kata kunci urgen seperti: PENTING, WAJIB, PROJECT, HARUS, KUIS, atau jika deadline sisa hitungan JAM dari sekarang.
   - Set "Sedang" jika deadline jatuh pada kisaran H-1 sampai H-3 HARI dari sekarang.
   - Set "Rendah" jika deadline masih longgar (minggu depan atau bulan depan).

Berikan HANYA JSON murni (raw JSON) tanpa dibungkus markdown \`\`\`json ... \`\`\` atau teks tambahan apa pun.`;

        let result;
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            await msg.reply('📸 AI sedang membaca lampiran tugas kamu...');
            const imagePart = { inlineData: { data: media.data, mimeType: media.mimetype } };
            result = await model.generateContent([promptTugas, imagePart]);
        } else {
            result = await model.generateContent(promptTugas);
        }

        // Sanitasi output teks dari AI untuk mengantisipasi jika AI masih membalas memakai markdown wrapper
        let jsonTeks = result.response.text().trim();
        jsonTeks = jsonTeks.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        
        const dataAI = JSON.parse(jsonTeks);

        // Ambil data sheet saat ini untuk menyusun auto-increment ID yang valid
        const responseData = await axios.get(steinUrl);
        const rows = responseData.data || [];
        
        // Logika penentuan ID berurutan secara dinamis yang valid dari angka 1
        let nextId = 1;
        if (rows.length > 0) {
            const idList = rows.map(r => parseInt(r.ID)).filter(id => !isNaN(id));
            if (idList.length > 0) {
                nextId = Math.max(...idList) + 1;
            }
        }

        // Mengambil tanggal hari ini (WIB)
        const hariIni = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }).split(',')[0].replace(/\//g, '-');

        // Post data baru ke Stein API
        await axios.post(steinUrl, [{
            "ID": nextId.toString(),
            "Mata Pelajaran": dataAI.mata_pelajaran || 'Umum',
            "Deskripsi Tugas": dataAI.deskripsi || 'Tidak ada deskripsi',
            "Tanggal Input": hariIni,
            "Deadline": dataAI.deadline || '-',
            "Status": "Belum Selesai",
            "Prioritas": dataAI.prioritas || "Sedang"
        }]);

        let balasan = `✅ *TUGAS BERHASIL DICATAT*\n\n🆔 *ID:* ${nextId}\n📚 *Mapel:* ${dataAI.mata_pelajaran}\n📝 *Deskripsi:* ${dataAI.deskripsi}\n📅 *Tgl Input:* ${hariIni}\n⏰ *Deadline:* ${dataAI.deadline}\n🔥 *Prioritas:* ${dataAI.prioritas}\n\n_Ketik /list untuk melihat daftar._`;
        return msg.reply(balasan);

    } catch (err) {
        console.error(err);
        if (!msg.hasMedia && !teks.startsWith('/')) {
             return msg.reply('❌ Maaf, AI gagal memproses data atau format tidak valid. Coba kirim ulang kalimat instruksi dengan lebih jelas.');
        }
    }
});

client.initialize();