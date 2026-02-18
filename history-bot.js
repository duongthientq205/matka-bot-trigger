// Thư viện xử lý file, path, và Firebase Admin SDK
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Cấu hình múi giờ (Ấn Độ) và thư mục lưu history
const TIME_ZONE = 'Asia/Kolkata';
const HISTORY_FOLDER = 'history';

// === CẤU HÌNH THỜI GIAN CHẠY BOT ===
// Chỉ chạy bot trong khung giờ này (IST - Asia/Kolkata)
const RESET_START_TIME = 2*60+30;      // 02:30 (production)
const RESET_END_TIME = 9 * 60;         // 09:00 (production)

// Chuyển đổi thời gian từ UTC sang IST (Asia/Kolkata) thành các phần riêng
// Input: date (JavaScript Date object)
// Output: { year, month, day, hour, minute, second } (dạng số)
function toISTDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    // Format string YYYY-MM-DD dùng cho RTDB history key
    dateKey: `${map.year}-${String(map.month).padStart(2, '0')}-${String(map.day).padStart(2, '0')}`
  };
}

// Xác định quý trong năm dựa trên tháng
// Q1: Jan-Mar (1-3), Q2: Apr-Jun (4-6), Q3: Jul-Sep (7-9), Q4: Oct-Dec (10-12)
function quarterOfMonth(month) {
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

// Tạo thư mục nếu nó chưa tồn tại (recursive: tạo cả thư mục cha)
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// Đọc JSON file một cách an toàn
// Nếu file không tồn tại hoặc lỗi parsing, trả về fallbackValue
function readJSONSafe(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) return fallbackValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallbackValue;
  }
}

// Lấy Firebase service account từ environment variable
// GitHub Secret sẽ truyền nó qua env.FIREBASE_SERVICE_ACCOUNT_JSON
// Private key có thể chứa \\n (escaped newlines) nên cần convert sang \n thực
function getServiceAccountFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON secret');
  }

  const parsed = JSON.parse(raw);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

// Khởi tạo Firebase Admin SDK
// Sử dụng service account credentials (từ env) để xác thực
// Trả về reference tới Realtime Database
function initFirebase() {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    throw new Error('Missing FIREBASE_DATABASE_URL secret');
  }

  const serviceAccount = getServiceAccountFromEnv();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });
  }

  return admin.database();
}

// Tạo template rỗng cho live results
// Copy tất cả keys từ sourceLive nhưng reset giá trị thành empty (---, -, null)
// Dùng để reset RTDB.live sau khi đã lưu old data vào last_day
function buildEmptyLiveFromKeys(sourceLive) {
  const result = {};
  for (const key of Object.keys(sourceLive || {})) {
    result[key] = {
      fullResult: '--- - - ---',
      openPanel: '---',
      openJodi: '-',
      closeJodi: '-',
      closePanel: '---',
      openUpdate: null,
      closeUpdate: null
    };
  }
  return result;
}

// Xóa các file history cũ hơn 3 năm (dựa trên quý + năm, không phải riêng năm)
// Tính: YYYY*4 + (Q-1) để so sánh, xóa nếu < cutoff
// Ví dụ: năm 2026 Q1 = 8104, cutoff = 8104 - 12 = 8092 (2023 Q1)
// => sẽ xóa 2023-q1.json nhưng giữ 2023-q2.json trở đi
function cleanupOldHistory(historyDir, currentYear, currentQuarter) {
  const MAX_QUARTERS = 12; // 3 năm = 12 quý
  const currentQuarterNum = currentYear * 4 + (currentQuarter - 1);
  const cutoffQuarterNum = currentQuarterNum - MAX_QUARTERS;

  if (!fs.existsSync(historyDir)) return;

  const files = fs.readdirSync(historyDir);
  files.forEach(file => {
    const match = file.match(/^(\d{4})-q(\d)\.json$/);
    if (match) {
      const year = Number(match[1]);
      const quarter = Number(match[2]);
      const fileQuarterNum = year * 4 + (quarter - 1);
      if (fileQuarterNum < cutoffQuarterNum) {
        const filePath = path.join(historyDir, file);
        fs.unlinkSync(filePath);
        console.log(`Deleted old history file: ${file} (quarter: ${fileQuarterNum} < cutoff: ${cutoffQuarterNum})`);
      }
    }
  });
}

