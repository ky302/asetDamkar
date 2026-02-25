// ============================================================
// DAMKAR — SISTEM PELAPORAN ASET
// Google Apps Script Backend
// Dinas Pemadam Kebakaran Kota Luwu Timur
// ============================================================
//
// CARA SETUP LENGKAP:
// ──────────────────────────────────────────────────────────
// 1. Buka https://script.google.com → New Project
//    Beri nama: "DAMKAR Sistem Pelaporan Aset"
//
// 2. Buat Google Sheet baru:
//    - Buka https://sheets.google.com
//    - Beri nama: "DAMKAR Data Pelaporan"
//    - Salin ID dari URL (bagian antara /d/ dan /edit)
//
// 3. Paste seluruh kode ini, ganti SPREADSHEET_ID di bawah
//
// 4. Deploy:
//    Deploy → New deployment → Web App
//    Execute as: Me | Who has access: Anyone
//    Klik Deploy → salin URL
//
// 5. Paste URL ke DAMKAR_WebApp.html:
//    const SCRIPT_URL = 'PASTE_URL_DI_SINI';
//
// 6. Jalankan initSpreadsheet() sekali untuk setup awal
// ============================================================

const SPREADSHEET_ID = 'GANTI_DENGAN_ID_SPREADSHEET_ANDA';
const DRIVE_FOLDER   = 'DAMKAR_Bukti_Foto';
const EMAIL_LAPORAN  = 'email_kepala@example.com';
const NAMA_INSTANSI  = 'Dinas Pemadam Kebakaran Kota Luwu Timur';

const SHEET = {
  pendaftaran:  '✅ Pendaftaran Baru',
  kerusakan:    '🔧 Kerusakan',
  pengembalian: '🔄 Pengembalian',
};

const DAFTAR_POSKO = [
  'Mako','Kalaena','Angkona','Tomoni','Wasuponda',
  'Baruga','Burau','Wotu','Tomoni Timur','Towuti',
];

const KODE_POSKO = {
  'Mako':'MKO','Kalaena':'KLN','Angkona':'AKN','Tomoni':'TMN',
  'Wasuponda':'WSP','Baruga':'BRG','Burau':'BRU','Wotu':'WTU',
  'Tomoni Timur':'TMT','Towuti':'TWI',
};

const HEADERS = {
  pendaftaran: [
    'No','Timestamp','Nama Posko','Kode Posko','Nama Peralatan',
    'Merk / Type','Merk Lain','Jumlah','Satuan','Tahun Pengadaan','Link Foto',
  ],
  kerusakan: [
    'No','Timestamp','Tanggal Laporan','Waktu Laporan',
    'Nama Posko','Nama Pelapor','Nama Peralatan','Kode Aset',
    'Status Aset','Tingkat Kerusakan','Jumlah Barang',
    'Deskripsi Kejadian','Tindakan Sementara','Link Foto',
  ],
  pengembalian: [
    'No','Timestamp','Tanggal Pengembalian','Waktu Pengembalian',
    'Petugas Melaporkan','Petugas Menerima',
    'Posko Peminjam','Posko Asal Pemilik Aset',
    'Nama Peralatan','Jumlah Barang','Kondisi Dikembalikan','Link Foto',
  ],
};

// ─── HANDLER ─────────────────────────────────────────────────

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  if (action === 'getData')   return jsonResp(getAllData());
  if (action === 'getPosko')  return jsonResp({ poscos: DAFTAR_POSKO });
  if (action === 'export')    return jsonResp({ url: getExportUrl() });
  if (action === 'ping')      return jsonResp({ status:'ok', time: new Date().toISOString() });
  try {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('DAMKAR').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch(e) {
    return HtmlService.createHtmlOutput('<h2>DAMKAR API Online</h2>');
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    return jsonResp(simpanData(data));
  } catch(err) {
    Logger.log('Error: ' + err.message);
    return jsonResp({ status:'error', message: err.message });
  }
}

// ─── SIMPAN DATA ─────────────────────────────────────────────

