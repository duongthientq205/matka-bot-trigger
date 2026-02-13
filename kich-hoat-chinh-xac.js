const axios = require('axios');

const LICH_TRINH_CHAY = [
  { "id_phien": "K_MORN_OPEN",    "ist": "11:00" },
  { "id_phien": "SRI_DAY_OPEN",   "ist": "11:35" },
  { "id_phien": "K_MORN_CLOSE",   "ist": "12:02" },
  { "id_phien": "SRI_DAY_CLOSE",  "ist": "12:35" },
  { "id_phien": "TIME_OPEN",      "ist": "13:00" },
  { "id_phien": "TIME_CLOSE",     "ist": "14:00" },
  { "id_phien": "RAJ_DAY_OPEN",   "ist": "15:05" },
  { "id_phien": "MILAN_DAY_OPEN", "ist": "16:00" },
  { "id_phien": "K_MAIN_OPEN",    "ist": "16:50" },
  { "id_phien": "RAJ_DAY_CLOSE",  "ist": "17:05" },
  { "id_phien": "MILAN_DAY_CLOSE", "ist": "18:00" },
  { "id_phien": "K_MAIN_CLOSE",   "ist": "18:50" },
  { "id_phien": "SRI_NIGHT_OPEN", "ist": "19:15" },
  { "id_phien": "SRI_NIGHT_CLOSE", "ist": "20:15" },
  { "id_phien": "MILAN_RAJ_OPEN", "ist": "21:00" },
  { "id_phien": "K_NIGHT_OPEN",   "ist": "21:25" },
  { "id_phien": "MAIN_OPEN",      "ist": "21:40" },
  { "id_phien": "MILAN_RAJ_CLOSE","ist": "23:00" },
  { "id_phien": "K_NIGHT_CLOSE",  "ist": "23:30" },
  { "id_phien": "MAIN_CLOSE",     "ist": "00:10" }
];

async function logicKichHoat() {
    console.log("--- [GITHUB CONTROLLER] KHỞI ĐỘNG CHẾ ĐỘ BẮN TỈA ---");
    
    const hienTai = new Date();
    // Quy đổi giờ hiện tại sang tổng số giây trong ngày theo giờ IST (UTC + 5.5h)
    const giayHienTaiIST = Math.floor((hienTai.getUTCHours() * 3600 + hienTai.getUTCMinutes() * 60 + hienTai.getUTCSeconds() + (5.5 * 3600))) % 86400;

    // Tìm phiên sắp tới (trong vòng 10 phút tới)
    const phienTarget = LICH_TRINH_CHAY.find(p => {
        const [h, m] = p.ist.split(':').map(Number);
        const giayPhien = (h * 3600 + m * 60);
        return giayPhien > giayHienTaiIST && giayPhien <= giayHienTaiIST + 900; // Tìm trong 15p tới
    });

    if (!phienTarget) {
        console.log("Không tìm thấy phiên nổ số nào sắp tới. Thoát.");
        return;
    }

    const [hT, mT] = phienTarget.ist.split(':').map(Number);
    const giayTarget = (hT * 3600 + mT * 60);
    const giayKichHoat = giayTarget - 60; // Giờ nổ số trừ đi 60 giây (1 phút)

    const giayCanNgu = giayKichHoat - giayHienTaiIST;

    if (giayCanNgu > 0) {
        console.log(`Mục tiêu: ${phienTarget.id_phien} lúc ${phienTarget.ist} IST.`);
        console.log(`Hệ thống sẽ ngủ trong ${giayCanNgu} giây để canh đúng 1 phút trước giờ live...`);
        
        // Lệnh Sleep (ngủ) theo yêu cầu của bạn
        await new Promise(resolve => setTimeout(resolve, giayCanNgu * 1000));
    }

    // Sau khi ngủ dậy hoặc nếu đã sát giờ, thực hiện gọi Google ngay
    console.log(`>>> ĐẾN GIỜ G (-1p)! Đang gọi Google cho phiên: ${phienTarget.id_phien}`);
    
    try {
        await axios.post(process.env.GOOGLE_FUNCTION_URL, 
            { id_phien: phienTarget.id_phien },
            { 
                headers: { 
                    'Authorization': `Bearer ${process.env.BOT_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // Chờ phản hồi tối đa 10s
            }
        );
        console.log("Kích hoạt thành công. Nhiệm vụ GitHub hoàn tất.");
    } catch (err) {
        console.error("Lỗi khi kết nối Google Cloud:", err.message);
        process.exit(1);
    }
}

logicKichHoat();