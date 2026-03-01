// Tạo bảng lịch trình ghép các phiên trùng giờ
function getBangLichTrinhGhep(lichTrinh) {
    const map = {};
    lichTrinh.forEach((item) => {
        if (!map[item.ist]) map[item.ist] = [];
        map[item.ist].push(item.id_phien);
    });
    // Tạo bảng có số thứ tự, giờ, danh sách phiên
    const bang = [];
    let stt = 1;
    for (const ist of Object.keys(map).sort()) {
        bang.push({
            stt,
            ist,
            phien: map[ist]
        });
        stt++;
    }
    return bang;
}
/// Chuyển dữ liệu KV sang mảng lịch trình chuẩn cho bot (ĐÃ TÍCH HỢP CHẶN NGÀY NGHỈ)
function mapLichTrinhFromKV(kvData) {
    const lichTrinh = [];
    if (!kvData || typeof kvData !== 'object') return lichTrinh;

    // Lấy thứ hiện tại theo giờ VN (0 = Chủ Nhật, 6 = Thứ Bảy)
    const ngayHomNay = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"})).getDay();

    for (const key in kvData) {
        const item = kvData[key];

        // --- LOGIC CHẶN TẦNG 2: KIỂM TRA NGÀY NGHỈ ---
        if (item.off_days && item.off_days.includes(ngayHomNay)) {
            // console.log(`[SKIP] Đài ${key} nghỉ hôm nay, không tạo phiên bắn tỉa.`);
            continue; 
        }
        // -----------------------------------

        if (item.ist_open) {
            lichTrinh.push({
                id_phien: key + '_OPEN',
                ist: item.ist_open
            });
        }
        if (item.ist_close) {
            lichTrinh.push({
                id_phien: key + '_CLOSE',
                ist: item.ist_close
            });
        }
    }
    return lichTrinh;
}
const axios = require('axios');

// Lấy lịch trình từ KV API
async function fetchLichTrinhKV() {
    try {
        const response = await axios.get(
            'https://danh-sanh-market-api.duongthientq205.workers.dev/?v=5',
            {
                headers: {
                    'X-Custom-Auth': process.env.KV_API_PASSWORD,
                    'Accept': 'application/json'
                }
            }
        );
        // Luôn trả về object KV nếu không phải mảng
        if (Array.isArray(response.data)) {
            return response.data;
        } else if (response.data && typeof response.data === 'object') {
            return response.data;
        } else {
            throw new Error('Không đúng cấu trúc KV');
        }
    } catch (err) {
        console.error('Lỗi lấy lịch trình từ KV:', err.message);
        return {};
    }
}

async function logicKichHoat() {
    console.log("--- [GITHUB CONTROLLER] KHỞI ĐỘNG CHẾ ĐỘ BẮN TỈA ---");
    // Lấy dữ liệu KV
    const kvData = await fetchLichTrinhKV();
    // Chuyển sang lịch trình chuẩn cho bot
    const LICH_TRINH_CHAY = mapLichTrinhFromKV(kvData);
    if (!LICH_TRINH_CHAY.length) {
        console.log("Không lấy được lịch trình từ KV. Thoát.");
        return;
    }
    // Tạo bảng lịch trình ghép trùng giờ (sau khi đã có LICH_TRINH_CHAY)
    const bangGhep = getBangLichTrinhGhep(LICH_TRINH_CHAY);
    console.table(bangGhep);
    const hienTai = new Date();
    // Lấy giờ và phút hiện tại theo IST
    const utc = hienTai.getTime() + (hienTai.getTimezoneOffset() * 60000);
    const istDate = new Date(utc + 5.5 * 60 * 60000);
    const gioIST = istDate.getHours();
    const phutIST = istDate.getMinutes();

    // Kiểm tra tất cả các phiên, nếu giờ/phút trùng với lịch thì gọi bot Google
    let found = false;
    // Thành đoạn này (Đúng):
    for (const muc of bangGhep) { 
        let [h, m] = muc.ist.split(":").map(Number);
        
        // --- LOGIC TÍNH GIỜ GỌI TRƯỚC 1 PHÚT ---
        m = m - 2;
        if (m < 0) {
            m = 59;
            h = h - 1;
            if (h < 0) h = 23;
        }
        
        if (gioIST === h && phutIST === m) {
            found = true;
            console.log(`>>> BẮN TỈA: Kích hoạt khung giờ ${muc.ist} (Gồm: ${muc.phien.join(", ")})`);
            await goiBotGoogle(muc.phien[0]); 
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