function simpanData(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const type = data.type;
  if (!SHEET[type]) throw new Error('Tipe tidak dikenal: ' + type);

  let ws = ss.getSheetByName(SHEET[type]);
  if (!ws) { ws = ss.insertSheet(SHEET[type]); buatHeader(ws, HEADERS[type]); }

  let fotoUrl = '-';
  if (data.foto && data.foto.length > 10) {
    try { fotoUrl = uploadFoto(data.foto, data.fotoName||'foto.jpg', data.fotoType||'image/jpeg', type, data.posko||data.poskoPinjam||''); }
    catch(e) { fotoUrl = 'Upload gagal'; }
  }

  const now = new Date();
  const no = ws.getLastRow();
  const kode = KODE_POSKO[data.posko] || KODE_POSKO[data.poskoPinjam] || '-';
  let baris = [];

  if (type === 'pendaftaran') {
    const merk = (data.merk === 'Lain-lainnya') ? (data.merkLain||data.merk) : (data.merk||'-');
    baris = [no, now, data.posko, kode, data.peralatan, merk, data.merkLain||'-',
             Number(data.jumlah)||0, data.satuan||'Unit', Number(data.tahun)||'', fotoUrl];
  }
  else if (type === 'kerusakan') {
    baris = [no, now, data.tanggal, data.waktu, data.posko, data.pelapor, data.peralatan,
             data.kodeAset||'-', data.status, data.tingkat||'-', Number(data.jumlah)||1,
             data.deskripsi, data.tindakan||'-', fotoUrl];
  }
  else if (type === 'pengembalian') {
    baris = [no, now, data.tanggal, data.waktu, data.petugasLapor, data.petugasTerima,
             data.poskoPinjam, data.poskoAsal, data.peralatan, Number(data.jumlah)||1,
             data.kondisi, fotoUrl];
  }

  ws.appendRow(baris);
  formatBaris(ws, ws.getLastRow(), type);

  if (type==='kerusakan' && (data.status==='HILANG'||data.tingkat==='Rusak Total'||data.tingkat==='Berat')) {
    try { kirimNotif(data, no); } catch(e) {}
  }

  return { status:'ok', message:'Data berhasil disimpan', no, sheet: SHEET[type] };
}

// ─── HEADER & FORMAT ─────────────────────────────────────────

function buatHeader(ws, headers) {
  ws.appendRow(headers);
  const r = ws.getRange(1, 1, 1, headers.length);
  r.setBackground('#C0392B').setFontColor('#FFFFFF').setFontWeight('bold')
   .setFontSize(10).setFontFamily('Arial').setHorizontalAlignment('center');
  ws.setFrozenRows(1);
  ws.setRowHeight(1, 30);
}

function formatBaris(ws, row, type) {
  const even = row % 2 === 0;
  const bg = type==='kerusakan' ? (even?'#FEF5F5':'#FFFFFF')
           : type==='pengembalian' ? (even?'#F0FFFC':'#FFFFFF')
           : (even?'#F5F0FF':'#FFFFFF');
  ws.getRange(row,1,1,ws.getLastColumn()).setBackground(bg).setFontSize(9)
    .setFontFamily('Arial').setVerticalAlignment('middle');
  ws.setRowHeight(row, 20);
}

// ─── UPLOAD FOTO ─────────────────────────────────────────────

function uploadFoto(b64, name, mime, type, posko) {
  let folder = getOrCreate(DriveApp.getRootFolder(), DRIVE_FOLDER);
  const sub = type==='pendaftaran'?'Pendaftaran Baru':type==='kerusakan'?'Kerusakan & Kehilangan':'Pengembalian Aset';
  folder = getOrCreate(folder, sub);
  if (posko) folder = getOrCreate(folder, posko);
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, name);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getOrCreate(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// ─── GET DATA ────────────────────────────────────────────────

function getAllData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = { pendaftaran:[], kerusakan:[], pengembalian:[], summary:[] };

  for (const [key, sheetName] of Object.entries(SHEET)) {
    const ws = ss.getSheetByName(sheetName);
    if (!ws || ws.getLastRow()<=1) { result[key]=[]; continue; }
    const vals = ws.getRange(2,1,ws.getLastRow()-1,ws.getLastColumn()).getValues();
    const hdrs = HEADERS[key];
    result[key] = vals.filter(r=>r[0]!=='').map(r=>{
      const obj={};
      hdrs.forEach((h,i)=>{
        let v=r[i];
        if(v instanceof Date) v=Utilities.formatDate(v,Session.getScriptTimeZone(),'dd/MM/yyyy HH:mm');
        obj[h]=v;
      });
      return obj;
    });
  }

  const sm = {};
  DAFTAR_POSKO.forEach(p=>{ sm[p]={posko:p,baru:0,rusak:0,hilang:0,dipinjam:0,kembali:0}; });
  result.pendaftaran.forEach(r=>{ if(sm[r['Nama Posko']]) sm[r['Nama Posko']].baru++; });
  result.kerusakan.forEach(r=>{
    const p=sm[r['Nama Posko']]; if(!p) return;
    if(r['Status Aset']==='RUSAK') p.rusak++;
    else if(r['Status Aset']==='HILANG') p.hilang++;
    else if(r['Status Aset']==='DIPINJAM') p.dipinjam++;
  });
  result.pengembalian.forEach(r=>{ if(sm[r['Posko Peminjam']]) sm[r['Posko Peminjam']].kembali++; });

  result.summary = Object.values(sm);
  result.totalBaru = result.pendaftaran.length;
  result.totalKerusakan = result.kerusakan.length;
  result.totalPengembalian = result.pengembalian.length;
  result.totalLaporan = result.totalBaru + result.totalKerusakan + result.totalPengembalian;
  result.poscos = DAFTAR_POSKO;
  return result;
}

