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
    // Lấy giờ và phút hiện tại theo IST
    const utc = hienTai.getTime() + (hienTai.getTimezoneOffset() * 60000);
    const istDate = new Date(utc + 5.5 * 60 * 60000);
    const gioIST = istDate.getHours();
    const phutIST = istDate.getMinutes();

    // Kiểm tra tất cả các phiên, nếu giờ/phút trùng với lịch thì gọi bot Google
    let found = false;
    for (const phien of LICH_TRINH_CHAY) {
        let [h, m] = phien.ist.split(":").map(Number);
        // Tính thời điểm gọi trước 1 phút
        m = m - 1;
        if (m < 0) {
            m = 59;
            h = h - 1;
            if (h < 0) h = 23;
        }
        if (gioIST === h && phutIST === m) {
            found = true;
            console.log(`>>> GỌI TRƯỚC 1 PHÚT! Đang gọi Google cho phiên: ${phien.id_phien} (${phien.ist} IST)`);
            await goiBotGoogle(phien.id_phien);
        }
    }
    if (!found) {
        console.log("Không có phiên nào trùng giờ hiện tại. Thoát.");
    }
}

// Hàm gọi Google cho từng phiên
async function goiBotGoogle(id_phien) {
    // Timeout tối đa 2 phút (120000 ms)
    let retried = false;
    while (true) {
        try {
            const response = await axios.post(
                process.env.GOOGLE_FUNCTION_URL,
                { id_phien },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'authorization': `Bearer ${process.env.BOT_SECRET_KEY}`
                    },
                    timeout: 120000
                }
            );
            console.log('[OK]', 'Kich hoat thanh cong phien', id_phien + '!');
            console.log('[Response]:', response.data);
            break;
        } catch (err) {
            // Nếu là timeout, đóng bot ngay
            if (err.code === 'ECONNABORTED') {
                console.error('[Error]', 'Timeout khi gọi bot Google cho phien', id_phien + ':', err.message);
                process.exit(1);
            }
            // Nếu là lỗi xác thực, đóng bot ngay
            if (err.response && (err.response.status === 401 || err.response.status === 403)) {
                console.error('   Loi xac thuc! Kiem tra BOT_SECRET_KEY.');
                process.exit(1);
            }
            // Nếu chưa retry, thử lại 1 lần
            if (!retried) {
                retried = true;
                console.error('[Error]', 'Lỗi khi gọi bot Google cho phien', id_phien + ':', err.message);
                console.log('   Thử gọi lại server 1 lần nữa...');
                continue;
            } else {
                console.error('[Error]', 'Đã retry nhưng vẫn lỗi cho phien', id_phien + '. Đóng bot.');
                process.exit(1);
            }
        }
    }
}

logicKichHoat();