// Hàm chính: thực hiện rollover RTDB + archive history
// Bước 1: Kiểm tra version - nếu = 0 (đã reset) thì bỏ qua
// Bước 2: Kiểm tra thời gian - chỉ chạy từ 02:30 đến 09:00 IST
// Bước 3: Lấy snapshot của current live results từ Firebase
// Bước 4: Lưu old data vào last_day + reset live thành empty + update version
// Bước 5: Archive old data vào quarterly JSON file trong Git
async function main() {
  const root = process.cwd();
  const now = new Date();
  // Lấy thời gian hiện tại dạng IST
  const ist = toISTDateParts(now);
  // Tạo object ngày hôm qua (IST)
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const istYesterday = toISTDateParts(yesterdayDate);

  const db = initFirebase(); // Kết nối tới Firebase
  const liveResultsRef = db.ref('live_results');

  // Bước 1: Kiểm tra version - nếu = 0 thì đã reset hôm nay rồi, bỏ qua
  const versionSnapshot = await liveResultsRef.child('version').once('value');
  const currentVersion = versionSnapshot.val();

  if (currentVersion === 0) {
    console.log(`[${ist.dateKey} ${String(ist.hour).padStart(2, '0')}:${String(ist.minute).padStart(2, '0')}] Version = 0, already reset today. Exiting...`);
    process.exit(0);
  }

  // Bước 2: Kiểm tra thời gian - chỉ chạy nếu nằm trong khung cấu hình
  const timeInMinutes = ist.hour * 60 + ist.minute;

  if (timeInMinutes < RESET_START_TIME || timeInMinutes >= RESET_END_TIME) {
    const startHour = String(Math.floor(RESET_START_TIME / 60)).padStart(2, '0');
    const startMin = String(RESET_START_TIME % 60).padStart(2, '0');
    const endHour = String(Math.floor(RESET_END_TIME / 60)).padStart(2, '0');
    const endMin = String(RESET_END_TIME % 60).padStart(2, '0');
    console.log(`[${ist.dateKey} ${String(ist.hour).padStart(2, '0')}:${String(ist.minute).padStart(2, '0')}] Outside reset window (${startHour}:${startMin}-${endHour}:${endMin} IST). Exiting...`);
    process.exit(0);
  }

  console.log(`[${ist.dateKey} ${String(ist.hour).padStart(2, '0')}:${String(ist.minute).padStart(2, '0')}] Starting reset process...`);

  // Bước 3: Fetch current live results từ RTDB
  const liveSnapshot = await liveResultsRef.child('live').once('value');
  const oldLive = liveSnapshot.val() || {};

  const emptyLive = buildEmptyLiveFromKeys(oldLive);

  // Bước 4: Update RTDB - rollover: live->last_day, reset live, version = 0
  // version = 0 để đánh dấu đã reset, nên lấy data từ last_day
  await liveResultsRef.update({
    last_day: oldLive,
    live: emptyLive,
    version: 0  // Đánh dấu vừa reset (có thể lấy từ last_day)
  });

  // Bước 5: Lưu oldLive vào RTDB history (dùng ngày hôm qua)
  // Cấu trúc: history/YYYY-qN/YYYY-MM-DD
  const quarter = quarterOfMonth(istYesterday.month); // Tính quý (Q1-Q4) cho ngày hôm qua
  const quarterKey = `${istYesterday.year}-q${quarter}`;
  const historyRtdbRef = db.ref(`history/${quarterKey}/${istYesterday.dateKey}`);
  await historyRtdbRef.set(oldLive);
  console.log(`Saved to RTDB history/${quarterKey}/${istYesterday.dateKey}`);

  // Bước 6: Archive vào Git quarterly JSON file (dùng ngày hôm qua)
  // Cấu trúc: history/YYYY-qN.json với key là ngày {YYYY-MM-DD: {...}, ...}
  const historyDir = path.join(root, HISTORY_FOLDER);
  ensureDir(historyDir); // Tạo thư mục history nếu chưa có

  // Tên file: YYYY-qN.json (vd: 2026-q1.json)
  const fileName = `${istYesterday.year}-q${quarter}.json`;
  const filePath = path.join(historyDir, fileName);

  // Đọc file history nếu tồn tại, nếu không tạo object rỗng
  const data = readJSONSafe(filePath, {});

  // Set entry với key là ngày hôm qua, value là oldLive data
  data[istYesterday.dateKey] = oldLive;

  // Ghi lại file JSON (pretty-printed với indent 2)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Updated ${path.relative(root, filePath)} with entry for ${istYesterday.dateKey}`);

  // Xóa các file history cũ hơn 3 năm (dựa trên giá trị quý + năm)
  cleanupOldHistory(historyDir, istYesterday.year, quarter);

  console.log(`[${istYesterday.dateKey}] Reset process completed successfully. Exiting...`);
  process.exit(0);
}

// Chạy main function, nếu lỗi thì exit(1)
main().catch(error => {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
});