function getExportUrl() {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
}

// ─── EMAIL ───────────────────────────────────────────────────

function kirimNotif(data, no) {
  MailApp.sendEmail({
    to: EMAIL_LAPORAN,
    subject: `[DAMKAR ALERT] ${data.status} - ${data.peralatan} - Posko ${data.posko}`,
    body: `🚒 NOTIFIKASI DAMKAR #${no}\n\nPosko : ${data.posko}\nPelapor: ${data.pelapor}\nBarang : ${data.peralatan}\nStatus : ${data.status}\nTingkat: ${data.tingkat||'-'}\nJumlah : ${data.jumlah} unit\n\n${data.deskripsi}\n\nTindakan: ${data.tindakan||'-'}\n\nDetail: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
  });
}

function kirimLaporanHarian() {
  const data = getAllData();
  const tgl = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMMM yyyy');
  const rekap = data.summary.map((p,i)=>
    `${i+1}. ${p.posko.padEnd(14)} | Baru:${p.baru} Rusak:${p.rusak} Hilang:${p.hilang} Dipinjam:${p.dipinjam} Kembali:${p.kembali}`
  ).join('\n');
  MailApp.sendEmail({
    to: EMAIL_LAPORAN,
    subject: `[DAMKAR] Laporan Harian — ${tgl}`,
    body: `🚒 LAPORAN HARIAN DAMKAR — ${tgl}\n${NAMA_INSTANSI}\n\n📊 RINGKASAN:\n✅ Pendaftaran Baru  : ${data.totalBaru}\n🔧 Laporan Kerusakan: ${data.totalKerusakan}\n🔄 Pengembalian Aset: ${data.totalPengembalian}\n📋 Total Laporan    : ${data.totalLaporan}\n\n🏠 PER POSKO:\n${rekap}\n\nDetail: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
  });
}

// ─── SETUP & MENU ────────────────────────────────────────────

function initSpreadsheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.entries(SHEET).forEach(([key, name])=>{
    let ws = ss.getSheetByName(name);
    if (!ws) { ws = ss.insertSheet(name); }
    if (ws.getLastRow()===0) { buatHeader(ws, HEADERS[key]); }
  });
  SpreadsheetApp.getUi().alert('✅ Inisialisasi berhasil! Semua sheet sudah siap.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🚒 DAMKAR')
    .addItem('📊 Ringkasan Data', 'showRingkasan')
    .addSeparator()
    .addItem('⚙️ Inisialisasi Sheet', 'initSpreadsheet')
    .addItem('📧 Kirim Laporan Harian', 'kirimLaporanHarian')
    .addSeparator()
    .addItem('🗑️ Hapus Data Test', 'clearTestData')
    .addToUi();
}

function showRingkasan() {
  const d = getAllData();
  SpreadsheetApp.getUi().alert('Ringkasan',
    `✅ Pendaftaran Baru : ${d.totalBaru}\n🔧 Kerusakan: ${d.totalKerusakan}\n🔄 Pengembalian: ${d.totalPengembalian}\n📋 Total: ${d.totalLaporan}`,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function clearTestData() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Hapus semua data?','',ui.ButtonSet.YES_NO)!==ui.Button.YES) return;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.values(SHEET).forEach(name=>{
    const ws = ss.getSheetByName(name);
    if (ws && ws.getLastRow()>1) ws.deleteRows(2, ws.getLastRow()-1);
  });
  ui.alert('✅ Data berhasil dihapus.');
}

function jsonResp(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
